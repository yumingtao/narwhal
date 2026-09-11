import { existsSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'yaml'
import {
  type NarwhalConfig,
  type McpServer,
  type ProviderProfile,
  CONFIG_VERSION,
  configSchema,
  defaultConfig,
} from '../shared/config-schema.js'

// ── Narwhal Commands plugin source (embedded ESM string) ──────────────────
// This cordis patch plugin injects webServer, sessions, agents, compaction
// and exposes /plan, /feedback, /compact as HTTP endpoints at /api/narwhal/*.
// These three commands are normally only reachable through the cordis
// `commands` WebSocket mux — this plugin bridges them to HTTP so Narwhal's
// host-bridge can invoke them.
const NARWHAL_COMMANDS_PLUGIN_CODE = String.raw`
import { Service } from "@deepseek-ai/cordis";

class NarwhalCommands extends Service {
  // compaction is optional — it may not be present in every profile
  // (e.g. a headless build could disable it). We fetch it at call time
  // via ctx.get() rather than listing it in static inject.
  static inject = ["webServer", "sessions", "agents"];
  constructor(ctx) { super(ctx, "narwhalCommands"); }

  async [Service.init]() {
    const ctx = this.ctx;

    async function readBody(req) {
      if (!req.headers["content-type"]?.includes("application/json")) return {};
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf-8");
      if (!text) return {};
      try { return JSON.parse(text); } catch { throw new Error("invalid JSON body"); }
    }

    function sendJson(res, status, data) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    }

    ctx.webServer.register({
      kind: "prefix",
      path: "/api/narwhal",
      handler: async (req, res) => {
        const p = new URL(req.url, "http://x").pathname;
        try {
          if (p === "/api/narwhal/plan" && req.method === "POST") {
            const { sessionId, active } = await readBody(req);
            if (!sessionId) return sendJson(res, 400, { ok: false, error: "sessionId required" });
            const session = ctx.sessions.get(sessionId);
            if (!session) return sendJson(res, 404, { ok: false, error: "session not found" });
            session.append("plan/mode", { active: !!active });
            return sendJson(res, 200, { ok: true, sessionId, active: !!active });
          }
          if (p === "/api/narwhal/feedback" && req.method === "POST") {
            const { sessionId, text } = await readBody(req);
            if (!sessionId) return sendJson(res, 400, { ok: false, error: "sessionId required" });
            if (!text?.trim()) return sendJson(res, 400, { ok: false, error: "text required" });
            const session = ctx.sessions.get(sessionId);
            if (!session) return sendJson(res, 404, { ok: false, error: "session not found" });
            session.append("feedback/record", { text: text.trim() });
            return sendJson(res, 200, { ok: true, sessionId });
          }
          if (p === "/api/narwhal/compact" && req.method === "POST") {
            const { sessionId } = await readBody(req);
            if (!sessionId) return sendJson(res, 400, { ok: false, error: "sessionId required" });
            const compaction = ctx.get("compaction");
            if (!compaction) return sendJson(res, 503, { ok: false, error: "compaction service not available in this profile" });
            const agent = ctx.agents.get(sessionId);
            if (!agent) return sendJson(res, 404, { ok: false, error: "no live agent for session" });
            const result = await compaction.compactNow(agent, new AbortController().signal, "narwhal-web");
            if (result === null) return sendJson(res, 200, { ok: true, compacted: false, reason: "no compactable history" });
            return sendJson(res, 200, {
              ok: true, compacted: true,
              shadowedSeqs: result.shadowedSeqs?.length ?? 0,
              shadowedTokens: result.shadowedTokenCount ?? 0,
              summarySeq: result.summarySeq,
            });
          }
          return sendJson(res, 404, { ok: false, error: "unknown endpoint" });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
        }
      },
    });
  }
}

export default NarwhalCommands;
`

const NARWHAL_COMMANDS_PKG_JSON = JSON.stringify({
  name: '@narwhal/narwhal-commands',
  version: '1.0.0',
  type: 'module',
  main: 'index.js',
  dsh: { bundle: { id: 'narwhal-commands' } },
  keywords: ['dsh-plugin', 'deepseek-harness', 'narwhal'],
}, null, 2)

// ── Public API ─────────────────────────────────────────────────────────────

/** Result of a sync operation — what was written and where. */
export interface SyncResult {
  settingsYaml: string
  cordisPatchYaml: string
  providerCount: number
  mcpCount: number
  skillsEnabled: boolean
  pluginDeployed: boolean
}

/**
 * Deploy the narwhal-commands cordis plugin into the DSH runtime's
 * node_modules so it can be referenced by bare module specifier in
 * cordis.patch.yml. Safe to call every startup (idempotent).
 *
 * This writes two locations because Node.js resolves bare specifiers from
 * the DSH profile's cwd (profiles/web) via parent-directory walk, which
 * stops at the project root boundary — it never reaches runtimeRoot. DSH's
 * healProfiles places a flat symlink fallback at profiles/node_modules/
 * but we're an external @narwhal/* package that healProfiles does not know
 * about, so we must create that symlink ourselves.
 *
 * @param runtimeRoot  path to the DSH runtime (from resolveRuntime())
 * @param dshHome      DSH_HOME directory — used to create the profiles/
 *                     node_modules symlink that Node.js needs
 * @returns true if plugin was deployed (or already present), false on error
 */
export async function deployNarwhalCommandsPlugin(runtimeRoot?: string, dshHome?: string): Promise<boolean> {
  if (!runtimeRoot) return false
  const pluginDir = join(runtimeRoot, 'node_modules', '@narwhal', 'narwhal-commands')
  try {
    // 1. Write plugin files into the runtime's node_modules/@narwhal/
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, 'package.json'), NARWHAL_COMMANDS_PKG_JSON, 'utf-8')
    await writeFile(join(pluginDir, 'index.js'), NARWHAL_COMMANDS_PLUGIN_CODE, 'utf-8')
    console.log('[narwhal] deployed narwhal-commands plugin →', pluginDir)

    // 2. Symlink into profiles/node_modules/@narwhal/ so Node.js can resolve
    //    "@narwhal/narwhal-commands" from inside profiles/web.
    if (dshHome) {
      const profilesNodeModules = join(dshHome, 'profiles', 'node_modules')
      const narwhalScope = join(profilesNodeModules, '@narwhal')
      const profilesLink = join(narwhalScope, 'narwhal-commands')
      await mkdir(narwhalScope, { recursive: true })
      // Remove stale symlink or file if any — we want the link to point at the
      // canonical runtime location so updates propagate instantly.
      if (existsSync(profilesLink)) {
        try { unlinkSync(profilesLink) } catch { /* race — let symlink below handle it */ }
      }
      await symlink(pluginDir, profilesLink)
      console.log('[narwhal] symlinked →', profilesLink, '→', pluginDir)
    }

    return true
  } catch (err) {
    console.warn('[narwhal] failed to deploy narwhal-commands plugin:', err instanceof Error ? err.message : String(err))
    return false
  }
}

