import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const READY_PREFIX = 'dsh web: '
const START_TIMEOUT_MS = 90_000
const STOP_TIMEOUT_MS = 5_000
const MAX_OUTPUT_CHARS = 32_768

export interface HostGeneration {
  readonly id: number
  readonly origin: string
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
  readonly child: ChildProcessWithoutNullStreams
  output: string
}

function parseOrigin(line: string): string | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const token = line.slice(READY_PREFIX.length).trim().split(/\s/u, 1)[0]
  if (token === undefined) throw new Error('DSH Host readiness line is missing its URL')
  const url = new URL(token)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.port === '') {
    throw new Error(`DSH Host must report a 127.0.0.1 HTTP origin, received ${token}`)
  }
  return url.origin
}

async function probe(origin: string): Promise<void> {
  const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`DSH Host health probe returned ${response.status}`)
}

/** Create a single-owner supervisor for local DSH Web Host generations. */
export function createHostSupervisor(
  spawnHost: () => ChildProcessWithoutNullStreams,
  onUnexpectedExit?: (detail: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void,
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
    starting = new Promise<HostGeneration>((resolve, reject) => {
      const child = spawnHost()
      const host: ActiveHost = { id: ++nextId, origin: '', child, output: '' }
      let stdoutPending = ''
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        reject(new Error(`${error.message}${host.output === '' ? '' : `\nHost output:\n${host.output}`}`))
      }
      const succeed = async (origin: string): Promise<void> => {
        if (settled) return
        try {
          await probe(origin)
          if (settled) return
          settled = true
          clearTimeout(timer)
          host.origin = origin
          active = host
          resolve(host)
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
            const origin = parseOrigin(line)
            if (origin !== undefined) void succeed(origin)
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
        if (!settled) fail(new Error(`DSH Host exited before readiness (code ${String(code)}, signal ${String(signal)})`))
        else if (wasActive) onUnexpectedExit?.({ code, signal })
      })
    }).finally(() => { starting = undefined })
    return starting
  }

  const stop = async (): Promise<void> => {
    const host = active
    if (host === undefined) return
    active = undefined
    if (host.child.exitCode !== null || host.child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => host.child.kill('SIGKILL'), STOP_TIMEOUT_MS)
      host.child.once('exit', () => { clearTimeout(timer); resolve() })
      host.child.kill('SIGTERM')
    })
  }

  return { get current() { return active }, start, stop, diagnostics: () => lastOutput }
}
