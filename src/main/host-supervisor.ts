import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'

const READY_PREFIX = 'dsh web: '
const START_TIMEOUT_MS = 90_000
const STOP_TIMEOUT_MS = 5_000
const STALE_SIGTERM_GRACE_MS = 2_000
const MAX_OUTPUT_CHARS = 32_768
const AUTH_COOKIE_PREFIX = 'dsh-auth-'

export interface CreateHostSupervisorOptions {
  /**
   * PID file for the running host. When set, the supervisor reaps a stale
   * holder on start (hard-killed Electron leaves its DSH child alive, and a
   * surviving host keeps kernel write locks on resumed sessions) and removes
   * the file once its own host exits.
   */
  pidfile?: string
  /** Only stale PIDs whose `ps` command line includes this marker are reaped. */
  processMarker?: string
}

export interface HostGeneration {
  readonly id: number
  readonly origin: string
  /** Session auth cookie (`name=value`) required by every /api/* request and the remote.mux upgrade. */
  readonly cookie: string
}

export interface HostSupervisor {
  readonly current: HostGeneration | undefined
  start(): Promise<HostGeneration>
  stop(): Promise<void>
  diagnostics(): string
}

interface ActiveHost {
  readonly id: number
  origin: string
  cookie: string
  readonly child: ChildProcessWithoutNullStreams
  output: string
}

/**
 * Parse the DSH readiness line. Since 0.1.2 the line carries a one-time
 * launch token in the query string (`http://127.0.0.1:PORT/?token=…`) which
 * must be exchanged for an HttpOnly session cookie. Returns the full URL.
 */
function parseReadyUrl(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const token = line.slice(READY_PREFIX.length).trim().split(/\s/u, 1)[0]
  if (token === undefined) throw new Error('DSH Host readiness line is missing its URL')
  const url = new URL(token)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.hash !== '' || url.port === '') {
    throw new Error(`DSH Host must report a 127.0.0.1 HTTP origin, received ${token}`)
  }
  if (!url.searchParams.get('token')) throw new Error('DSH Host readiness URL is missing its launch token')
  return url
}

function extractCookie(setCookieHeaders: string[]): string | undefined {
  for (const header of setCookieHeaders) {
    const pair = header.split(';', 1)[0]?.trim()
    if (pair?.startsWith(AUTH_COOKIE_PREFIX) && pair.includes('=')) return pair
  }
  return undefined
}

/**
 * Exchange the one-time launch token for the HMAC session cookie, then prove
 * the cookie authenticates a normal request. The token GET answers 303 with
 * exactly one `Set-Cookie: dsh-auth-…` (redirect:'manual' is required so the
 * auto-follow does not strip it).
 */
async function bootstrapAuth(readyUrl: URL): Promise<{ origin: string; cookie: string }> {
  const origin = readyUrl.origin
  const exchange = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  if (exchange.status !== 303) throw new Error(`DSH Host token exchange returned ${exchange.status}`)
  const setCookie = typeof exchange.headers.getSetCookie === 'function'
    ? exchange.headers.getSetCookie()
    : [exchange.headers.get('set-cookie')].filter((v): v is string => typeof v === 'string')
  const cookie = extractCookie(setCookie)
  if (!cookie) throw new Error('DSH Host token exchange did not return a session cookie')
  const probe = await fetch(`${origin}/`, { headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  if (probe.status !== 200) throw new Error(`DSH Host authenticated probe returned ${probe.status}`)
  return { origin, cookie }
}

/** Signal the host's process group (host is spawned detached as group leader), falling back to the direct child. */
function signalHost(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid === undefined) return
  try { process.kill(-pid, signal) } catch {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** Inspect the candidate's command line so a recycled PID can never be killed. */
function commandLineContains(pid: number, marker: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'args='], { windowsHide: true }, (error, stdout) => {
      resolve(error ? false : stdout.includes(marker))
    })
  })
}

/**
 * Reap a host orphaned by a previous Electron generation: a hard-killed main
 * process leaves the DSH child running, and that child keeps kernel write
 * locks on every promoted session, so resuming them fails with
 * SessionAlreadyOwnedError until the successor process is allowed to start.
 */
