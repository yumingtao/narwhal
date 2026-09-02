// Install executor: spawn dsh plugin add, npx/pip install, git clone skill
// All subprocess spawning goes through here so logs can be streamed to the renderer.

import { spawn, type ChildProcess } from 'node:child_process'
import https from 'node:https'
import http from 'node:http'
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

export function getSkillDirs(dshHome: string): string[] {
  const roots = [
    path.join(os.homedir(), '.dsh', 'skills'),
    path.join(os.homedir(), '.config', 'narwhal', SKILLS_DIR_NAME),
    path.join(dshHome, SKILLS_DIR_NAME),
  ]
  return roots
}

export async function installSkillFromUrl(dshHome: string, url: string, log?: LogConsumer): Promise<InstallResult> {
  // Determine target dir
  const roots = getSkillDirs(dshHome)
  const targetDir = roots[1] // ~/.config/narwhal/narwhal-skills
  try { fs.mkdirSync(targetDir, { recursive: true }) } catch { /* ignore */ }

  // Case 1: raw SKILL.md URL (GitHub raw, etc.)
  if (/SKILL\.md$/i.test(url)) {
    const parsed = new URL(url)
    const transport = parsed.protocol === 'https:' ? https : http
    return new Promise((resolve) => {
      const skillName = path.basename(path.dirname(url)) || `skill-${Date.now()}`
      const destDir = path.join(targetDir, skillName)
      try { fs.mkdirSync(destDir, { recursive: true }) } catch { /* ignore */ }
      const outFile = path.join(destDir, 'SKILL.md')
      transport.get(url, { timeout: 10000 }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume()
          resolve({ ok: false, message: `HTTP ${res.statusCode} fetching ${url}` })
          return
        }
        const file = fs.createWriteStream(outFile)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve({ ok: true, message: `Skill installed to ${destDir}` })))
      }).on('error', (err: Error) => resolve({ ok: false, message: err.message }))
    })
  }

  // Case 2: Git repo (clone shallow, find SKILL.md files inside)
  if (/\.git$/i.test(url) || url.startsWith('https://github.com/')) {
    const exitCode = await run('git', ['clone', '--depth', '1', url, path.join(targetDir, `skill-${Date.now()}`)], {
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
  // id format: "custom:<dirname>"
  const parts = id.split(':')
  const dirName = parts[1] ?? id
  const roots = getSkillDirs(dshHome)
  for (const root of roots) {
    const candidate = path.join(root, dirName)
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
