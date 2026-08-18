import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(process.env.DSH_RUNTIME_SOURCE ?? join(root, '..', 'DeepSeek-Harness'))
const target = resolve(root, 'runtime/dsh')
const stageName = 'desktop-runtime-staging'
const stageDirectory = join(source, 'apps', stageName)
const textSuffixes = ['.cjs', '.js', '.json', '.map', '.mjs']

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: source, env: { ...process.env, CI: 'true' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`runtime staging failed (${code === null ? `signal ${String(signal)}` : `exit ${String(code)}`}): ${command} ${args.join(' ')}`))
    })
  })
}

async function collectWorkspacePackages() {
  const roots = ['apps', 'packages', 'vendor']
  const dependencies = {}
  const sources = new Map()
  for (const packageRoot of roots) {
    const absoluteRoot = join(source, packageRoot)
    for await (const path of walkPackages(absoluteRoot)) {
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
        dependencies[manifest.name] = 'workspace:^'
        sources.set(manifest.name, dirname(path))
      }
    }
  }
  return { dependencies, sources }
}

async function* walkPackages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === 'package.json') yield path
    else if (entry.isDirectory()) yield* walkPackages(path)
  }
}

async function findSymlink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeLinks() {
  const nodeModules = join(target, 'node_modules')
  for (let link = await findSymlink(nodeModules); link !== undefined; link = await findSymlink(nodeModules)) {
    const segments = relative(nodeModules, link).split(sep)
    const bin = segments.lastIndexOf('.bin')
    if (bin >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, bin + 1)), { recursive: true, force: true })
      continue
    }
    const linkedSource = await realpath(link)
    await rm(link, { recursive: true, force: true })
    await cp(linkedSource, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(linkedSource, 'node_modules') && !path.startsWith(join(linkedSource, 'node_modules') + sep),
    })
  }
}

async function restoreDirectWorkspacePackages(sources) {
  for (const [name, packageSource] of sources) {
    const destination = join(target, 'node_modules', ...name.split('/'))
    if (existsSync(destination)) continue
    await mkdir(dirname(destination), { recursive: true })
    await cp(packageSource, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(packageSource, 'node_modules') && !path.startsWith(join(packageSource, 'node_modules') + sep),
    })
  }
}

async function removeBuildMachinePaths(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await removeBuildMachinePaths(path)
      continue
    }
    if (!entry.isFile() || !textSuffixes.some(suffix => entry.name.endsWith(suffix))) continue
    const contents = await readFile(path, 'utf8')
    const sanitized = contents.replaceAll(source, '.')
    if (sanitized !== contents) await writeFile(path, sanitized)
  }
}

if (!existsSync(join(source, 'pnpm-workspace.yaml'))) {
  throw new Error(`DSH_RUNTIME_SOURCE is not a DeepSeek Harness workspace: ${source}`)
}
if (existsSync(stageDirectory)) {
  throw new Error(`Refusing to overwrite an existing source directory: ${stageDirectory}`)
}

await rm(target, { recursive: true, force: true })
await mkdir(stageDirectory, { recursive: true })
try {
  const workspacePackages = await collectWorkspacePackages()
  await writeFile(join(stageDirectory, 'package.json'), `${JSON.stringify({
    name: '@dsh-desktop/runtime-staging',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: workspacePackages.dependencies,
  }, null, 2)}\n`)
  await run('pnpm', [
    '--config.verify-deps-before-run=false', '--filter', '@dsh-desktop/runtime-staging', 'deploy', '--legacy', '--prod',
    '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--config.link-workspace-packages=true',
    '--config.allow-unused-patches=true', target,
  ])
  await materializeLinks()
  await restoreDirectWorkspacePackages(workspacePackages.sources)
  await removeBuildMachinePaths(target)
  const entry = join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const frontend = join(target, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
  if (!existsSync(entry) || !existsSync(frontend)) {
    throw new Error('The staged runtime is incomplete: DSH CLI or Web frontend is missing.')
  }
  console.log(`Closed DSH runtime staged at ${target}`)
} finally {
  await rm(stageDirectory, { recursive: true, force: true })
}
