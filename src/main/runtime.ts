import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { configSchema, type RuntimeConfig } from '../shared/config-schema.js'

interface RuntimeManifest {
  readonly upstreamCommit: string
  readonly dshVersion: string
  readonly supportedPlatform: string
}

export interface DshRuntime {
  readonly root: string
  readonly cliEntry: string
  readonly launchArguments: readonly string[]
  readonly nodeExecutable: string
  readonly manifest: RuntimeManifest
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

function readManifest(projectRoot: string): RuntimeManifest {
  const manifestPath = app.isPackaged
    ? join(app.getAppPath(), 'runtime', 'manifest.json')
    : join(projectRoot, 'runtime', 'manifest.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeManifest
}

/**
 * Load user config.json (if it exists) so we can read runtime overrides.
 * Returns undefined on any failure (missing file, parse error, schema error).
 * resolveRuntime() then falls through to env vars → auto-discovery.
 */
function tryLoadRuntimeConfig(): RuntimeConfig | undefined {
  try {
    const configDir = app.getPath('userData')
    const configPath = join(configDir, 'config.json')
    if (!existsSync(configPath)) return undefined
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    const parsed = configSchema.safeParse(raw)
    if (!parsed.success) return undefined
    return parsed.data.runtime
  } catch {
    return undefined
  }
}

/**
 * Resolve the DSH runtime. Priority chain (dev):
 *   1. Packaged build          → process.resourcesPath/runtime/dsh (fixed)
 *   2. config.json runtime.*   → user's explicit choice
 *   3. DSH_RUNTIME_ROOT env    → emergency override
 *   4. Auto-discover           → projectRoot/runtime/dsh first, then ../DeepSeek-Harness
 *
 * Mode detection (how to boot):
 *   - config.json runtime.mode (explicit)
 *   - DSH_RUNTIME_MODE env     (explicit)
 *   - Auto: if root/node_modules/@deepseek-ai/dsh/lib/bin.js exists → deployed
 *           if root/apps/cli/src/bin.ts exists → source
 *
 * Node executable resolution:
 *   - config.json runtime.nodeExecutable
 *   - DSH_NODE_EXECUTABLE env
 *   - process.execPath (Electron node) — safe default
 */
export function resolveRuntime(): DshRuntime {
  const projectRoot = resolve(moduleDirectory, '..', '..')

  // ── 1. Runtime root ─────────────────────────────────────────────────────
  let runtimeRoot: string
  let source: string // for error messages / logging

  if (app.isPackaged) {
    runtimeRoot = join(process.resourcesPath, 'runtime', 'dsh')
    source = 'packaged'
  } else {
    const cfgRuntime = tryLoadRuntimeConfig()

    // Priority order
    const candidates: Array<{ root: string; source: string }> = []
    if (cfgRuntime?.root) candidates.push({ root: resolve(cfgRuntime.root), source: 'config.json runtime.root' })
    if (process.env.DSH_RUNTIME_ROOT !== undefined && process.env.DSH_RUNTIME_ROOT !== '')
      candidates.push({ root: resolve(process.env.DSH_RUNTIME_ROOT), source: 'DSH_RUNTIME_ROOT env' })
    // Auto-discover: runtime/dsh (npm install) first, then ../DeepSeek-Harness (source)
    candidates.push({ root: join(projectRoot, 'runtime', 'dsh'), source: 'auto-discovered: runtime/dsh' })
    candidates.push({ root: join(projectRoot, '..', 'DeepSeek-Harness'), source: 'auto-discovered: ../DeepSeek-Harness' })

    // Pick the first candidate that has *either* a deployed bin.js or a source bin.ts
    const hasBin = (r: string) =>
      existsSync(join(r, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      || existsSync(join(r, 'apps', 'cli', 'src', 'bin.ts'))

    const picked = candidates.find((c) => hasBin(c.root))
    if (!picked) {
      const tried = candidates.map((c) => `  ${c.source}: ${c.root}`).join('\n')
      throw new Error(
        `DSH runtime not found. Tried:\n${tried}\n`
        + `Create runtime/dsh via 'pnpm stage:runtime' or clone DeepSeek-Harness as sibling, `
        + `or set config.json runtime.root / DSH_RUNTIME_ROOT.`,
      )
    }
    runtimeRoot = picked.root
    source = picked.source
  }

  // ── 2. Boot mode ────────────────────────────────────────────────────────
  const cfgRuntime = tryLoadRuntimeConfig()
  const explicitMode = cfgRuntime?.mode ?? process.env.DSH_RUNTIME_MODE
  const hasDeployedBin = existsSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  const hasSourceBin = existsSync(join(runtimeRoot, 'apps', 'cli', 'src', 'bin.ts'))

  let usesDeployedRuntime: boolean
  if (app.isPackaged) {
    usesDeployedRuntime = true
  } else if (explicitMode === 'deployed') {
    if (!hasDeployedBin) throw new Error(`config.json runtime.mode=deployed but ${runtimeRoot} has no deployed bin.js`)
    usesDeployedRuntime = true
  } else if (explicitMode === 'source') {
    if (!hasSourceBin) throw new Error(`config.json runtime.mode=source but ${runtimeRoot} has no source bin.ts`)
    usesDeployedRuntime = false
  } else {
    // Auto: prefer deployed (npm) over source
    if (hasDeployedBin) usesDeployedRuntime = true
    else if (hasSourceBin) usesDeployedRuntime = false
    else throw new Error(`No DSH cli entry found under ${runtimeRoot}`)
  }

  const cliEntry = usesDeployedRuntime
    ? join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : join(runtimeRoot, 'apps', 'cli', 'src', 'bin.ts')

  // ── 3. Node executable ──────────────────────────────────────────────────
  const nodeExecutable = cfgRuntime?.nodeExecutable
    ?? process.env.DSH_NODE_EXECUTABLE
    ?? process.execPath

  // ── 4. Launch arguments ─────────────────────────────────────────────────
  const launchArguments = usesDeployedRuntime
    ? ['--expose-internals', cliEntry]
    : ['--import', 'tsx/esm', cliEntry]

  console.log(`[narwhal] resolveRuntime: root=${runtimeRoot} (${source}) mode=${usesDeployedRuntime ? 'deployed' : 'source'} node=${nodeExecutable}`)
  return { root: runtimeRoot, cliEntry, launchArguments, nodeExecutable, manifest: readManifest(projectRoot) }
}
