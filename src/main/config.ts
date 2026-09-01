import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

export function getDshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
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
  const merged: NarwhalConfig = { ...current, ...patch }

  // Deep-merge providers so we don't overwrite unchanged provider sections
  if (patch.providers) {
    merged.providers = { ...current.providers, ...patch.providers }
  }

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
