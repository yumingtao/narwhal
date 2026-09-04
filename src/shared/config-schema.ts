import { z } from 'zod'

// ── Constants ──────────────────────────────────────────────────────────────

export const CONFIG_VERSION = 1

export const THEME_MODES = ['auto', 'dark', 'light'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number]

export const AGENT_PRESETS = ['standard', 'minimal'] as const
export type AgentPreset = (typeof AGENT_PRESETS)[number]

export const ENV_VAR_PATTERN = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/u

// ── Provider profile (matches DSH PiAiProviderProfile) ─────────────────────

const envString = z.string().superRefine((value, ctx) => {
  if (value.startsWith('{env:') && !ENV_VAR_PATTERN.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${value}" is not a valid {env:VAR_NAME} reference` })
  }
})

const modelProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
  reasoningEfforts: z.array(z.enum(['low', 'medium', 'high'])).optional(),
  compat: z.record(z.string(), z.any()).optional(),
  maxTokens: z.number().positive().optional(),
  contextWindow: z.number().positive().optional(),
})

export type ModelProfile = z.infer<typeof modelProfileSchema>

const providerSchema = z.object({
  // Basic identity
  displayName: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  baseURL: z.string().url().optional(),

  // Credential: env var name that holds the API key (DSH resolves per request)
  // Empty string means no API key configured yet
  apiKeyEnv: z.string().optional(),

  // Models
  models: z.array(modelProfileSchema).optional(),

  // Model-level overrides for models on the installed pi-ai catalog
  modelOverrides: z.record(z.string(), z.record(z.string(), z.any())).optional(),

  // Global defaults for this route (catalog models + route-unspecified models inherit)
  defaultContextWindow: z.number().positive().optional(),
  defaultMaxTokens: z.number().positive().optional(),
  defaultInput: z.array(z.enum(['text', 'image'])).optional(),

  // Compatibility switches
  compat: z.record(z.string(), z.any()).optional(),

  // Transport knobs
  headers: z.record(z.string(), envString).optional(),
  reasoning: z.enum(['none', 'low', 'medium', 'high', 'full']).optional(),
  thinkingBudgets: z.record(z.string(), z.any()).optional(),
  cacheRetention: z.string().optional(),
  transport: z.string().optional(),

  // Timeouts
  timeoutMs: z.number().positive().optional(),
  websocketConnectTimeoutMs: z.number().positive().optional(),
  streamIdleTimeoutMs: z.number().positive().optional(),

  // Image handling
  maxRequestImageBytes: z.number().positive().optional(),
  requestImagePixelBudget: z.number().positive().optional(),
  requestImageMaxBytes: z.number().positive().optional(),

  // Retry
  retryPolicy: z.record(z.string(), z.any()).optional(),
})

export type ProviderProfile = z.infer<typeof providerSchema>

// ── MCP server ─────────────────────────────────────────────────────────────

const stdioMcpSchema = z.object({
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  toolCallTimeoutMs: z.number().positive().optional().default(60000),
  failOnStartupError: z.boolean().optional().default(false),
})

const httpMcpSchema = z.object({
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  transport: z.literal('streamable-http'),
  url: z.string().url(),
  headers: z.record(z.string(), envString).optional(),
  toolCallTimeoutMs: z.number().positive().optional().default(60000),
  failOnStartupError: z.boolean().optional().default(false),
})

export const mcpServerSchema = z.discriminatedUnion('transport', [stdioMcpSchema, httpMcpSchema])
export type McpServer = z.infer<typeof mcpServerSchema>

// ── Skill config ───────────────────────────────────────────────────────────

const skillConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  customDirs: z.array(z.string()).optional().default([]),
  bundledDir: z.string().optional(),
})
export type SkillConfig = z.infer<typeof skillConfigSchema>

