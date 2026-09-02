// Install executor: spawn dsh plugin add, npx/pip install, git clone skill
// All subprocess spawning goes through here so logs can be streamed to the renderer.

import { spawn, type ChildProcess } from 'node:child_process'
import https from 'node:https'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import type { InstalledPlugin, InstallResult, McpServer } from '../shared/desktop-contract.js'

export type LogConsumer = (line: string) => void

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  log?: LogConsumer
  timeoutMs?: number
}

function run(cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<number> {
  return new Promise((resolve) => {
    let proc: ChildProcess
    try {
      proc = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      opts.log?.(`[executor] Failed to spawn ${cmd}: ${err instanceof Error ? err.message : err}`)
      resolve(1)
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill('SIGTERM')
        opts.log?.(`[executor] Timeout after ${opts.timeoutMs}ms, killing ${cmd}`)
      }, opts.timeoutMs)
    }

    proc.stdout?.on('data', (buf) => {
      const text = buf.toString('utf8').trim()
      if (text) for (const line of text.split(/\r?\n/)) opts.log?.(line)
    })
    proc.stderr?.on('data', (buf) => {
      const text = buf.toString('utf8').trim()
      if (text) for (const line of text.split(/\r?\n/)) opts.log?.(line)
    })
    proc.on('error', (err) => {
      opts.log?.(`[executor] Process error: ${err.message}`)
      if (timer) clearTimeout(timer)
      resolve(1)
    })
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer)
      opts.log?.(`[executor] ${cmd} exited ${code ?? 'null'}`)
      resolve(code ?? 1)
    })
  })
}

// ---------------------------------------------------------------------------
// DSH Bundle plugin install/uninstall
// ---------------------------------------------------------------------------

export async function installBundlePlugin(dshHome: string, runtimeRoot: string, profile: string, packageName: string, log?: LogConsumer): Promise<InstallResult> {
  const profileNodeModules = path.join(dshHome, 'profiles', profile, 'node_modules')
  if (!fs.existsSync(profileNodeModules)) {
    return { ok: false, message: `Profile node_modules not found at ${profileNodeModules}` }
  }
  const exitCode = await run('dsh', ['plugin', '--profile', profile, 'add', packageName], {
    cwd: runtimeRoot,
    env: { DSH_HOME: dshHome },
    log,
    timeoutMs: 120_000,
  })
  if (exitCode !== 0) {
    return { ok: false, message: `dsh plugin add failed with code ${exitCode}` }
  }
  return { ok: true, message: `${packageName} installed successfully` }
}

export async function uninstallBundlePlugin(dshHome: string, runtimeRoot: string, profile: string, packageName: string, log?: LogConsumer): Promise<InstallResult> {
  const exitCode = await run('dsh', ['plugin', '--profile', profile, 'remove', packageName], {
    cwd: runtimeRoot,
    env: { DSH_HOME: dshHome },
    log,
    timeoutMs: 60_000,
  })
  if (exitCode !== 0) {
    return { ok: false, message: `dsh plugin remove failed with code ${exitCode}` }
  }
  return { ok: true, message: `${packageName} uninstalled successfully` }
}