/**
 * Generate and write both DSH config files from a NarwhalConfig.
 * MUST be called BEFORE spawning the DSH process each startup.
 *
 * @param configPath  Narwhal's own config.json path (for header comment)
 * @param dshHome     DSH_HOME directory
 * @param runtimeRoot optional DSH runtime path — if provided, also deploys
 *                    the narwhal-commands cordis patch plugin
 */
export async function syncDshConfig(
  config: NarwhalConfig,
  configPath: string,
  dshHome: string,
  runtimeRoot?: string,
): Promise<SyncResult> {
  const settingsPath = join(dshHome, 'settings.yaml')
  const patchPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')

  // 1. Deploy the narwhal-commands cordis plugin into runtime node_modules
  //    and symlink into profiles/node_modules/@narwhal/ so Node.js resolves it
  const pluginDeployed = await deployNarwhalCommandsPlugin(runtimeRoot, dshHome)

  // 2. Build config files (patch.yml will include the plugin entry below)
  const settingsContent = buildSettingsYaml(config, configPath)
  const patchContent = buildCordisPatchYaml(config, configPath)

  await writeSettingsFile(settingsPath, settingsContent)
  await writePatchFile(patchPath, patchContent)

  return {
    settingsYaml: settingsPath,
    cordisPatchYaml: patchPath,
    providerCount: Object.keys(config.providers).length,
    mcpCount: config.mcpServers.length,
    skillsEnabled: config.skills.enabled,
    pluginDeployed,
  }
}

// ── Migration ──────────────────────────────────────────────────────────────

/**
 * On first run (no config.json yet, or old v1 format), read DSH's existing
 * settings.yaml and merge its content into a fresh NarwhalConfig.
 * The result is saved as config.json and becomes the authoritative source.
 */
