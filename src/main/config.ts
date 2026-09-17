import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { configSchema, defaultConfig, type NarwhalConfig, CONFIG_VERSION } from '../shared/config-schema.js'
import { migrateFromDsh, syncDshConfig } from './dsh-sync.js'

// ── Paths ──────────────────────────────────────────────────────────────────

export function getConfigPath(): string {
  const configDir = process.env.NARWHAL_CONFIG_DIR ?? join(homedir(), '.config', 'narwhal')
  return join(configDir, 'config.json')
}

/**
 * DSH runtime home — where DSH stores sessions, profiles, settings.yaml, etc.
 * Lives under ~/.narwhal to align with the app name, not under Electron userData.
 */
export function getDshHome(): string {
  return join(homedir(), '.narwhal')
}

// ── Migration ───────────────────────────────────────────────────────────────

/**
 * Migrate legacy DSH data from Electron userData/dsh-home → ~/.narwhal.
 * No-op if legacy dir doesn't exist. Safe to call repeatedly.
 */
export async function migrateLegacyDshHome(): Promise<void> {
  const legacy = join(app.getPath('userData'), 'dsh-home')
  const target = getDshHome()

  const legacyExists = existsSync(legacy)
  if (!legacyExists) {
    await mkdir(target, { recursive: true, mode: 0o700 })
    return
  }

  const targetExists = existsSync(target)
  if (targetExists) {
    // Both present — target wins. Leave legacy for manual cleanup to avoid data loss.
    console.warn('[narwhal] migrateLegacyDshHome: both legacy (', legacy, ') and target (', target, ') exist. Keeping target, legacy left for manual cleanup.')
    return
  }

  // Move: try atomic rename first, fall back to entry-by-entry
  try {
    await rename(legacy, target)
    console.log('[narwhal] migrateLegacyDshHome:', legacy, '→', target)
  } catch (e) {
    console.warn('[narwhal] migrateLegacyDshHome: rename failed, falling back:', e instanceof Error ? e.message : String(e))
    await mkdir(target, { recursive: true, mode: 0o700 })
    for (const entry of await readdir(legacy)) {
      await rename(join(legacy, entry), join(target, entry))
    }
    await rm(legacy, { recursive: true, force: true })
    console.log('[narwhal] migrateLegacyDshHome: migrated contents of', legacy, '→', target)
  }
}

// ── Singleton store ─────────────────────────────────────────────────────────

let cachedConfig: NarwhalConfig | undefined
let loadError: string | undefined

export function getConfig(): NarwhalConfig {
  return cachedConfig ?? defaultConfig
}

export function getLoadError(): string | undefined {
  return loadError
}

// ── Read / write ────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<NarwhalConfig> {
  const configPath = getConfigPath()

  try {
    // First run: migrate from DSH settings.yaml → config.json
    const configExists = existsSync(configPath)
    if (!configExists) {
      const dshHome = getDshHome()
      const migrated = await migrateFromDsh(configPath, dshHome)
      cachedConfig = migrated
      loadError = undefined
      return cachedConfig
    }

    // Existing config — load and validate
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)

    // Old v1 or unversioned config → also needs migration (merge with DSH)
    const isLegacy = !parsed.version || (parsed.version !== CONFIG_VERSION)

    if (isLegacy) {
      const dshHome = getDshHome()
      const migrated = await migrateFromDsh(configPath, dshHome)
      cachedConfig = migrated
      loadError = undefined
      return cachedConfig
    }

    const result = configSchema.safeParse(parsed)
    if (!result.success) {
      loadError = `Config validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      cachedConfig = { ...defaultConfig }
      return cachedConfig
    }

    cachedConfig = result.data
    loadError = undefined
    return cachedConfig
  } catch (error) {
    loadError = `Failed to load config: ${error instanceof Error ? error.message : String(error)}`
    cachedConfig = { ...defaultConfig }
    return cachedConfig
  }
}

export async function saveConfig(patch: Partial<NarwhalConfig>): Promise<NarwhalConfig> {
  const current = getConfig()
  // Shallow spread — providers/mcpServers/etc. passed by callers are already
  // complete target states. Do NOT deep-merge here or deletions silently
  // resurrect entries from the cached config.
  const merged: NarwhalConfig = { ...current, ...patch }

  const result = configSchema.safeParse(merged)
  if (!result.success) {
    throw new Error(`Config validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }

  cachedConfig = result.data

  try {
    const configPath = getConfigPath()
    const configDir = join(configPath, '..')
    if (!existsSync(configDir)) await mkdir(configDir, { recursive: true })
    await writeFile(configPath, JSON.stringify(cachedConfig, null, 2) + '\n', 'utf-8')
  } catch (error) {
    console.warn('[narwhal] saveConfig: failed to persist to disk:', error instanceof Error ? error.message : String(error))
  }
  return cachedConfig
}

// ── Sync to DSH ────────────────────────────────────────────────────────────

/**
 * After loadConfig(), call this to regenerate DSH's settings.yaml and
 * cordis.patch.yml from the authoritative config.json.
 * Must run BEFORE the DSH process is spawned.
 */
export async function syncToDsh(): Promise<void> {
  const cfg = getConfig()
  const configPath = getConfigPath()
  const dshHome = getDshHome()

  const result = await syncDshConfig(cfg, configPath, dshHome)
  console.log(`[narwhal] syncDshConfig: ${result.providerCount} providers, ${result.mcpCount} MCP servers, skills=${result.skillsEnabled ? 'enabled' : 'disabled'}`)
  console.log(`[narwhal]   → ${result.settingsYaml}`)
  console.log(`[narwhal]   → ${result.cordisPatchYaml}`)
}