export function listInstalledBundlePlugins(dshHome: string, profile: string): InstalledPlugin[] {
  const seen = new Set<string>()
  const result: InstalledPlugin[] = []
  const scanDirs = [
    path.join(dshHome, 'profiles', profile, 'node_modules'),
    path.join(dshHome, 'profiles', 'node_modules'),
  ]

  // Helper: resolve symlinks — DSH node_modules uses symlinks extensively
  function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory() } catch { return false }
  }

  for (const profileDir of scanDirs) {
    if (!fs.existsSync(profileDir)) continue
    try {
      const entries = fs.readdirSync(profileDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.pnpm' || entry.name === '.cache') continue
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const pkgDir = path.join(profileDir, entry.name)
        if (!isDir(pkgDir)) continue

        // Handle scoped packages: @scope/name
        if (entry.name.startsWith('@')) {
          const scopeDir = pkgDir
          if (!fs.existsSync(scopeDir)) continue
          const subEntries = fs.readdirSync(scopeDir, { withFileTypes: true })
          for (const sub of subEntries) {
            if (!sub.isDirectory() && !sub.isSymbolicLink()) continue
            const subDir = path.join(scopeDir, sub.name)
            if (!isDir(subDir)) continue
            const info = readPluginPkgInfo(subDir)
            if (info && !seen.has(info.packageName)) { seen.add(info.packageName); result.push(info) }
          }
          continue
        }
        const info = readPluginPkgInfo(pkgDir)
        if (info && !seen.has(info.packageName)) { seen.add(info.packageName); result.push(info) }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return result
}

function readPluginPkgInfo(pkgDir: string): InstalledPlugin | null {
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  try {
    if (!fs.existsSync(pkgJsonPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    // Only accept packages that explicitly declare DSH bundle metadata
    const hasBundle = !!pkg.dsh?.bundle || !!pkg.dshBundle
    const hasPluginKeyword = Array.isArray(pkg.keywords) && pkg.keywords.some((k: string) =>
      typeof k === 'string' && k.toLowerCase() === 'dsh-plugin'
    )
    // Named narwhal/internal packages are always plugins we deploy ourselves
    const pkgName: string = pkg.name ?? path.basename(pkgDir)
    const isNarwhalInternal = pkgName.startsWith('@narwhal/')
    if (!hasBundle && !hasPluginKeyword && !isNarwhalInternal) return null
    return {
      packageName: pkgName,
      version: pkg.version ?? 'unknown',
      enabled: true,
      location: pkgDir,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// MCP server install/uninstall
// ---------------------------------------------------------------------------

export function installMcpServerToConfig(
  mcpServers: McpServer[],
  server: McpServer,
): { next: McpServer[]; wasNew: boolean } {
  const existingIdx = mcpServers.findIndex((s) => s.serverName === server.serverName)
  if (existingIdx >= 0) {
    const next = [...mcpServers]
    next[existingIdx] = server
    return { next, wasNew: false }
  }
  return { next: [...mcpServers, server], wasNew: true }
}

export function uninstallMcpServerFromConfig(mcpServers: McpServer[], serverName: string): { next: McpServer[]; wasRemoved: boolean } {
  const idx = mcpServers.findIndex((s) => s.serverName === serverName)
  if (idx < 0) return { next: mcpServers, wasRemoved: false }
  return { next: mcpServers.filter((_, i) => i !== idx), wasRemoved: true }
}

export function buildMcpServerFromCard(args: {
  serverName: string
  packageName: string
  packageType: 'npm' | 'python' | 'docker'
  envVars?: Record<string, string>
}): McpServer {
  switch (args.packageType) {
    case 'npm':
      return {
        serverName: args.serverName,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', args.packageName],
        env: args.envVars,
      }
    case 'python':
      return {
        serverName: args.serverName,
        transport: 'stdio',
        command: 'uvx',
        args: [args.packageName],
        env: args.envVars,
      }
    case 'docker':
      return {
        serverName: args.serverName,
        transport: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', args.packageName],
        env: args.envVars,
      }
  }
}

// ---------------------------------------------------------------------------
// Skill install (from git clone or direct SKILL.md URL)
// ---------------------------------------------------------------------------

const SKILLS_DIR_NAME = 'narwhal-skills'

// Hosts allowed for skill fetch (prevents SSRF to internal services)
const ALLOWED_SKILL_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
])

function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (!hostname) return true
  // Strip trailing dot
  const h = hostname.replace(/\.$/u, '')
  // Allow localhost and IPv6 variants
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true
  // Link-local
  if (h.startsWith('169.254.')) return true
  // Private ranges (best-effort; for real IPs we do exact checks below)
  const octets = h.split('.')
  if (octets.length === 4) {
    const [a, b] = octets.map(Number)
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

function isValidSkillHost(hostname: string): boolean {
  if (!hostname) return false
  if (isPrivateOrLoopbackHost(hostname)) return false
  // Check against explicit allow list
  return ALLOWED_SKILL_HOSTS.has(hostname)
}

// Skill directory whitelist: only allow safe path segment names
const SAFE_DIRNAME = /^[A-Za-z0-9_-]{1,80}$/u

export function getSkillDirs(dshHome: string): string[] {
  const roots = [
    path.join(os.homedir(), '.dsh', 'skills'),
    path.join(os.homedir(), '.config', 'narwhal', SKILLS_DIR_NAME),
    path.join(dshHome, SKILLS_DIR_NAME),
  ]
  return roots
}

function resolveSkillDir(root: string, dirName: string): string | null {
  // Whitelist the dirName; reject anything that could escape via `..`
  if (!SAFE_DIRNAME.test(dirName)) return null
  const candidate = path.join(root, dirName)
  const resolved = path.resolve(candidate)
  const rootResolved = path.resolve(root)
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) return null
  return resolved
}

export async function installSkillFromUrl(dshHome: string, url: string, log?: LogConsumer): Promise<InstallResult> {
  // Validate URL first
  let parsed: URL
  try { parsed = new URL(url) } catch { return { ok: false, message: 'Invalid URL' } }

  // Block http://, file://, and other dangerous protocols
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'Only https:// URLs are supported for skill installation' }
  }
  if (!isValidSkillHost(parsed.hostname)) {
    return { ok: false, message: `Host "${parsed.hostname}" is not allowed` }
  }

  // Determine target dir — use dshHome-specific path (M7 fix)
  const roots = getSkillDirs(dshHome)
  const targetDir = roots[2] // <dshHome>/narwhal-skills
  try { fs.mkdirSync(targetDir, { recursive: true }) } catch { /* ignore */ }

  // Case 1: raw SKILL.md URL
  if (/SKILL\.md$/i.test(parsed.pathname)) {
    // Derive safe skill name from URL path — use URL parsing, not Node path (M2 fix)
    const segments = parsed.pathname.split('/').filter(Boolean)
    // Find the directory containing SKILL.md
    const skillNameCandidate = segments.length >= 2 ? segments[segments.length - 2] : null
    const skillName = (skillNameCandidate && SAFE_DIRNAME.test(skillNameCandidate))
      ? skillNameCandidate
      : `skill-${Date.now()}`

    const destDir = resolveSkillDir(targetDir, skillName)
    if (!destDir) return { ok: false, message: 'Invalid skill directory name' }
    try { fs.mkdirSync(destDir, { recursive: true }) } catch { /* ignore */ }
    const outFile = path.join(destDir, 'SKILL.md')

    return new Promise((resolve) => {
      const file = fs.createWriteStream(outFile)
      const req = https.get(url, { timeout: 15000 }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume()
          resolve({ ok: false, message: `HTTP ${res.statusCode} fetching ${url}` })
          return
        }
        // Enforce max file size (5MB) for security (m2 fix)
        let received = 0
        const MAX_SKILL_SIZE = 5 * 1024 * 1024
        res.on('data', (chunk) => {
          received += chunk.length
          if (received > MAX_SKILL_SIZE) {
            res.destroy()
            file.destroy()
            try { fs.rmSync(outFile, { force: true }) } catch { /* best-effort cleanup */ }
            resolve({ ok: false, message: 'SKILL.md exceeds 5MB limit' })
          }
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve({ ok: true, message: `Skill installed to ${destDir}` })))
      })
      // Handle transport-level errors (DNS failure, connection reset, etc.)
      req.on('error', (err: Error) => {
        file.destroy()
        try { fs.rmSync(outFile, { force: true }) } catch { /* best-effort cleanup */ }
        resolve({ ok: false, message: err.message })
      })
      // Handle timeouts
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, message: 'Request timed out' })
      })
    })
  }

  // Case 2: Git repo — use hostname validation (M3 fix)
  if (/\.git$/i.test(parsed.pathname) || parsed.hostname === 'github.com') {
    const cloneDir = resolveSkillDir(targetDir, `skill-${Date.now()}`)
    if (!cloneDir) return { ok: false, message: 'Invalid clone directory' }
    const exitCode = await run('git', ['clone', '--depth', '1', url, cloneDir], {
      log, timeoutMs: 60_000,
    })
    if (exitCode !== 0) {
      return { ok: false, message: `git clone failed with code ${exitCode}` }
    }
    return { ok: true, message: 'Skill repository cloned successfully' }
  }

  return { ok: false, message: `Unrecognized skill URL: ${url}` }
}

export function removeSkillById(dshHome: string, id: string): InstallResult {
  // id format: "custom:<dirname>" or "<dirname>"
  const parts = id.split(':')
  const dirName = parts[1] ?? id

  // Whitelist dirName to prevent path traversal (C3 fix)
  if (!SAFE_DIRNAME.test(dirName)) {
    return { ok: false, message: `Invalid skill id: "${id}"` }
  }

  const roots = getSkillDirs(dshHome)
  for (const root of roots) {
    const candidate = resolveSkillDir(root, dirName)
    if (!candidate) continue
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'SKILL.md'))) {
      try {
        fs.rmSync(candidate, { recursive: true, force: true })
        return { ok: true, message: `Removed skill from ${candidate}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
  return { ok: false, message: `Skill "${id}" not found` }
}
