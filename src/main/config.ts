import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { configSchema, defaultConfig, generateConfigTemplate, type NarwhalConfig } from '../shared/config-schema.js'

// ── Config path ─────────────────────────────────────────────────────────────

/**
 * Resolve the narwhal config directory.
 *
 * Production: ~/.config/narwhal/config.json  (XDG-style)
 * Dev (--user-data-dir set): <userData>/config.json
 *
 * We use XDG-style so the config is user-visible and can be shared across
 * machines via dotfiles, independent of the Electron app's own userData
 * directory (which stores session/workbench state).
 */
export function getConfigPath(): string {
  const configDir = process.env.NARWHAL_CONFIG_DIR ?? join(homedir(), '.config', 'narwhal')
  return join(configDir, 'config.json')
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
    if (!existsSync(configPath)) {
      await ensureConfigCreated(configPath)
      cachedConfig = { ...defaultConfig }
      loadError = undefined
      return cachedConfig
    }

    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
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

  const configPath = getConfigPath()
  const configDir = join(configPath, '..')
  if (!existsSync(configDir)) await mkdir(configDir, { recursive: true })

  await writeFile(configPath, JSON.stringify(cachedConfig, null, 2) + '\n', 'utf-8')
  return cachedConfig
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function ensureConfigCreated(configPath: string): Promise<void> {
  const configDir = join(configPath, '..')
  if (!existsSync(configDir)) await mkdir(configDir, { recursive: true })
  await writeFile(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8')
}
