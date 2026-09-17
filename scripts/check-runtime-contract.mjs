// Runtime contract probe for the bundled DSH runtime.
//
// typecheck + build can only verify Narwhal's own code. The DSH wire contract
// (readiness line, event channels, RPC envelope) is dynamic HTTP/WS with no
// shared types, so a staged runtime may compile cleanly and still be
// incompatible at boot — exactly what happened with DSH 0.1.2+ (cookie auth,
// /api/remote.mux replacing events.mux/events.host, named-args RPC).
//
// This script boots the staged runtime the same way host-supervisor does and
// asserts the minimum contract src/main/host-supervisor.ts + host-bridge.ts
// rely on. It MUST be updated in lockstep with those files when Narwhal
// intentionally adopts a new runtime contract.
//
// Exit 0 = compatible; exit 1 = contract drift (details on stdout).

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'

const root = resolve(import.meta.dirname, '..')
const runtimeRoot = join(root, 'runtime', 'dsh')
const bin = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const READY_PREFIX = 'dsh web: '
const START_TIMEOUT_MS = 90_000

// Keep the probe hermetic: never touch the developer's real ~/.narwhal.
const dshHome = mkdtempSync(join(tmpdir(), 'narwhal-contract-'))

const failures = []
function fail(message) {
  failures.push(message)
  console.error(`  ✗ ${message}`)
}

let child
function killHost() {
  if (!child || child.killed || child.pid === undefined) return
  try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
  }, 3_000).unref()
}
process.on('exit', killHost)

function bootHost() {
  return new Promise((resolveBoot, rejectBoot) => {
    if (!existsSync(bin)) {
      rejectBoot(new Error(`Runtime entry missing: ${bin}. Run "pnpm run stage:runtime" first.`))
      return
    }
    // detached → own process group so SIGTERM reaches DSH's helper processes too.
    child = spawn(process.execPath, [bin, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: runtimeRoot,
      detached: true,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH ?? '',
        DSH_HOME: dshHome,
        CI: 'true',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let pending = ''
    const timer = setTimeout(() => rejectBoot(new Error(`Timed out after ${START_TIMEOUT_MS}ms waiting for "${READY_PREFIX}<url>"`)), START_TIMEOUT_MS)
    const inspect = (chunk) => {
      pending += chunk.toString()
      for (;;) {
        const nl = pending.indexOf('\n')
        if (nl < 0) break
        const line = pending.slice(0, nl).trim()
        pending = pending.slice(nl + 1)
        if (line.startsWith(READY_PREFIX)) {
          clearTimeout(timer)
          resolveBoot(line.slice(READY_PREFIX.length).split(/\s/u, 1)[0])
        }
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', (error) => { clearTimeout(timer); rejectBoot(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      rejectBoot(new Error(`Runtime exited (${code}) before printing a ready URL`))
    })
  })
}

// Mirror of parseOrigin() in src/main/host-supervisor.ts.
function parseOrigin(token) {
  const url = new URL(token)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.port === '') {
    return { ok: false, reason: `ready URL is not a bare 127.0.0.1 http origin: ${token}` }
  }
  if (url.search !== '') {
    return {
      ok: false,
      reason: `ready URL carries credentials/query (${url.search}): the runtime now requires token/cookie auth, host-supervisor's origin contract needs migration`,
    }
  }
  if (url.hash !== '') return { ok: false, reason: `ready URL has a fragment: ${token}` }
  return { ok: true, origin: url.origin }
}

async function expectHttpRoot(origin) {
  const response = await fetch(`${origin}/`, { signal: AbSignalTimeout(5_000) })
  if (!response.ok) fail(`health probe GET / returned HTTP ${response.status}`)
}

function AbSignalTimeout(ms) {
  return AbortSignal.timeout(ms)
}

// host-bridge opens both event sockets immediately on start().
function expectEventChannel(wsOrigin, path) {
  return new Promise((resolveCheck) => {
    const socket = new WebSocket(`${wsOrigin}${path}`, { handshakeTimeout: 5_000 })
    let settled = false
    const done = (ok, detail) => {
      if (settled) return
      settled = true
      if (!ok) fail(`event channel ${path} did not upgrade: ${detail}`)
      try { socket.terminate() } catch { /* noop */ }
      resolveCheck()
    }
    socket.once('open', () => done(true))
    socket.once('unexpected-response', (_req, res) => done(false, `HTTP ${res.statusCode}`))
    socket.once('error', (error) => {
      // Route removal on the Host side surfaces as a dropped upgrade, not 404.
      const message = error?.message ?? String(error)
      done(false, /closed|reset|handshake/i.test(message) ? 'upgrade dropped (route missing?)' : message)
    })
  })
}

// host-bridge rpc(): old unary envelope over POST /api/<method>.
async function expectLegacyRpcEnvelope(origin) {
  const response = await fetch(`${origin}/api/session.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'contract-probe', method: 'session.list', payload: {} }),
    signal: AbSignalTimeout(10_000),
  })
  if (response.status === 401 || response.status === 403) {
    fail(`RPC /api/session.list rejected with HTTP ${response.status}: the runtime now fences /api behind authentication`)
    return
  }
  if (!response.ok) {
    fail(`RPC /api/session.list returned HTTP ${response.status}`)
    return
  }
  let envelope
  try { envelope = await response.json() } catch { fail('RPC /api/session.list did not return JSON') ; return }
  if (envelope?.type !== 'server-response') {
    fail(`RPC envelope drift: expected {type:'server-response'}, got ${JSON.stringify(envelope).slice(0, 200)}`)
  }
}

try {
  console.log('[contract] booting staged DSH runtime with an isolated DSH_HOME…')
  const readyUrl = await bootHost()
  console.log(`[contract] ready URL: ${readyUrl}`)

  const parsed = parseOrigin(readyUrl)
  if (!parsed.ok) {
    fail(parsed.reason)
    console.error('[contract] origin contract failed; skipping channel probes (host needs the origin first)')
  } else {
    const { origin } = parsed
    console.log(`[contract] origin: ${origin}`)
    await expectHttpRoot(origin)
    const wsOrigin = origin.replace(/^http:/u, 'ws:')
    await expectEventChannel(wsOrigin, '/api/events.mux')
    await expectEventChannel(wsOrigin, '/api/events.host')
    await expectLegacyRpcEnvelope(origin)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  killHost()
  rmSync(dshHome, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n[contract] RUNTIME CONTRACT VIOLATED (${failures.length}):`)
  for (const message of failures) console.error(`  - ${message}`)
  console.error('\nThis runtime bump needs code changes in src/main/host-supervisor.ts / host-bridge.ts before it can be merged.')
  process.exit(1)
}
console.log('[contract] OK — readiness, event channels, and RPC envelope all match the current host-bridge.')
