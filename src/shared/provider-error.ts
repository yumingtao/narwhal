/**
 * Stable classification of raw model-provider error text.
 *
 * The main process classifies failures coming from DSH (host/agent-error and
 * turn/end reason.error) into one of these codes and ships ONLY the code plus
 * the raw provider message. The renderer owns the human-facing wording via
 * i18n; the raw text stays available as collapsible detail.
 *
 * Order matters: specific product signatures first, broad transport patterns
 * last. Anything unmatched returns undefined and is displayed verbatim.
 */
export type ProviderErrorCode = 'gateway-session' | 'auth' | 'rate-limit' | 'network'

interface ErrorPattern {
  readonly code: ProviderErrorCode
  readonly test: RegExp
}

const PATTERNS: readonly ErrorPattern[] = [
  // Reverse-engineered ChatGPT-web gateways (observed: acme) answer 200
  // + SSE and then inject a Chinese instruction telling the user to copy the
  // web session id. It is an upstream session outage on the gateway side.
  { code: 'gateway-session', test: /复制会话\s*id|chatgpt\s*客户端|粘贴到新会话/u },
  // Authentication / authorization
  { code: 'auth', test: /\b(401|403)\b|unauthori[sz]ed|invalid\s+api[\s_-]*key|incorrect\s+api[\s_-]*key|authentication\s+failed|invalid\s+authentication/iu },
  // Rate limiting / quota
  { code: 'rate-limit', test: /\b429\b|rate[\s-]*limit|too\s+many\s+requests|quota\s+exceeded|insufficient[\s_]*quota/iu },
  // Transport / reachability / gateway 5xx
  { code: 'network', test: /\b(502|503|504)\b|econnrefused|enotfound|etimedout|econnreset|eai_again|connection\s+error|network\s+error|fetch\s+failed|failed\s+to\s+fetch|bad\s+gateway|service\s+unavailable|gateway\s+timeout|request\s+timed?\s*out|timed?\s*out\s+after/iu },
]

/** Returns a stable error code for known provider failures, or undefined when
 * the message should be shown to the user verbatim. Pure and deterministic. */
export function classifyProviderError(raw: string | undefined | null): ProviderErrorCode | undefined {
  if (!raw) return undefined
  for (const pattern of PATTERNS) {
    if (pattern.test.test(raw)) return pattern.code
  }
  return undefined
}
