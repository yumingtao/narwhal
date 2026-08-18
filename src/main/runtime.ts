import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

interface RuntimeManifest {
  readonly upstreamCommit: string
  readonly dshVersion: string
  readonly supportedPlatform: string
}

export interface DshRuntime {
  readonly root: string
  readonly cliEntry: string
  readonly launchArguments: readonly string[]
  readonly manifest: RuntimeManifest
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

function readManifest(projectRoot: string): RuntimeManifest {
  // Electron's packaged app path is authoritative; import.meta.url can point at an
  // unpacked source map in some direct-launch and debugger configurations.
  const manifestPath = app.isPackaged
    ? join(app.getAppPath(), 'runtime', 'manifest.json')
    : join(projectRoot, 'runtime', 'manifest.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeManifest
}

/** Resolve the DSH runtime without allowing the renderer to supply a filesystem path. */
export function resolveRuntime(): DshRuntime {
  const projectRoot = resolve(moduleDirectory, '..', '..')
  const usesDeployedRuntime = app.isPackaged || process.env.DSH_RUNTIME_MODE === 'deployed'
  const runtimeRoot = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'dsh')
    : (process.env.DSH_RUNTIME_ROOT === undefined
        ? resolve(projectRoot, '..', 'DeepSeek-Harness')
        : resolve(process.env.DSH_RUNTIME_ROOT))
  const cliEntry = usesDeployedRuntime
    ? join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : join(runtimeRoot, 'apps', 'cli', 'src', 'bin.ts')
  if (!existsSync(cliEntry)) {
    throw new Error(`The DSH runtime is not ready at ${runtimeRoot}. ${usesDeployedRuntime ? 'Stage a closed DSH runtime before packaging.' : 'Run pnpm install in the pinned Harness checkout before starting DSH Desktop.'}`)
  }
  const launchArguments = usesDeployedRuntime
    ? ['--expose-internals', cliEntry]
    : ['--import', 'tsx/esm', cliEntry]
  return { root: runtimeRoot, cliEntry, launchArguments, manifest: readManifest(projectRoot) }
}