// ── Runtime config (dev-only override for packaged runtime discovery) ───────
// In production Narwhal always ships a bundled DSH runtime at a fixed path.
// In dev we need to tell Narwhal where the DSH checkout lives — either a
// source-tree checkout (DeepSeek-Harness) or a deployed one (npm install).

export const runtimeSchema = z.object({
  /**
   * Absolute path to the DSH runtime directory. Leave undefined to let
   * Narwhal auto-discover (projectRoot/runtime/dsh first, then ../DeepSeek-Harness).
   */
  root: z.string().min(1).optional(),
  /**
   * How to boot the runtime:
   *   - "deployed"  — npm-installed package (bin.js via node)
   *   - "source"    — source-tree checkout (bin.ts via tsx)
   * Leave undefined to auto-detect based on cliEntry file extension.
   */
  mode: z.enum(['deployed', 'source']).optional(),
  /** Override the node executable path used to spawn DSH (dev only). */
  nodeExecutable: z.string().min(1).optional(),
})
export type RuntimeConfig = z.infer<typeof runtimeSchema>

// ── Top-level config ───────────────────────────────────────────────────────

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  theme: z.enum(THEME_MODES).optional().default('auto'),

  // UI onboarding state (mirrors DSH ui-onboarding namespace)
  uiOnboarding: z.string().optional(),

  // Agent defaults → sync to DSH agent-default-model + permission namespaces
  defaultModel: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  }).optional(),

  agent: z.object({
    preset: z.enum(AGENT_PRESETS).optional().default('standard'),
    permissionLevel: z.enum(PERMISSION_PRESETS).optional().default('workspace-write'),
  }).optional().default({ preset: 'standard', permissionLevel: 'workspace-write' }),

  // Runtime override (dev only — packaged builds ship a fixed runtime)
  runtime: runtimeSchema.optional(),

  // Provider routes → sync to DSH llm-pi-ai namespace
  providers: z.record(z.string(), providerSchema).optional().default({}),

  // Skill system → sync to DSH cordis.patch.yml (enable skill-filesystem)
  skills: skillConfigSchema.optional().default({ enabled: false, customDirs: [] }),

  // DSH bundle plugins — installed via `dsh plugin add`, tracked here for UI display
  bundlePlugins: z.array(z.string()).optional().default([]),

  // MCP servers → each becomes one dsh-mcp-client plugin entry in cordis.patch.yml
  mcpServers: z.array(mcpServerSchema).optional().default([]),
})

export type NarwhalConfig = z.infer<typeof configSchema>

// ── Defaults ───────────────────────────────────────────────────────────────

export const defaultConfig: NarwhalConfig = {
  version: CONFIG_VERSION,
  theme: 'auto',
  providers: {},
  agent: {
    preset: 'standard',
    permissionLevel: 'workspace-write',
  },
  skills: {
    enabled: false,
    customDirs: [],
  },
  bundlePlugins: [],
  mcpServers: [],
}

// ── Env var resolution ──────────────────────────────────────────────────────

export interface EnvResolveResult {
  resolved?: string
  missing?: string
}

export function resolveEnvValue(value: string): EnvResolveResult {
  const match = value.match(ENV_VAR_PATTERN)
  if (!match) return { resolved: value }
  const varName = match[1]
  const envValue = process.env[varName]
  if (envValue) return { resolved: envValue }
  return { missing: varName }
}

/**
 * Walk a plain object and resolve all {env:VAR} string leaves.
 * Returns a new object with resolved values; unresolved vars remain as-is
 * and are collected in the return's second element.
 */
export function deepResolveEnv<T>(obj: T, collected: Set<string> = new Set()): T {
  if (typeof obj === 'string') {
    const r = resolveEnvValue(obj)
    if (r.resolved !== undefined) return r.resolved as unknown as T
    if (r.missing) collected.add(r.missing)
    return obj
  }
  if (Array.isArray(obj)) return obj.map((v) => deepResolveEnv(v, collected)) as unknown as T
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepResolveEnv(v, collected)
    }
    return result as unknown as T
  }
  return obj
}
