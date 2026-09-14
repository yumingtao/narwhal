import { describe, expect, it } from 'vitest'
import { classifyProviderError } from './provider-error.js'

describe('classifyProviderError', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    // Real message observed from a reverse-engineered ChatGPT-web gateway during an outage
    ['gateway-session', 'chatgpt 客户端请在上方会话标题处“....”，复制→复制会话 id，然后在粘贴到新会话继续'],
    ['gateway-session', '请复制会话 id 后重试'],
    ['gateway-session', 'ChatGPT 客户端：请粘贴到新会话'],
    // Auth
    ['auth', 'Error 401: Unauthorized'],
    ['auth', 'invalid api key provided'],
    ['auth', 'Incorrect API key provided: sk-xxx.'],
    ['auth', 'Authentication failed with the remote server'],
    ['auth', '403 Forbidden'],
    // Rate limit / quota
    ['rate-limit', '429 Too Many Requests'],
    ['rate-limit', 'Rate limit reached for requests, retry after 20s'],
    ['rate-limit', 'You exceeded your current quota (insufficient_quota)'],
    // Network / transport / 5xx
    ['network', 'Connection error.'],
    ['network', 'fetch failed'],
    ['network', 'request timed out after 60000ms'],
    ['network', '502 Bad Gateway'],
    ['network', 'Service Unavailable (503)'],
    ['network', 'ECONNREFUSED 127.0.0.1:8788'],
  ] as const

  for (const [expected, raw] of cases) {
    it(`classifies "${raw.slice(0, 48)}" as ${expected}`, () => {
      expect(classifyProviderError(raw)).toBe(expected)
    })
  }

  it('returns undefined for unclassified messages (shown verbatim)', () => {
    expect(classifyProviderError('The model refused to answer because of content policy.')).toBeUndefined()
    expect(classifyProviderError('context length exceeded: 128000 tokens')).toBeUndefined()
  })

  it('returns undefined for empty / missing input', () => {
    expect(classifyProviderError('')).toBeUndefined()
    expect(classifyProviderError(undefined)).toBeUndefined()
    expect(classifyProviderError(null)).toBeUndefined()
  })

  it('does not mistake a 401-like token count for auth (word boundary)', () => {
    // A token count must not trip the bare 401/403/429/5xx patterns
    expect(classifyProviderError('usage: 1401 prompt tokens consumed')).toBeUndefined()
    expect(classifyProviderError('processed 4290 tokens')).toBeUndefined()
  })

  it('prefers the specific gateway-session signature over generic patterns', () => {
    // Even though the message contains no transport words, the product
    // signature wins; and a message mentioning both still resolves to the
    // specific upstream-session class.
    const raw = 'chatgpt 客户端连接失败：请复制会话 id（Error 503）'
    expect(classifyProviderError(raw)).toBe('gateway-session')
  })
})
