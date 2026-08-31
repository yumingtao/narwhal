import { z } from 'zod'

// ── Schema ──────────────────────────────────────────────────────────────────

export const THEME_MODES = ['auto', 'dark', 'light'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const ENV_VAR_PATTERN = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/u

const envString = z.string().superRefine((value, ctx) => {
  if (value.startsWith('{env:') && !ENV_VAR_PATTERN.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${value}" is not a valid {env:VAR_NAME} reference`,
    })
  }
})

const providerOptionsSchema = z.object({
  apiKey: envString.optional(),
  baseURL: z.string().url().optional(),
  headers: z.record(z.string(), envString).optional(),
})

const providerSchema = z.object({
  type: z.enum(['deepseek', 'anthropic', 'openai', 'openai-compatible', 'other']).optional(),
  enabled: z.boolean().optional().default(true),
  options: providerOptionsSchema.optional(),
  models: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
  })).optional(),
})

export const configSchema = z.object({
  version: z.literal(1).default(1),
  theme: z.enum(THEME_MODES).optional().default('auto'),
  defaultModel: z.string().min(1).optional(),
  defaultEffort: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  agentMode: z.string().min(1).optional().default('minimal'),
  permissionLevel: z.string().min(1).optional().default('default'),
  providers: z.record(z.string(), providerSchema).optional().default({}),
})

export type NarwhalConfig = z.infer<typeof configSchema>
export type ProviderConfig = z.infer<typeof providerSchema>
export type ProviderOptions = z.infer<typeof providerOptionsSchema>

// ── Defaults ────────────────────────────────────────────────────────────────

export const defaultConfig: NarwhalConfig = {
  version: 1,
  theme: 'auto',
  defaultModel: 'deepseek-chat',
  defaultEffort: 'medium',
  agentMode: 'minimal',
  permissionLevel: 'default',
  providers: {
    deepseek: {
      enabled: true,
      options: {
        apiKey: '{env:DEEPSEEK_API_KEY}',
      },
    },
    anthropic: {
      enabled: true,
      options: {
        apiKey: '{env:ANTHROPIC_API_KEY}',
      },
    },
    openai: {
      enabled: true,
      options: {
        apiKey: '{env:OPENAI_API_KEY}',
      },
    },
  },
}

// ── Env var resolution ──────────────────────────────────────────────────────

export interface ResolvedProviderOptions {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  unresolvedEnvRefs: string[]
}

/**
 * Resolve a single config value that may be a {env:VAR_NAME} reference.
 * Returns the resolved value if the env var exists, or undefined if not.
 */
export function resolveEnvValue(value: string): { resolved?: string; missing?: string } {
  const match = value.match(ENV_VAR_PATTERN)
  if (!match) return { resolved: value }
  const varName = match[1]
  const envValue = process.env[varName]
  if (envValue) return { resolved: envValue }
  return { missing: varName }
}

/**
 * Resolve all {env:} references in a provider options object.
 * Collects unresolved refs so callers can warn the user.
 */
export function resolveProviderOptions(options: ProviderOptions | undefined): ResolvedProviderOptions {
  const result: ResolvedProviderOptions = { unresolvedEnvRefs: [] }
  if (!options) return result

  if (options.apiKey) {
    const { resolved, missing } = resolveEnvValue(options.apiKey)
    if (resolved) result.apiKey = resolved
    else if (missing) result.unresolvedEnvRefs.push(missing)
  }

  if (options.baseURL) {
    const { resolved, missing } = resolveEnvValue(options.baseURL)
    if (resolved) result.baseURL = resolved
    else if (missing) result.unresolvedEnvRefs.push(missing)
  }

  if (options.headers) {
    const resolvedHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.headers)) {
      const { resolved, missing } = resolveEnvValue(value)
      if (resolved) resolvedHeaders[key] = resolved
      else if (missing) result.unresolvedEnvRefs.push(missing)
    }
    if (Object.keys(resolvedHeaders).length > 0) result.headers = resolvedHeaders
  }

  return result
}

// ── Template generation ─────────────────────────────────────────────────────

export function generateConfigTemplate(): string {
  return JSON.stringify(defaultConfig, null, 2) +
    `\n\n# Narwhal configuration file\n` +
    `# Path: ~/.config/narwhal/config.json\n` +
    `#\n` +
    `# API keys are referenced via {env:VAR_NAME} syntax.\n` +
    `# Set them in your shell profile (~/.zshrc / ~/.bashrc):\n` +
    `#   export DEEPSEEK_API_KEY="sk-..."\n` +
    `#   export ANTHROPIC_API_KEY="sk-ant-..."\n` +
    `#\n` +
    `# Restart Narwhal after changing env vars.\n`
}
