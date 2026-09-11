import { describe, expect, it } from 'vitest'
import { dshProviderProfile } from './dsh-sync.js'
import type { ProviderProfile } from '../shared/config-schema.js'

function profile(partial: Partial<ProviderProfile> & { api: string; models: ProviderProfile['models'] }): ProviderProfile {
  return partial as ProviderProfile
}

function modelEfforts(generated: Record<string, unknown>, modelIndex = 0): unknown {
  const models = generated['models'] as Array<Record<string, unknown>>
  return models[modelIndex]['reasoningEfforts']
}

describe('dshProviderProfile — reasoning effort dict', () => {
  it('defaults OpenAI-compatible models to the full five-level dict', () => {
    const out = dshProviderProfile(profile({
      api: 'openai-completions', baseURL: 'https://example.com/v1', apiKeyEnv: 'P_API_KEY',
      models: [{ id: 'gpt-x', name: 'gpt-x' }],
    }))
    expect(modelEfforts(out)).toEqual({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  })

  it('does the same for openai-responses (protocol detection is substring based)', () => {
    const out = dshProviderProfile(profile({
      api: 'openai-responses', baseURL: 'https://example.com/v1', apiKeyEnv: 'P_API_KEY',
      models: [{ id: 'gpt-x', name: 'gpt-x' }],
    }))
    expect(modelEfforts(out)).toHaveProperty('xhigh')
    expect(modelEfforts(out)).toHaveProperty('max')
  })

  it('preserves an explicitly declared subset verbatim (no silent upgrade)', () => {
    const out = dshProviderProfile(profile({
      api: 'openai-completions', baseURL: 'https://example.com/v1', apiKeyEnv: 'P_API_KEY',
      models: [{ id: 'gpt-x', name: 'gpt-x', reasoningEfforts: ['high'] }],
    }))
    expect(modelEfforts(out)).toEqual({ high: 'high' })
  })

  it('converts an explicit array form including xhigh/max into the dict form', () => {
    const out = dshProviderProfile(profile({
      api: 'openai-completions', baseURL: 'https://example.com/v1', apiKeyEnv: 'P_API_KEY',
      models: [{ id: 'gpt-x', name: 'gpt-x', reasoningEfforts: ['low', 'xhigh', 'max'] }],
    }))
    expect(modelEfforts(out)).toEqual({ low: 'low', xhigh: 'xhigh', max: 'max' })
  })

  it('never injects reasoningEfforts for anthropic-messages models', () => {
    const out = dshProviderProfile(profile({
      api: 'anthropic-messages', baseURL: 'https://api.anthropic.com', apiKeyEnv: 'P_API_KEY',
      models: [{ id: 'claude-x', name: 'claude-x' }],
    }))
    expect(modelEfforts(out)).toBeUndefined()
  })

  it('leaves unrelated profile fields untouched', () => {
    const out = dshProviderProfile(profile({
      api: 'openai-completions', baseURL: 'https://example.com/v1', apiKeyEnv: 'P_API_KEY',
      models: [{ id: 'gpt-x', name: 'Display Name' }],
    }))
    expect(out['api']).toBe('openai-completions')
    expect((out['models'] as Array<Record<string, unknown>>)[0]['name']).toBe('Display Name')
  })
})
