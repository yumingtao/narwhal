// Runtime contract probe for the bundled DSH runtime.
//
// typecheck + build can only verify Narwhal's own code. The DSH wire contract
// (readiness line, cookie auth, slash-endpoint RPC envelope, remote.mux
// framing) is dynamic HTTP/WS with no shared types, so a staged runtime may
// compile cleanly and still be incompatible at boot — exactly what happened
// with DSH 0.1.2+ (cookie auth, /api/remote.mux replacing events.mux/
// events.host, named-args slash RPC).
//
// This script boots the staged runtime the same way host-supervisor does and
// asserts the minimum contract src/main/host-supervisor.ts + host-bridge.ts
// rely on:
//   1. readiness line `dsh web: http://127.0.0.1:PORT/?token=<launchToken>`
//   2. token GET → 303 + one `Set-Cookie: dsh-auth-…`
//   3. cookie-authenticated GET / → 200
//   4. /api/* without cookie → 401
//   5. slash RPC envelope over POST /api/session/list with named args
//   6. /api/remote.mux upgrade requires the cookie; an opened `$events`
//      stream answers a `{type:'ready'}` item frame
//
// It MUST be updated in lockstep with those files when Narwhal intentionally
// adopts a new runtime contract.
//
// Exit 0 = compatible; exit 1 = contract drift (details on stdout).

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const root = resolve(import.meta.dirname, '..')
const runtimeRoot = join(root, 'runtime', 'dsh')
const bin = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const READY_PREFIX = 'dsh web: '
const AUTH_COOKIE_PREFIX = 'dsh-auth-'
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
        ELECTRON_RUN_AS_NODE: '1',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUNDING: 'false',
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

// Mirror of parseReadyUrl() in src/main/host-supervisor.ts.
function parseReadyUrl(token) {
  const url = new URL(token)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.hash !== '' || url.port === '') {
    return { ok: false, reason: `ready URL is not a bare 127.0.0.1 HTTP origin: ${token}` }
  }
  if (!url.searchParams.get('token')) {
    return { ok: false, reason: 'ready URL is missing its launch token (?token=…)' }
  }
  return { ok: true, url }
}

function extractCookie(setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const pair = header.split(';', 1)[0]?.trim()
    if (pair?.startsWith(AUTH_COOKIE_PREFIX) && pair.includes('=')) return pair
  }
  return undefined
}

