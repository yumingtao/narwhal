import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'runtime/dsh')
const runtimeManifestPath = join(root, 'runtime', 'manifest.json')
const textSuffixes = ['.cjs', '.js', '.json', '.map', '.mjs']

// ── Entry: detect source mode ────────────────────────────────────────────────
const sourceArg = process.env.DSH_RUNTIME_SOURCE ?? ''

if (sourceArg.startsWith('npm@')) {
  // npm mode: install @deepseek-ai/dsh from the public npm registry
  const version = sourceArg.slice(4).trim() // "npm@0.1.1-rc.2" → "0.1.1-rc.2"
  await stageFromNpm(version)
  process.exit(0)
}

// Legacy: source mode — default when DSH_RUNTIME_SOURCE is empty or a local path
const source = resolve(sourceArg || join(root, '..', 'DeepSeek-Harness'))
const stageName = 'desktop-runtime-staging'
const stageDirectory = join(source, 'apps', stageName)

// ── npm-mode runtime staging ─────────────────────────────────────────────────
async function stageFromNpm(version) {
  console.log(`[narwhal] staging DSH runtime from npm: @deepseek-ai/dsh@${version}`)

  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  // 1. Initialize a minimal package.json + install with hoisted modules
  await writeFile(join(target, 'package.json'), JSON.stringify({
    name: 'narwhal-dsh-runtime',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@deepseek-ai/dsh': version,
    },
  }, null, 2) + '\n')

  await runInDir(target, 'pnpm', [
    'install',
    '--no-frozen-lockfile',
    '--ignore-workspace',      // don't inherit parent narwhal pnpm-workspace.yaml
    '--ignore-scripts',        // skip native builds (node-pty, koffi etc.)
    '--shamefully-hoist=true', // hoist ALL transitive deps to top-level node_modules
  ])

  // 2. Prune unused heavy dependencies (codex, claude SDK, telemetry)
  const nodeModules = join(target, 'node_modules')
  await pruneUnusedDependencies(nodeModules)

  // 3. Resolve the actual installed version from node_modules
  const dshPkg = JSON.parse(await readFile(join(nodeModules, '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  const pkgVersion = dshPkg.version

  // 4. Verify critical entry points exist
  const entry = join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const frontend = join(nodeModules, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
  if (!existsSync(entry) || !existsSync(frontend)) {
    throw new Error(`Staged runtime is incomplete.\n  bin.js: ${existsSync(entry) ? 'OK' : 'MISSING'}\n  frontend: ${existsSync(frontend) ? 'OK' : 'MISSING'}`)
  }
  console.log(`  bin.js:      ${relative(target, entry)}`)
  console.log(`  frontend:    ${relative(target, frontend)}`)

  // 5. Update manifest.json with the resolved version
  await updateManifest(pkgVersion)
  console.log(`[narwhal] DSH runtime staged at ${target} (v${pkgVersion})`)
}

async function updateManifest(dshVersion) {
  if (!existsSync(runtimeManifestPath)) return
  const manifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8'))
  if (manifest.dshVersion === dshVersion) return // no change
  manifest.dshVersion = dshVersion
  await writeFile(runtimeManifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`  manifest.json → dshVersion = ${dshVersion}`)
}

function runInDir(dir, command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: dir, env: { ...process.env, CI: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`npm staging failed (${code === null ? `signal ${String(signal)}` : `exit ${String(code)}`}): ${command} ${args.join(' ')}`))
    })
  })
}

function runCapture(command, args, dir) {
  return new Promise((resolveRun, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, { cwd: dir, env: process.env })
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} failed (${code ?? signal}): ${stderr}`))
    })
  })
}

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

async function pruneUnusedDependencies(directory) {
  // Packages that are not needed at runtime in the desktop app.
  // These are either optional agents (codex/claude binaries), dev tools,
  // or telemetry that makes no sense in a packaged local app.
  const pruneList = [
    '@openai/codex',
    '@openai/codex-darwin-arm64',
    '@openai/codex-darwin-x64',
    '@openai/codex-linux-arm64',
    '@openai/codex-linux-x64',
    '@openai/codex-win32-x64',
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    '@anthropic-ai/claude-agent-sdk-darwin-x64',
    '@anthropic-ai/claude-agent-sdk-linux-arm64',
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-win32-x64',
    'typescript',
    'vite',
  ]
  const scopes = new Set(['opentelemetry', 'opentelemetry-contrib'])
  let removed = 0
  for (const pkg of pruneList) {
    const path = join(directory, 'node_modules', ...pkg.split('/'))
    if (existsSync(path)) {
      await rm(path, { recursive: true, force: true })
      removed++
    }
  }
  const nodeModules = join(directory, 'node_modules')
  if (existsSync(nodeModules)) {
    for (const scopeDir of await readdir(nodeModules, { withFileTypes: true })) {
      if (!scopeDir.isDirectory() || !scopeDir.name.startsWith('@')) continue
      const scopeName = scopeDir.name.slice(1)
      if (scopes.has(scopeName)) {
        await rm(join(nodeModules, scopeDir.name), { recursive: true, force: true })
        removed++
      }
    }
  }
  if (removed > 0) console.log(`Pruned ${removed} unused dependency paths`)
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
  await pruneUnusedDependencies(target)
  const entry = join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const frontend = join(target, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
  if (!existsSync(entry) || !existsSync(frontend)) {
    throw new Error('The staged runtime is incomplete: DSH CLI or Web frontend is missing.')
  }
  console.log(`Closed DSH runtime staged at ${target}`)
} finally {
  await rm(stageDirectory, { recursive: true, force: true })
}