async function reapStaleHost(pidfile: string, processMarker?: string): Promise<void> {
  let pid: number
  try {
    const raw = (await readFile(pidfile, 'utf8')).trim()
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed === process.pid) return
    pid = parsed
  } catch { return }
  if (!isAlive(pid)) { await rm(pidfile, { force: true }); return }
  if (processMarker !== undefined && !(await commandLineContains(pid, processMarker))) { await rm(pidfile, { force: true }); return }
  try {
    try { process.kill(-pid, 'SIGTERM') } catch { process.kill(pid, 'SIGTERM') }
    await new Promise((resolve) => setTimeout(resolve, STALE_SIGTERM_GRACE_MS))
    if (isAlive(pid)) {
      try { process.kill(-pid, 'SIGKILL') } catch { process.kill(pid, 'SIGKILL') }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  } catch { /* process disappeared while we reaped it */ }
  await rm(pidfile, { force: true })
}

/** Create a single-owner supervisor for local DSH Web Host generations. */
export function createHostSupervisor(
  spawnHost: () => ChildProcessWithoutNullStreams,
  onUnexpectedExit?: (detail: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void,
  options: CreateHostSupervisorOptions = {},
): HostSupervisor {
  let active: ActiveHost | undefined
  let starting: Promise<HostGeneration> | undefined
  let nextId = 0
  let lastOutput = ''

  const appendOutput = (host: ActiveHost, chunk: string): void => {
    host.output = `${host.output}${chunk}`.slice(-MAX_OUTPUT_CHARS)
    lastOutput = host.output
  }

  const start = async (): Promise<HostGeneration> => {
    if (active !== undefined) return active
    if (starting !== undefined) return starting
    starting = (async (): Promise<HostGeneration> => {
      if (options.pidfile !== undefined) {
        try { await reapStaleHost(options.pidfile, options.processMarker) }
        catch (error) { console.error('[narwhal] supervisor: stale host reap failed:', error instanceof Error ? error.message : String(error)) }
      }
      return await new Promise<HostGeneration>((resolve, reject) => {
        const child = spawnHost()
        const host: ActiveHost = { id: ++nextId, origin: '', cookie: '', child, output: '' }
        let stdoutPending = ''
        let settled = false
        const fail = (error: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signalHost(child, 'SIGTERM')
          reject(new Error(`${error.message}${host.output === '' ? '' : `\nHost output:\n${host.output}`}`))
        }
        const succeed = async (readyUrl: URL): Promise<void> => {
          if (settled) return
          try {
            const { origin, cookie } = await bootstrapAuth(readyUrl)
            if (settled) return
            settled = true
            clearTimeout(timer)
            host.origin = origin
            host.cookie = cookie
            if (options.pidfile !== undefined && child.pid !== undefined) {
              await writeFile(options.pidfile, String(child.pid), 'utf8').catch(() => { /* best-effort lock bookkeeping */ })
            }
            active = host
            resolve({ id: host.id, origin, cookie })
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        }
        const timer = setTimeout(() => fail(new Error('Timed out waiting for the DSH Host readiness URL')), START_TIMEOUT_MS)
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          appendOutput(host, chunk)
          stdoutPending += chunk
          for (;;) {
            const newline = stdoutPending.indexOf('\n')
            if (newline < 0) break
            const line = stdoutPending.slice(0, newline).replace(/\r$/u, '')
            stdoutPending = stdoutPending.slice(newline + 1)
            try {
              const readyUrl = parseReadyUrl(line)
              if (readyUrl !== undefined) void succeed(readyUrl)
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)))
            }
          }
        })
        child.stderr.on('data', (chunk: string) => appendOutput(host, chunk))
        child.once('error', (error) => fail(error))
        child.once('exit', (code, signal) => {
          const wasActive = active === host
          if (wasActive) active = undefined
          if (options.pidfile !== undefined) void rm(options.pidfile, { force: true }).catch(() => { /* best effort */ })
          if (!settled) fail(new Error(`DSH Host exited before readiness (code ${String(code)}, signal ${String(signal)})`))
          else if (wasActive) onUnexpectedExit?.({ code, signal })
        })
      })
    })()
    starting.finally(() => { starting = undefined })
    return await starting
  }

  const stop = async (): Promise<void> => {
    const host = active
    if (host === undefined) return
    active = undefined
    if (host.child.exitCode !== null || host.child.signalCode !== null) return
    await new Promise<void>((resolveStop) => {
      const timer = setTimeout(() => signalHost(host.child, 'SIGKILL'), STOP_TIMEOUT_MS)
      host.child.once('exit', () => { clearTimeout(timer); resolveStop() })
      signalHost(host.child, 'SIGTERM')
    })
    if (options.pidfile !== undefined) await rm(options.pidfile, { force: true }).catch(() => { /* best effort */ })
  }

  return { get current() { return active }, start, stop, diagnostics: () => lastOutput }
}