// Mirror of bootstrapAuth() in src/main/host-supervisor.ts.
async function bootstrapAuth(readyUrl) {
  const origin = readyUrl.origin
  const exchange = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  if (exchange.status !== 303) {
    fail(`token exchange returned HTTP ${exchange.status}, expected 303`)
    return undefined
  }
  const setCookie = typeof exchange.headers.getSetCookie === 'function'
    ? exchange.headers.getSetCookie()
    : [exchange.headers.get('set-cookie')].filter((v) => typeof v === 'string')
  const cookie = extractCookie(setCookie)
  if (!cookie) {
    fail('token exchange (303) did not return a dsh-auth-* Set-Cookie')
    return undefined
  }
  const probe = await fetch(`${origin}/`, { headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  if (probe.status !== 200) fail(`authenticated probe GET / returned HTTP ${probe.status}, expected 200`)
  return { origin, cookie }
}

async function expectUnauthenticatedApiFenced(origin) {
  const response = await fetch(`${origin}/api/session/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'contract-probe-anon', method: 'session/list', payload: { args: { _request: {} } } }),
    signal: AbortSignal.timeout(5_000),
  }).catch((error) => { fail(`unauthenticated /api/session/list did not answer: ${error?.message ?? String(error)}`); return undefined })
  if (response && response.status !== 401 && response.status !== 403) {
    fail(`unauthenticated /api/session/list returned HTTP ${response.status}, expected 401/403`)
  }
}

// host-bridge rpc(): named-args slash envelope over POST /api/<endpoint>.
async function expectSlashRpcEnvelope(origin, cookie) {
  const rpcId = randomUUID()
  const response = await fetch(`${origin}/api/session/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'session/list', payload: { args: { _request: {} } } }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) { fail(`authenticated RPC /api/session/list returned HTTP ${response.status}`); return }
  let envelope
  try { envelope = await response.json() } catch { fail('RPC /api/session/list did not return JSON'); return }
  if (envelope?.type !== 'server-response' || envelope.rpcId !== rpcId) {
    fail(`RPC envelope drift: expected {type:'server-response',rpcId}, got ${JSON.stringify(envelope).slice(0, 200)}`)
    return
  }
  const result = envelope.result
  if (!result || result.ok !== true) {
    fail(`RPC result drift: expected {ok:true,value}, got ${JSON.stringify(result).slice(0, 200)}`)
    return
  }
  if (!result.value || !Array.isArray(result.value.items)) {
    fail(`session/list value drift: expected {items:[]}, got ${JSON.stringify(result.value).slice(0, 200)}`)
  }
}

function openMux(wsOrigin, cookie) {
  return new WebSocket(`${wsOrigin}/api/remote.mux`, { handshakeTimeout: 5_000, headers: { Cookie: cookie } })
}

// The mux upgrade itself must be cookie-fenced.
function expectMuxRejectsAnonymous(wsOrigin) {
  return new Promise((resolveCheck) => {
    const socket = new WebSocket(`${wsOrigin}/api/remote.mux`, { handshakeTimeout: 5_000 })
    let settled = false
    const done = (ok, detail) => {
      if (settled) return
      settled = true
      if (ok) fail('remote.mux upgraded WITHOUT a cookie: the /api fence is gone')
      if (!ok && !/401|403/u.test(String(detail))) fail(`remote.mux anonymous upgrade was not rejected with 401/403: ${detail}`)
      try { socket.terminate() } catch { /* noop */ }
      resolveCheck()
    }
    socket.once('open', () => done(true))
    socket.once('unexpected-response', (_req, res) => done(false, `HTTP ${res.statusCode}`))
    socket.once('error', (error) => done(false, error?.message ?? String(error)))
  })
}

// Open a `$events` stream on the mux; the server's first item must be ready.
function expectEventsReady(socket) {
  return new Promise((resolveCheck) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      fail('remote.mux $events stream did not send a ready item within 8s')
      resolveCheck()
    }, 8_000)
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveCheck()
    }
    socket.on('message', (raw) => {
      if (settled) return
      let frame
      try { frame = JSON.parse(raw.toString()) } catch { return }
      if (frame?.type !== 'item' || frame.streamId !== streamId) return
      const value = frame.value
      if (!value || typeof value !== 'object') {
        fail(`$events ready frame drift: got ${JSON.stringify(frame.value).slice(0, 200)}`)
      } else if (value.type !== 'ready' || typeof value.clientId !== 'string') {
        fail(`$events first item drift: expected {type:'ready',clientId}, got ${JSON.stringify(value).slice(0, 200)}`)
      }
      done()
    })
    const streamId = randomUUID()
    socket.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }))
  })
}

try {
  console.log('[contract] booting staged DSH runtime with an isolated DSH_HOME…')
  const readyToken = await bootHost()
  console.log(`[contract] ready URL: ${readyToken}`)

  const parsed = parseReadyUrl(readyToken)
  if (!parsed.ok) {
    fail(parsed.reason)
    console.error('[contract] readiness URL contract failed; skipping channel probes')
  } else {
    const authed = await bootstrapAuth(parsed.url)
    if (authed) {
      const { origin, cookie } = authed
      const wsOrigin = origin.replace(/^http:/u, 'ws:')
      console.log(`[contract] origin: ${origin} (cookie auth established)`)

      await expectUnauthenticatedApiFenced(origin)
      await expectSlashRpcEnvelope(origin, cookie)
      await expectMuxRejectsAnonymous(wsOrigin)

      const socket = openMux(wsOrigin, cookie)
      await new Promise((resolveOpen, rejectOpen) => {
        const timer = setTimeout(() => rejectOpen(new Error('authenticated remote.mux upgrade timed out')), 5_000)
        socket.once('open', () => { clearTimeout(timer); resolveOpen() })
        socket.once('unexpected-response', (_req, res) => { clearTimeout(timer); rejectOpen(new Error(`remote.mux upgrade returned HTTP ${res.statusCode}`)) })
        socket.once('error', (error) => { clearTimeout(timer); rejectOpen(error) })
      })
      await expectEventsReady(socket)
      try { socket.terminate() } catch { /* noop */ }
    }
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
console.log('[contract] OK — readiness+token, cookie auth, slash RPC envelope, and remote.mux/$events all match the current host-bridge.')