export async function migrateFromDsh(
  configPath: string,
  dshHome: string,
): Promise<NarwhalConfig> {
  // 1. Start with defaults
  const merged: NarwhalConfig = { ...defaultConfig, providers: {}, mcpServers: [] }

  // 2. Merge existing config.json if it exists (pick up theme)
  if (existsSync(configPath)) {
    try {
      const raw = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.theme === 'string') merged.theme = parsed.theme as NarwhalConfig['theme']
    } catch {
      // ignore — fresh start
    }
  }

  // 3. Pull from DSH settings.yaml (the actual source of truth for runtime config)
  const dshSettingsPath = join(dshHome, 'settings.yaml')
  if (existsSync(dshSettingsPath)) {
    try {
      const raw = await readFile(dshSettingsPath, 'utf-8')
      const parsed = yaml.parse(raw) as Record<string, unknown> | null
      if (parsed && typeof parsed === 'object') {
        mergeDshProviders(merged, parsed['llm-pi-ai'])
        mergeDshDefaultModel(merged, parsed['agent-default-model'])
        mergeDshPermission(merged, parsed['permission'])
        mergeDshOnboarding(merged, parsed['ui-onboarding'])
      }
    } catch (error) {
      console.warn('[narwhal] migrateFromDsh: could not parse DSH settings.yaml:', error instanceof Error ? error.message : String(error))
    }
  }

  // 4. Write the migrated config.json
  const configDir = dirname(configPath)
  if (!existsSync(configDir)) await mkdir(configDir, { recursive: true })
  const validated = configSchema.parse(merged)
  await writeFile(configPath, JSON.stringify(validated, null, 2) + '\n', 'utf-8')

  console.log('[narwhal] migrateFromDsh: wrote config.json with', Object.keys(validated.providers).length, 'providers')
  return validated
}

// ── DSH settings.yaml builder ──────────────────────────────────────────────

const DSH_SETTINGS_HEADER = `# GENERATED BY NARWHAL — DO NOT EDIT MANUALLY
# Source: {configPath}
# Edit that file and restart Narwhal instead.

`

/**
 * Convert a Narwhal-stored provider profile into the shape DSH's pi-ai
 * settings schema expects. Key difference: reasoning levels.
 *
 * Narwhal config stores them as a simple array (`reasoningEfforts: ['high']`),
 * but DSH requires a level→wire-spelling dict
 * (`reasoningEfforts: { low: 'low', medium: 'medium', high: 'high',
 * xhigh: 'xhigh', max: 'max' }`).
 *
 * Without this dict a hand-declared model supports only `off`, so DSH drops
 * reasoning_effort from outbound requests and the upstream gateway's
 * 推理强度 column shows "-". We default every OpenAI-compatible custom model
 * to low/medium/high/xhigh/max (pi-ai's canonical OpenAI levels; xhigh/max
 * stay hidden unless explicitly declared, so the dict must name them); the
 * field is only sent when an effort is actually selected for the session, so
 * gateways that ignore the parameter are unaffected.
 */
const DEFAULT_OPENAI_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

function dshProviderProfile(profile: ProviderProfile): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(profile as unknown as Record<string, unknown>) }
  const api = typeof out['api'] === 'string' ? out['api'] as string : ''
  const isOpenAi = api.includes('openai')
  const rawModels = Array.isArray(out['models']) ? out['models'] as unknown[] : undefined
  if (rawModels) {
    out['models'] = rawModels.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const model = { ...(entry as Record<string, unknown>) }
      if (isOpenAi) {
        const declared = Array.isArray(model['reasoningEfforts']) ? model['reasoningEfforts'] as string[] : undefined
        const levels = declared && declared.length > 0 ? declared : [...DEFAULT_OPENAI_REASONING_LEVELS]
        model['reasoningEfforts'] = Object.fromEntries(levels.map((level) => [level, level]))
      }
      return model
    })
  }
  return out
}

function buildSettingsYaml(config: NarwhalConfig, configPath: string): string {
  const doc: Record<string, unknown> = {}

  // ui-onboarding
  if (config.uiOnboarding) {
    doc['ui-onboarding'] = { welcomeNoticeVersion: config.uiOnboarding }
  }

  // llm-pi-ai.providers
  if (Object.keys(config.providers).length > 0) {
    // DSH runtime's pi-ai plugin rejects apiKeyEnv: "" (empty string) —
    // credentialRef("") throws TypeError, the whole provider gets dropped,
    // no adapter registered. Derive a valid credential ref from provider id
    // whenever the stored apiKeyEnv is empty or missing.
    const fixedProviders: Record<string, unknown> = {}
    for (const [id, profile] of Object.entries(config.providers)) {
      const env = (profile as { apiKeyEnv?: string }).apiKeyEnv
      const needsDerive = !env || env.length === 0
      const withEnv: ProviderProfile = needsDerive
        ? { ...profile, apiKeyEnv: id.replace(/[^A-Za-z0-9]/gu, '_').toUpperCase() + '_API_KEY' }
        : profile
      fixedProviders[id] = dshProviderProfile(withEnv)
    }
    doc['llm-pi-ai'] = { providers: fixedProviders }
  }

  // agent-default-model
  if (config.defaultModel) {
    const sel: Record<string, unknown> = {
      provider: config.defaultModel.provider,
      model: config.defaultModel.model,
    }
    if (config.defaultModel.reasoningEffort) {
      sel.reasoningEffort = config.defaultModel.reasoningEffort
    }
    doc['agent-default-model'] = sel
  }

  // permission
  doc['permission'] = { defaultPreset: config.agent.permissionLevel }

  return DSH_SETTINGS_HEADER.replace('{configPath}', configPath) + yaml.stringify(doc)
}

// ── DSH cordis.patch.yml builder ───────────────────────────────────────────

const CORDIS_PATCH_HEADER = `# GENERATED BY NARWHAL — DO NOT EDIT MANUALLY
# Source: {configPath} (skills + mcpServers sections)
# Edit that file and restart Narwhal instead.

`

interface CordisEntry {
  id: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

/** Top-level patch item — either an override (- id:) or an insert (- insert:). */
type CordisPatchItem =
  | CordisEntry
  | { insert: CordisEntry[] }

function buildCordisPatchYaml(config: NarwhalConfig, configPath: string): string {
  const items: CordisPatchItem[] = []

  // ── Narwhal core plugin (always-on, provides /plan, /feedback, /compact) ──
  // This is a brand-new entry not present in any bundle, so it MUST use
  // `- insert:` syntax rather than `- id:` (which only overrides existing rows).
  items.push({
    insert: [{
      id: 'narwhal-commands',
      name: '@narwhal/narwhal-commands',
      disabled: false,
    }],
  })

  // ── Skill system (override existing bundle rows) ──────────────────────────
  if (config.skills.enabled) {
    items.push(
      {
        id: 'skill-filesystem',
        disabled: false,
        config: {
          includeDefaultRoots: true,
          customSkillDirs: config.skills.customDirs,
          ...(config.skills.bundledDir ? { bundledSkillDir: config.skills.bundledDir } : {}),
        },
      },
      { id: 'tool-skill', disabled: false },
      { id: 'skill-badge', disabled: false },
    )
  }

  // ── MCP servers (these are new entries too — each needs `- insert:`) ───────
  for (const server of config.mcpServers) {
    items.push({ insert: [mcpServerToEntry(server)] })
  }

  return CORDIS_PATCH_HEADER.replace('{configPath}', configPath) + yaml.stringify(items)
}

function mcpServerToEntry(server: McpServer): CordisEntry {
  const id = `mcp-${server.serverName}`
  const config: Record<string, unknown> = {
    transport: server.transport,
    serverName: server.serverName,
    toolCallTimeoutMs: server.toolCallTimeoutMs ?? 60000,
    failOnStartupError: server.failOnStartupError ?? false,
  }

  if (server.transport === 'stdio') {
    config.command = server.command
    config.args = server.args ?? []
    if (server.env) config.env = server.env
    if (server.cwd) config.cwd = server.cwd
  } else {
    config.url = server.url
    if (server.headers && Object.keys(server.headers).length > 0) config.headers = server.headers
  }

  return { id, name: '@deepseek-ai/dsh-mcp-client', config }
}

// ── File writers ───────────────────────────────────────────────────────────

async function writeSettingsFile(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(path, content, 'utf-8')
}

async function writePatchFile(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(path, content, 'utf-8')
}

// ── DSH settings.yaml → config.json merge helpers ─────────────────────────

function mergeDshProviders(target: NarwhalConfig, section: unknown): void {
  if (!section || typeof section !== 'object') return
  const sectionObj = section as Record<string, unknown>
  const providersDict = sectionObj.providers
  if (!providersDict || typeof providersDict !== 'object') return

  for (const [name, profile] of Object.entries(providersDict as Record<string, unknown>)) {
    if (!profile || typeof profile !== 'object') continue
    target.providers[name] = profile as ProviderProfile
  }
}

function mergeDshDefaultModel(target: NarwhalConfig, section: unknown): void {
  if (!section || typeof section !== 'object') return
  const s = section as Record<string, unknown>
  const provider = typeof s.provider === 'string' ? s.provider : undefined
  const model = typeof s.model === 'string' ? s.model : undefined
  if (provider && model) {
    target.defaultModel = {
      provider,
      model,
      ...(typeof s.reasoningEffort === 'string' ? { reasoningEffort: s.reasoningEffort } : {}),
    }
  }
}

function mergeDshPermission(target: NarwhalConfig, section: unknown): void {
  if (!section || typeof section !== 'object') return
  const s = section as Record<string, unknown>
  const preset = s.defaultPreset
  if (typeof preset === 'string' && target.agent) {
    target.agent.permissionLevel = preset as NarwhalConfig['agent']['permissionLevel']
  }
}

function mergeDshOnboarding(target: NarwhalConfig, section: unknown): void {
  if (!section || typeof section !== 'object') return
  const s = section as Record<string, unknown>
  if (typeof s.welcomeNoticeVersion === 'string') {
    target.uiOnboarding = s.welcomeNoticeVersion
  }
}

// Re-export what callers need
export { CONFIG_VERSION }
