import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { AgentConfiguration, AgentConversation, AgentSession, Attachment, ChatItem, CreateProviderResult, CustomProviderCapability, ModelProvider, ProviderSetting, UsageStats } from '../shared/desktop-contract.js'
import { classifyTrajectory } from '../shared/trajectory-classifier.js'
import { classifyProviderError, type ProviderErrorCode } from '../shared/provider-error.js'
import { getConfig, saveConfig } from './config.js'

type JsonRecord = Record<string, unknown>
type Listener = (conversation: AgentConversation) => void

const MAX_TEXT = 24_000
const MAX_ITEMS = 400
const MAX_SEEN_EVENTS = 2_000
/** DSH 0.1.5 routes every custom (pi-ai) provider through this settings namespace. */
const PIAI_SETTINGS_NS = 'llm-pi-ai'
const PIAI_PROVIDERS_PATH = ['providers'] as const
/** Protocols the bundled dsh-llm-pi-ai adapter accepts (0.1.5). */
const PIAI_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const
const MUX_PATH = '/api/remote.mux'
const EVENT_STREAM_ENDPOINT = '$events'
const EVENT_RESULT_ENDPOINT = '$events/result'

function isRecord(value: unknown): value is JsonRecord { return !!value && typeof value === 'object' && !Array.isArray(value) }
function string(value: unknown, limit = MAX_TEXT): string | undefined { return typeof value === 'string' ? value.slice(0, limit) : undefined }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : Date.now() }
function finiteNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n').slice(0, MAX_TEXT)
}
function eventText(event: JsonRecord): string {
  const data = isRecord(event.data) ? event.data : {}
  const message = isRecord(data.message) ? data.message : data
  const content = textBlocks(message.content)
  if (content) return content
  const chunk = isRecord(data.chunk) ? data.chunk : {}
  if (chunk.type === 'text-delta') return string(chunk.text) ?? ''
  if (isRecord(chunk.block) && chunk.block.type === 'text') return string(chunk.block.text) ?? ''
  return string(data.name) ?? string(data.message) ?? string(data.reason) ?? ''
}
function trajectoryFor(event: JsonRecord, type: string): { readonly label: string; readonly text: string; readonly kind: 'trajectory' | 'error' } | undefined {
  const data = isRecord(event.data) ? event.data : {}
  const label = string(data.name, 120)
  const text = eventText(event)
  const descriptor = classifyTrajectory(type, label, text, 'trajectory')
  if (descriptor.hidden) return undefined
  return { label: descriptor.label, text: descriptor.text, kind: descriptor.kind }
}
function validId(value: unknown): string | undefined { const id = string(value, 140); return id && /^[A-Za-z0-9._:-]+$/u.test(id) ? id : undefined }

// Custom OpenAI-compatible providers advertise pi-ai's full five-level
// reasoning ladder by default (low/medium/high/xhigh/max). DSH's pi-ai
// settings schema stores them as a level→wire-spelling dict; Narwhal's own
// config schema stores a plain enum array. xhigh/max exist in pi-ai but stay
// unsupported unless a model profile explicitly declares them.
const OPENAI_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type OpenAiReasoningLevel = (typeof OPENAI_REASONING_LEVELS)[number]
// Anthropic's extended-thinking mapping only covers the three base levels.
const ANTHROPIC_REASONING_LEVELS = ['low', 'medium', 'high'] as const
function isOpenAiProtocol(api: unknown): boolean { return typeof api === 'string' && api.includes('openai') }
function reasoningLevelName(id: string): string { return `${id.charAt(0).toUpperCase()}${id.slice(1)}` }
function dshReasoningEfforts(): Record<string, string> { return Object.fromEntries(OPENAI_REASONING_LEVELS.map((level) => [level, level])) }
// Efforts shown for models DSH reports no native reasoning metadata for.
// Names mirror pi-ai's own capitalization (xhigh → "Xhigh", max → "Max").
function fallbackReasoningEfforts(protocol: string): { id: string; name: string }[] {
  if (protocol.includes('anthropic')) return ANTHROPIC_REASONING_LEVELS.map((id) => ({ id, name: reasoningLevelName(id) }))
  if (protocol.includes('openai')) return OPENAI_REASONING_LEVELS.map((id) => ({ id, name: reasoningLevelName(id) }))
  return []
}
function modelsForDsh(modelIds: readonly string[], api: unknown): JsonRecord[] {
  const reasoning = isOpenAiProtocol(api)
  return modelIds.map((id) => reasoning ? { id, name: id, reasoningEfforts: dshReasoningEfforts() } : { id, name: id })
}
function modelsForConfig(modelIds: readonly string[], api: unknown): { id: string; name: string; reasoningEfforts?: OpenAiReasoningLevel[] }[] {
  const reasoning = isOpenAiProtocol(api)
  return modelIds.map((id) => reasoning ? { id, name: id, reasoningEfforts: [...OPENAI_REASONING_LEVELS] } : { id, name: id })
}
export function valueAt(record: JsonRecord, path: readonly string[]): unknown { let value: unknown = record; for (const part of path) { if (!isRecord(value)) return undefined; value = value[part] } return value }
function credentialRefFor(provider: string, profile: JsonRecord): string | undefined {
  // Empty string apiKeyEnv (from config.json migration or a previous partial
  // write) falls through to the derived name — the DSH runtime rejects
  // credential refs that don't match /^[A-Za-z_][A-Za-z0-9_]*$/ so we must
  // always produce a valid non-empty ref before sending anything to DSH.
  const configured = string(profile.apiKeyEnv, 120)
  const derived = configured && configured.length > 0
    ? configured
    : `${provider.replace(/[^A-Za-z0-9]/gu, '_').toUpperCase()}_API_KEY`
  return /^[A-Z][A-Z0-9_]{0,127}$/u.test(derived) ? derived : undefined
}
function permissionOptions(schema: unknown): { id: string; label: string }[] {
  const label = (value: string) => value.replace(/-/gu, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase())
  if (!isRecord(schema)) return []
  if (isRecord(schema.properties) && isRecord(schema.properties.defaultPreset)) {
    const field = schema.properties.defaultPreset as JsonRecord; const values = Array.isArray(field.enum) ? field.enum : []; const labels = Array.isArray(field.enumNames) ? field.enumNames : []
    return values.flatMap((value, index) => typeof value === 'string' ? [{ id: value, label: typeof labels[index] === 'string' ? labels[index] : label(value) }] : [])
  }
  const refs = isRecord(schema.refs) ? schema.refs : undefined; const rootId = typeof schema.uid === 'number' ? String(schema.uid) : undefined; const root = refs && rootId ? refs[rootId] : undefined
  if (!refs || !isRecord(root) || !isRecord(root.dict) || typeof root.dict.defaultPreset !== 'number') return []
  const union = refs[String(root.dict.defaultPreset)]; if (!isRecord(union) || !Array.isArray(union.list)) return []
  return union.list.flatMap((reference) => {
    const option = typeof reference === 'number' ? refs[String(reference)] : undefined
    if (!isRecord(option) || typeof option.value !== 'string') return []
    return [{ id: option.value, label: label(option.value) }]
  })
}
interface CustomProviderDescriptor { readonly ns: string; readonly revision: number; readonly providersPath: string; readonly protocols: readonly string[] }
function schemaReference(schema: JsonRecord, reference: unknown): JsonRecord | undefined {
  const refs = isRecord(schema.refs) ? schema.refs : undefined
  const candidate = refs && typeof reference === 'number' ? refs[String(reference)] : undefined
  return isRecord(candidate) ? candidate : undefined
}
function schemaRoot(schema: unknown): JsonRecord | undefined {
  if (!isRecord(schema) || typeof schema.uid !== 'number') return undefined
  return schemaReference(schema, schema.uid)
}
function customProviderDescriptor(namespaces: readonly JsonRecord[]): CustomProviderDescriptor | undefined {
  // Common provider path patterns for fallback matching
  const FALLBACK_PATHS = ['providers', 'llm.providers', 'providerConfig', 'customProviders']
  for (const section of namespaces) {
    const ns = string(section.ns, 120); const revision = section.revision; const schema = isRecord(section.schema) ? section.schema : undefined; const root = schema && schemaRoot(schema)
    if (!ns || typeof revision !== 'number' || !schema || !root || !isRecord(root.dict)) continue
    // Primary path: iterate through schema dict entries looking for provider structures
    for (const [providersPath, providersReference] of Object.entries(root.dict)) {
      const providers = schemaReference(schema, providersReference)
      if (!providers || providers.type !== 'dict' || typeof providers.inner !== 'number') continue
      const profile = schemaReference(schema, providers.inner)
      if (!profile || profile.type !== 'object' || !isRecord(profile.dict)) continue
      const apiRef = profile.dict.api; const baseUrlRef = profile.dict.baseURL; const modelListRef = profile.dict.models; const credentialRef = profile.dict.apiKeyEnv
      const api = schemaReference(schema, apiRef); const modelList = schemaReference(schema, modelListRef); const credential = schemaReference(schema, credentialRef)
      if (!api || api.type !== 'union' || !Array.isArray(api.list) || !baseUrlRef || !modelList || modelList.type !== 'array' || typeof modelList.inner !== 'number' || !credential || !isRecord(credential.meta) || credential.meta.role !== 'credential-ref') continue
      const model = schemaReference(schema, modelList.inner)
      if (!model || model.type !== 'object' || !isRecord(model.dict) || model.dict.id === undefined) continue
      const protocols = api.list.flatMap((reference) => { const option = schemaReference(schema, reference); return option?.type === 'const' && typeof option.value === 'string' ? [option.value] : [] })
      if (protocols.length) return { ns, revision, providersPath, protocols }
    }
    // Fallback: try common path patterns directly in the value dict
    for (const fallbackPath of FALLBACK_PATHS) {
      if (fallbackPath in root.dict) {
        const providers = schemaReference(schema, root.dict[fallbackPath])
        if (providers && providers.type === 'dict' && typeof providers.inner === 'number') {
          const profile = schemaReference(schema, providers.inner)
          if (profile && profile.type === 'object' && isRecord(profile.dict)) {
            const apiRef = profile.dict.api; const credentialRef = profile.dict.apiKeyEnv
            const api = schemaReference(schema, apiRef); const credential = schemaReference(schema, credentialRef)
            if (api && api.type === 'union' && Array.isArray(api.list) && credential && isRecord(credential.meta) && credential.meta.role === 'credential-ref') {
              const protocols = api.list.flatMap((reference) => { const option = schemaReference(schema, reference); return option?.type === 'const' && typeof option.value === 'string' ? [option.value] : [] })
              if (protocols.length) return { ns, revision, providersPath: fallbackPath, protocols }
            }
          }
        }
      }
    }
  }
  return undefined
}
function customProviderCapability(namespaces: readonly JsonRecord[], writable: boolean): CustomProviderCapability {
  if (!writable) return { available: false, protocols: [], reason: 'The local Host settings are read-only.' }
  const descriptor = customProviderDescriptor(namespaces)
  if (descriptor) return { available: true, protocols: descriptor.protocols }
  // Fallback: the 0.1.5 pi-ai adapter ships a fixed protocol set even when
  // settings.describe's schema serialization can't be walked by Narwhal.
  return { available: true, protocols: [...PIAI_PROTOCOLS] }
}
function validCustomProviderId(value: string): boolean { return /^[a-z][a-z0-9-]{0,79}$/u.test(value) }
function validModelId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value) }
function validApiKey(value: string): boolean { return /^[\x21-\x7E]+$/u.test(value) && !/^(?:[A-Za-z_][A-Za-z0-9_]*)=/u.test(value) && !/^(['"]).*\1$/u.test(value) }

interface MuxStream {
  readonly endpoint: string
  args: JsonRecord
  readonly onItem: (value: unknown) => void
  readonly onError?: (error: JsonRecord) => void
  /** When false, a server `end`/`error` removes the stream (one-shot RPC-style). */
  readonly persistent: boolean
}

/** Owns the fixed loopback-only Host API and normalizes its output for the renderer. */
export class HostBridge {
  private origin: string | undefined
  private cookie = ''
  private mux: WebSocket | undefined
  private muxOpen = false
  private reconnectTimer: NodeJS.Timeout | undefined
  private listRefreshTimer: NodeJS.Timeout | undefined
  private stopped = true
  private sessions: AgentSession[] = []
  private selectedSessionId: string | undefined
  private messages: ChatItem[] = []
  private trajectory: ChatItem[] = []
  private listeners = new Set<Listener>()
  private running = false
  private seenEventIds = new Set<string>()
  private usage: UsageStats | undefined
  private openSteps = new Map<string, { startedAt: number; firstTokenAt?: number }>()
  private totalTtft = 0
  private ttftSamples = 0
  private decodeTokens = 0
  private decodeMs = 0
  private cacheReadTokens = 0
  /** Multiplexed logical streams keyed by client-minted streamId (0.1.5 remote.mux). */
  private streams = new Map<string, MuxStream>()
  /** Client generation id returned by the $events ready frame; required for waterfall results. */
  private eventClientId = ''
  /** turn/step coordinates of the in-flight assistant attempt keyed by attemptId. */
  private attemptTurns = new Map<string, { turn: number; step: number }>()
  /** Cwd values of all surviving workspaces. Sessions whose cwd is NOT in this set are filtered out. */
  private survivingCwds = new Set<string>()
  private cwdsInitialized = false
  /**
   * Inactivity watchdog for the active prompt. An upstream gateway can hold
   * a connection open without sending any bytes (observed hanging >35s, or
   * ~20s stall before the request even reaches the gateway) OR inject an
   * error mid-stream; the latter is reported via turn/end. Any LIVE follow
   * frame for the watched session (turn events, stream chunks, tool calls, …)
   * resets the idle clock. The allowance is generous (60s) rather than a
   * 20s wall clock: high-effort reasoning models and slow gateways can
   * legitimately exceed 20s to first token; DSH's own stream-idle timeout is
   * 300s, so 60s of TOTAL silence only fires for genuinely stuck turns.
   */
  private promptWatch: { sessionId: string; lastActivity: number; timer: NodeJS.Timeout } | undefined
  /** Identity of the failure already carded for the CURRENT turn. DSH can
   * deliver the same failure twice per turn (api-session/error + turn/end) —
   * collapse those, but a NEW turn failing again must still get its own card,
   * otherwise repeated identical gateway errors look like "nothing happened".
   * Classified errors dedup by stable code even when the two deliveries carry
   * different raw wording; unclassified errors fall back to text matching. */
  private turnErrorKey: { code?: ProviderErrorCode; text: string } | undefined

  /** Called by main process whenever workspace list changes. */
  setSurvivingCwds(paths: Iterable<string>): void {
    this.survivingCwds = new Set(paths)
    this.cwdsInitialized = true
    // Remove any now-orphaned sessions from memory
    const before = this.sessions.length
    this.sessions = this.sessions.filter((s) => !s.cwd || this.survivingCwds.has(s.cwd))
    if (this.selectedSessionId && !this.sessions.some((s) => s.id === this.selectedSessionId)) this.resetSelectedSession()
    if (this.sessions.length !== before) this.emit()
  }
  private filterSessions(sessions: AgentSession[]): AgentSession[] {
    if (!this.cwdsInitialized) return sessions  // no filter yet (bootstrap before first sync)
    return sessions.filter((s) => !s.cwd || this.survivingCwds.has(s.cwd))
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  snapshot(): AgentConversation { return { sessions: this.filterSessions(this.sessions), selectedSessionId: this.selectedSessionId, messages: this.messages, trajectory: this.trajectory, running: this.running, ...(this.usage && { usage: this.usage }) } }
  private emit(): void { const value = this.snapshot(); for (const listener of this.listeners) listener(value) }
  private resetSelectedSession(): void {
    this.closeFollow()
    this.stopPromptWatch()
    this.turnErrorKey = undefined
    this.selectedSessionId = undefined; this.messages = []; this.trajectory = []; this.running = false; this.seenEventIds.clear(); this.usage = undefined; this.openSteps.clear(); this.totalTtft = 0; this.ttftSamples = 0; this.decodeTokens = 0; this.decodeMs = 0; this.cacheReadTokens = 0; this.attemptTurns.clear()
  }
  clearSelection(): AgentConversation { this.resetSelectedSession(); this.emit(); return this.snapshot() }

  /**
   * Connect to a 0.1.5 Host. Every request needs the session cookie: HTTP RPCs
   * send it as a `Cookie` header and the single /api/remote.mux WebSocket
   * authenticates its upgrade with the same cookie.
   */
  async start(origin: string, cookie: string): Promise<void> {
    await this.stop()
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Error('Local Agent origin is invalid')
    // A single cookie pair (`name=value`), visible ASCII only, never a list
    // (the pair is split from Set-Cookie by the supervisor). The auth name
    // carries a base64url id; the value is `v1.<body>.<hmac>` (base64url + '.').
    if (!/^dsh-auth-[!-~]+=[!-~]*$/u.test(cookie) || cookie.includes(';')) throw new Error('Local Agent cookie is invalid')
    this.origin = parsed.origin
    this.cookie = cookie
    this.stopped = false
    this.openMux()
    this.openEvents()
  }
  async stop(): Promise<void> {
    this.stopped = true
    this.stopPromptWatch()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.listRefreshTimer) clearTimeout(this.listRefreshTimer)
    this.reconnectTimer = undefined
    this.listRefreshTimer = undefined
    this.mux?.removeAllListeners()
    this.mux?.terminate()
    this.mux = undefined
    this.muxOpen = false
    this.streams.clear()
    this.eventClientId = ''
    this.origin = undefined
    this.cookie = ''
  }

  // ── remote.mux client (0.1.5; one socket multiplexes many logical streams) ─

  private openMux(): void {
    if (this.stopped || !this.origin) return
    const socket = new WebSocket(`${this.origin.replace(/^http:/u, 'ws:')}${MUX_PATH}`, { headers: { Cookie: this.cookie }, handshakeTimeout: 8_000 })
    this.mux = socket
    socket.on('open', () => {
      if (this.mux !== socket) return
      this.muxOpen = true
      // Re-issue every logical stream open (initial connect or reconnect).
      for (const [streamId, stream] of this.streams) {
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint: stream.endpoint, payload: { args: stream.args } }))
      }
    })
    socket.on('message', (raw) => this.handleMuxFrame(raw.toString()))
    socket.on('close', () => { if (this.mux === socket) { this.muxOpen = false; this.scheduleReconnect() } })
    socket.on('error', () => undefined)
  }
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.openMux() }, 1_500)
  }
  /** Register and open a logical stream. Persistent streams are re-opened
   *  automatically after a socket reconnect. Returns the streamId. */
  private openStream(endpoint: string, args: JsonRecord, handlers: Omit<MuxStream, 'endpoint' | 'args' | 'persistent'> & { persistent?: boolean }): string {
    const streamId = randomUUID()
    this.streams.set(streamId, {
      endpoint,
      args,
      onItem: handlers.onItem,
      ...(handlers.onError ? { onError: handlers.onError } : {}),
      persistent: handlers.persistent ?? true,
    })
    if (this.muxOpen && this.mux) this.mux.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
    return streamId
  }
  private closeStream(streamId: string | undefined): void {
    if (!streamId) return
    const stream = this.streams.get(streamId)
    this.streams.delete(streamId)
    if (stream && this.muxOpen && this.mux) {
      try { this.mux.send(JSON.stringify({ type: 'cancel', streamId })) } catch { /* socket closing */ }
    }
  }
  private handleMuxFrame(raw: string): void {
    if (raw.length > 512_000) return
    let envelope: unknown
    try { envelope = JSON.parse(raw) } catch { return }
    if (!isRecord(envelope)) return
    const streamId = string(envelope.streamId, 200)
    const stream = streamId ? this.streams.get(streamId) : undefined
    const type = string(envelope.type, 40)
    if (type === 'item' && stream) { stream.onItem(envelope.value); return }
    if (type === 'error') {
      const error = isRecord(envelope.error) ? envelope.error : { code: 'stream/error', message: 'Stream failed' }
      console.warn('[host-bridge] mux stream error:', string(error.code), string(error.message))
      stream?.onError?.(error)
      if (stream && !stream.persistent) this.streams.delete(streamId!)
      else if (!stream) this.pushTrajectory({ id: `stream-${Date.now()}`, kind: 'error', label: 'Agent event stream', text: 'The local Agent event stream needs to reconnect.', time: Date.now() })
      return
    }
    if (type === 'end' && stream && !stream.persistent) this.streams.delete(streamId!)
  }

  // ── $events: global session list + provider/settings notifications ────────

  private openEvents(): void {
    this.openStream(EVENT_STREAM_ENDPOINT, {}, {
      persistent: true,
      onItem: (value) => { void this.handleEventFrame(value) },
    })
  }
  private scheduleListRefresh(): void {
    if (this.listRefreshTimer) return
    this.listRefreshTimer = setTimeout(() => { this.listRefreshTimer = undefined; if (!this.stopped) void this.listSessions().catch(() => undefined) }, 400)
  }
  private async handleEventFrame(value: unknown): Promise<void> {
    if (!isRecord(value)) return
    const type = string(value.type, 80)
    if (type === 'ready') { this.eventClientId = string(value.clientId, 200) ?? ''; return }
    if (type === 'emit') {
      const event = string(value.event, 120)
      const args = Array.isArray(value.args) ? value.args : []
      const sessionId = validId(args[0])
      if (event === 'api-session/status' && sessionId) {
        const running = args[1] === true
        if (sessionId === this.selectedSessionId) this.running = running
        this.sessions = this.sessions.map((item) => item.id === sessionId ? { ...item, running } : item)
        this.emit()
      } else if (event === 'api-session/error' && sessionId) {
        const text = string(args[1]) ?? 'The local Agent reported an error.'
        if (sessionId === this.selectedSessionId) this.cardProviderError(text, Date.now(), `error-${Date.now()}`)
      } else if (event === 'api-session/added' || event === 'api-session/removed' || event === 'api-session/activity') {
        this.scheduleListRefresh()
      }
      // commands/change, credentials/reference-updated, llm/adapters-updated,
      // settings/document-updated, goal/*, agent-preset/* are read on demand —
      // no live action required here.
      return
    }
    if (type === 'waterfall') {
      // approval/request and user-questions/request are the only waterfalls
      // the Host forwards. Narwhal does not implement interactive approval /
      // question UI, so delegate back to the Host chain immediately; leaving
      // a waterfall unanswered hangs the agent forever.
      const eventId = string(value.eventId, 200)
      if (!this.eventClientId || !eventId) return
      try {
        await this.rpc(EVENT_RESULT_ENDPOINT, { clientId: this.eventClientId, eventId, outcome: { kind: 'next' } })
      } catch (error) {
        console.warn('[host-bridge] waterfall result failed:', error instanceof Error ? error.message : String(error))
      }
      return
    }
    // type 'cancel' — a pending waterfall was withdrawn; nothing to do.
  }

  // ── session/follow: snapshot history + live events + assistant stream ─────

  private followStreamId: string | undefined

  private closeFollow(): void { this.closeStream(this.followStreamId); this.followStreamId = undefined }

  private openFollow(sessionId: string): void {
    this.closeFollow()
    this.followStreamId = this.openStream('session/follow', {
      request: { address: { kind: 'session', sessionId }, maxMessages: 200, assistantStream: true },
    }, {
      persistent: true,
      onItem: (value) => this.handleFollowFrame(sessionId, value),
      onError: () => { /* socket reconnect re-opens the stream */ },
    })
  }
  private handleFollowFrame(sessionId: string, value: unknown): void {
    if (sessionId !== this.selectedSessionId || !isRecord(value)) return
    const kind = string(value.type, 40)
    if (kind === 'snapshot') {
      const records = Array.isArray(value.records) ? value.records : []
      for (const record of records) {
        if (isRecord(record) && isRecord(record.event)) this.ingestEvent(sessionId, record.event)
      }
      this.emit()
      return
    }
    // Any live frame proves the agent is alive — feed the inactivity watchdog.
    if (this.promptWatch?.sessionId === sessionId) this.promptWatch.lastActivity = Date.now()
    if (kind === 'event') {
      if (isRecord(value.event)) this.ingestEvent(sessionId, value.event)
      return
    }
    if (kind === 'assistant-stream' && isRecord(value.frame)) this.handleAssistantFrame(value.frame)
  }
  private handleAssistantFrame(frame: JsonRecord): void {
    const sessionId = this.selectedSessionId
    if (!sessionId) return
    const type = string(frame.type, 40)
    if (type === 'start') {
      const turn = finiteNumber(frame.turn) ?? 0
      const step = finiteNumber(frame.step) ?? 0
      const attemptId = string(frame.attemptId, 200)
      if (attemptId) this.attemptTurns.set(attemptId, { turn, step })
      this.updateUsage({ data: { turn, step } }, 'step/start', Date.now())
      return
    }
    if (type === 'chunk') {
      const attemptId = string(frame.attemptId, 200)
      const coords = attemptId ? this.attemptTurns.get(attemptId) : undefined
      const chunk = isRecord(frame.chunk) ? frame.chunk : undefined
      const text = chunk?.type === 'text-delta' ? string(chunk.text) : undefined
      if (text) {
        if (coords) {
          const open = this.openSteps.get(`${coords.turn ?? 'unknown'}:${coords.step}`)
          if (open && open.firstTokenAt === undefined) open.firstTokenAt = number(frame.time)
        }
        this.appendStreamChunk(sessionId, text, number(frame.time))
      }
      return
    }
    // type 'end': a committed attempt is finalized by the following
    // assistant/message (or assistant/attempt) event; abandoned ones need no
    // bubble change. The stream chunk bubble is finalized at turn/end.
  }
  private appendStreamChunk(sessionId: string, text: string, time: number): void {
    const existing = this.messages.find((item) => item.id === `${sessionId}:stream`)
    const next: ChatItem = { id: `${sessionId}:stream`, kind: 'assistant', text: `${existing?.text ?? ''}${text}`.slice(0, MAX_TEXT), time, streaming: true }
    this.messages = [...this.messages.filter((item) => item.id !== next.id), next].slice(-MAX_ITEMS)
    this.emit()
  }
  private cardProviderError(text: string, time: number, id: string): void {
    const code = classifyProviderError(text)
    if (this.turnErrorSeen(code, text)) return
    const err: ChatItem = { id, kind: 'error', label: 'Provider error', text, time, ...(code && { code }) }
    this.messages = [...this.messages, err].slice(-MAX_ITEMS)
    this.pushTrajectory(err, true)
  }
  private pushTrajectory(item: ChatItem, emit = true): void { this.trajectory = [...this.trajectory, item].slice(-MAX_ITEMS); if (emit) this.emit() }
  /** Returns true when this exact failure was already carded for the CURRENT
   * turn (DSH can deliver api-session/error plus turn/end for the same
   * failure, sometimes with different wrapping). Classified failures match
   * by stable code; unclassified ones keep the original containment-based
   * text comparison. The record resets on every turn/start. */
  private turnErrorSeen(code: ProviderErrorCode | undefined, text: string): boolean {
    const prev = this.turnErrorKey
    if (prev) {
      if (code && prev.code === code) return true
      if (!code && !prev.code && (prev.text === text || prev.text.includes(text) || (text.length > 24 && text.includes(prev.text)))) return true
    }
    this.turnErrorKey = { code, text }
    return false
  }
  private rememberEvent(sessionId: string, event: JsonRecord): boolean {
    const seq = finiteNumber(event.seq)
    if (seq === undefined) return true
    const id = `${sessionId}:${seq}`
    if (this.seenEventIds.has(id)) return false
    this.seenEventIds.add(id)
    if (this.seenEventIds.size > MAX_SEEN_EVENTS) this.seenEventIds.delete(this.seenEventIds.values().next().value as string)
    return true
  }
  private updateUsage(event: JsonRecord, type: string, time: number): void {
    const data = isRecord(event.data) ? event.data : {}
    const step = finiteNumber(data.step)
    const turn = finiteNumber(data.turn)
    const key = step === undefined ? undefined : `${turn ?? 'unknown'}:${step}`
    const current = () => this.usage ?? { turns: 0, steps: 0, llmLatency: 0, ttftAvg: 0, tokenThroughput: 0, cacheHitRate: 0, inputTokens: 0, outputTokens: 0 }
    if (type === 'turn/start') { const value = current(); this.usage = { ...value, turns: value.turns + 1 }; return }
    if (type === 'step/start' && key) { this.usage = current(); this.openSteps.set(key, { startedAt: time }); return }
    if (type === 'assistant/chunk' && key) { const open = this.openSteps.get(key); if (open && open.firstTokenAt === undefined && eventText(event)) open.firstTokenAt = time; return }
    if (type === 'assistant/message' && key) {
      const open = this.openSteps.get(key)
      if (!open) return
      const value = current()
      const message = isRecord(data.message) ? data.message : {}
      const report = isRecord(data.usage) ? data.usage : isRecord(message.usage) ? message.usage : {}
      // 0.1.5 TokenUsage names the non-cached count uncachedInputTokens.
      const inputTokens = finiteNumber(report.inputTokens) ?? finiteNumber(report.uncachedInputTokens) ?? 0
      const outputTokens = finiteNumber(report.outputTokens) ?? 0
      this.cacheReadTokens += finiteNumber(report.cacheReadTokens) ?? finiteNumber(report.cachedInputTokens) ?? 0
      if (open.firstTokenAt !== undefined) {
        this.totalTtft += Math.max(0, open.firstTokenAt - open.startedAt); this.ttftSamples += 1
        if (outputTokens > 0) { this.decodeTokens += outputTokens; this.decodeMs += Math.max(0, time - open.firstTokenAt) }
      }
      const nextInputTokens = value.inputTokens + inputTokens
      this.usage = { ...value, llmLatency: value.llmLatency + Math.max(0, time - open.startedAt), ttftAvg: this.ttftSamples ? Math.round(this.totalTtft / this.ttftSamples) : 0, tokenThroughput: this.decodeMs ? Math.round(this.decodeTokens / (this.decodeMs / 1_000)) : 0, cacheHitRate: nextInputTokens ? Math.round(this.cacheReadTokens / nextInputTokens * 100) : 0, inputTokens: nextInputTokens, outputTokens: value.outputTokens + outputTokens }
      this.openSteps.delete(key)
      return
    }
    if (type === 'step/end') { const value = current(); this.usage = { ...value, steps: value.steps + 1 }; if (key) this.openSteps.delete(key) }
  }
  private ingestEvent(sessionId: string, event: JsonRecord): void {
    if (!this.rememberEvent(sessionId, event)) return
    const type = string(event.type, 80) ?? 'event'; const seq = number(event.seq); const time = number(event.time)
    this.updateUsage(event, type, time)
    if (type === 'user/message' && (!isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user')) {
      this.pushTrajectory({ id: `${sessionId}:${seq}`, kind: 'trajectory', label: 'Updated context', text: 'Workspace context was refreshed for this turn.', time })
      return
    }
    if (type === 'user/message' || type === 'assistant/message') {
      const text = eventText(event); if (text) { const item: ChatItem = { id: `${sessionId}:${seq}`, kind: type === 'user/message' ? 'user' : 'assistant', text, time }; this.messages = [...this.messages.filter((entry) => entry.id !== item.id && !(item.kind === 'user' && entry.id.startsWith('accepted-') && entry.text === item.text) && !(item.kind === 'assistant' && entry.id === `${sessionId}:stream`)), item].slice(-MAX_ITEMS) }
    } else {
      const traj = trajectoryFor(event, type)
      if (traj) this.pushTrajectory({ id: `${sessionId}:${seq}`, kind: traj.kind, label: traj.label, text: traj.text, time }, false)
      if (type === 'turn/end') {
        this.running = false
        this.stopPromptWatch()
        this.messages = this.messages.map((item) => item.id === `${sessionId}:stream` ? { ...item, streaming: false } : item)
        // Some reverse-engineered ChatGPT-web gateways answer HTTP 200 + SSE
        // and then inject an error mid-stream — either as fake assistant
        // content ("copy the ChatGPT session id…") or as an empty 0-token
        // error event. DSH reports it here as reason.kind === 'error'.
        // Surface the PROVIDER'S message instead of swallowing it; each
        // failed turn gets its own card (turnErrorSeen only dedups the
        // same-turn double delivery). 'aborted' (our own cancel) stays silent.
        const data = isRecord(event.data) ? event.data : {}
        const reason = isRecord(data.reason) ? data.reason : undefined
        if (reason && reason['kind'] === 'error') {
          const detail = isRecord(reason['error']) ? reason['error'] : isRecord(reason['failure']) ? reason['failure'] : {}
          const msg = string(detail['message']) ?? string(reason['error']) ?? string(reason['message']) ?? 'The model provider returned an error.'
          this.cardProviderError(msg, time, `turn-error-${sessionId}-${seq}`)
        }
        this.emit()
        return
      }
    }
    if (type === 'turn/start') {
      this.running = true
      // New turn → each turn is allowed its own error card again (identical
      // gateway failures across turns must not silently vanish).
      this.turnErrorKey = undefined
    }
    this.emit()
  }

  // ── HTTP RPC (0.1.5 slashed endpoints, named args under payload.args) ─────

  private async rpc<T>(endpoint: string, args: JsonRecord = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.origin) throw new Error('Local Agent is not ready')
    let response: Response
    try {
      response = await fetch(`${this.origin}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: this.cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new Error(`Local Agent unreachable for ${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const bodyText = await response.text().catch(() => '')
    if (!response.ok) throw new Error(`Local Agent HTTP ${response.status} on ${endpoint}: ${bodyText.slice(0, 400)}`)
    let envelope: unknown
    try { envelope = JSON.parse(bodyText) } catch { throw new Error(`Local Agent returned invalid JSON from ${endpoint}: ${bodyText.slice(0, 200)}`) }
    if (!isRecord(envelope) || envelope.type !== 'server-response' || !isRecord(envelope.result)) {
      throw new Error(`Local Agent RPC malformed ${endpoint}: ${bodyText.slice(0, 400)}`)
    }
    const result = envelope.result
    if (result.ok !== true) {
      const error = isRecord(result.error) ? result.error : {}
      const code = string(error.code, 200) ?? 'rpc/error'
      const message = string(error.message, 600) ?? 'The Local Agent rejected the request.'
      const err = new Error(`${message} (${code})`) as Error & { code?: string; details?: unknown }
      err.code = code
      if (error.details !== undefined) err.details = error.details
      throw err
    }
    return result.value as T
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async listSessions(): Promise<AgentConversation> {
    const value = await this.rpc<{ items?: unknown }>('session/list', { _request: {} })
    const rows = Array.isArray(value.items) ? value.items : []
    this.sessions = rows.flatMap((row): AgentSession[] => {
      if (!isRecord(row)) return []
      const id = validId(row.sessionId); if (!id) return []
      const title = isRecord(row.projections) && isRecord(row.projections.values) ? string(row.projections.values.title, 120) : undefined
      return [{ id, title: title || (row.blank === true ? 'New conversation' : 'Untitled conversation'), updatedAt: number(row.updatedAt), running: row.running === true, cwd: string(row.cwd, 2_000) }]
    }).sort((a, b) => b.updatedAt - a.updatedAt)
    if (this.selectedSessionId && !this.sessions.some((item) => item.id === this.selectedSessionId)) this.resetSelectedSession()
    this.emit(); return this.snapshot()
  }
  async createSession(cwd: string): Promise<AgentConversation> {
    const value = await this.rpc<{ sessionId?: unknown }>('session/create', { request: { cwd } })
    const id = validId(value.sessionId); if (!id) throw new Error('Local Agent returned an invalid session')
    await this.listSessions(); this.resetSelectedSession(); this.selectedSessionId = id; this.openFollow(id); this.emit(); return this.snapshot()
  }
  async selectSession(sessionId: string, cwd: string): Promise<AgentConversation> {
    if (!this.sessions.some((item) => item.id === sessionId)) await this.listSessions()
    const session = this.sessions.find((item) => item.id === sessionId)
    if (!session || session.cwd !== cwd) throw new Error('Conversation is not available in this workspace')
    this.resetSelectedSession(); this.selectedSessionId = sessionId; this.running = session.running
    this.openFollow(sessionId)  // snapshot rehydrates history; live frames keep it current
    this.emit()
    return this.snapshot()
  }
  async prompt(text: string, attachments?: readonly Attachment[]): Promise<AgentConversation> {
    const sessionId = this.selectedSessionId; if (!sessionId) throw new Error('Choose a conversation first')
    const hasAttachments = !!(attachments && attachments.length)
    const attachmentNote = hasAttachments
      ? `\n\n[Attached files: ${attachments!.map(a => `${a.name} (${a.type}, ${a.size} bytes)`).join('; ')}]`
      : ''
    const promptText = (text || 'Please analyze the attached file(s).') + attachmentNote
    const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: promptText }]
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    // 0.1.5 requires a client-minted requestId on every queued prompt.
    await this.rpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content, clientTimeZone: timeZone } })
    const displayText = text || (hasAttachments ? `Analyzing ${attachments!.length} attachment${attachments!.length !== 1 ? 's' : ''}` : '')
    const accepted: ChatItem = { id: `accepted-${randomUUID()}`, kind: 'user', text: displayText, time: Date.now(), attachments: attachments ? [...attachments] : undefined }
    this.messages = [...this.messages, accepted].slice(-MAX_ITEMS)
    this.running = true; this.emit()
    this.startPromptWatch(sessionId)
    return this.snapshot()
  }
  private startPromptWatch(sessionId: string): void {
    this.stopPromptWatch()
    // Inactivity — not wall-clock — timeout: a turn stays alive as long as
    // follow frames keep arriving. The 60s allowance covers slow-to-first-token
    // reasoning models and gateways that stall before responding; only TOTAL
    // silence past that means the turn is stuck, so fail with an honest
    // message and cancel.
    const IDLE_LIMIT_MS = 60_000
    const watch = { sessionId, lastActivity: Date.now(), timer: undefined as unknown as NodeJS.Timeout }
    watch.timer = setInterval(() => {
      if (this.promptWatch !== watch || this.selectedSessionId !== sessionId) { this.stopPromptWatch(); return }
      if (!this.running) { this.stopPromptWatch(); return }
      if (Date.now() - watch.lastActivity < IDLE_LIMIT_MS) return
      console.log('[host-bridge] prompt inactivity timeout for session', sessionId)
      this.stopPromptWatch()
      this.running = false
      const timeoutErr: ChatItem = { id: `timeout-${randomUUID()}`, kind: 'error', text: 'The Agent did not receive any response from the model provider for 60 seconds. The gateway may be slow, unstable, or unreachable — check that the base URL is reachable and the API key is valid, then try again.', time: Date.now() }
      this.messages = [...this.messages, timeoutErr].slice(-MAX_ITEMS)
      this.pushTrajectory({ ...timeoutErr, label: 'Request timed out' }, false)  // also to trajectory panel
      this.emit()
      void this.cancel().catch(() => undefined)
    }, 5_000)
    this.promptWatch = watch
  }
  private stopPromptWatch(): void {
    if (!this.promptWatch) return
    clearInterval(this.promptWatch.timer)
    this.promptWatch = undefined
  }
  async cancel(): Promise<void> {
    this.stopPromptWatch()
    if (this.selectedSessionId) { await this.rpc('session/cancel', { request: { sessionId: this.selectedSessionId } }); this.running = false; this.emit() }
  }

  // ── Slash commands + skills ───────────────────────────────────────────────

  async listCommands(): Promise<{ name: string; description: string; input?: { hint?: string; images?: boolean } }[]> {
    type Cmd = { name: string; description: string; input?: { hint?: string; images?: boolean; attachments?: boolean } }
    let commands: Cmd[] = []
    if (this.selectedSessionId) {
      try {
        const live = await this.rpc<unknown[]>('commands/list', { agentId: this.selectedSessionId })
        commands = Array.isArray(live) ? live.flatMap((row) => isRecord(row) && typeof row.name === 'string' && typeof row.description === 'string'
          ? [{ name: row.name, description: row.description, ...(isRecord(row.input) ? { input: { hint: string(row.input.hint, 200), attachments: row.input.attachments === true } } : {}) }]
          : []) : []
      } catch (e) { console.warn('[narwhal] commands/list failed:', e) }
    }
    if (commands.length === 0) {
      // Fallback mirror of the six commands 0.1.5 registers out of the box.
      commands = [
        { name: 'compact', description: 'Compact older conversation history' },
        { name: 'export', description: 'Download this Session log as a ZIP archive' },
        { name: 'feedback', description: 'Record feedback about this session', input: { hint: '<text>' } },
        { name: 'goal', description: 'Set or view the goal for a long-running task', input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' } },
        { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
        { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
      ]
    }
    let skillList: { name: string; description: string }[] = []
    try {
      if (this.selectedSessionId) {
        const value = await this.rpc<{ skills?: unknown[] }>('skills/list', { request: { sessionId: this.selectedSessionId } })
        skillList = (value.skills ?? []).flatMap((row) => {
          if (!isRecord(row) || typeof row.name !== 'string' || typeof row.description !== 'string') return []
          return [{ name: row.name, description: row.description }]
        })
      }
    } catch (e) { console.warn('[narwhal] skills/list failed:', e) }
    const seen = new Set(commands.map((c) => c.name))
    const result: { name: string; description: string; input?: { hint?: string; images?: boolean } }[] = [...commands]
    for (const s of skillList) if (!seen.has(s.name)) { result.push({ ...s, input: { hint: 'optional arguments' } }); seen.add(s.name) }
    return result
  }
  async executeCommand(line: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    if (!this.selectedSessionId) throw new Error('Choose a conversation first')
    // Parse "/name args..." into command name and remaining args
    const match = line.match(/^\/([A-Za-z0-9_-]+)(?:\s*(.*))?$/s)
    if (!match) return { kind: 'error', text: 'Invalid slash command format' }
    const name = match[1].toLowerCase()
    const sessionId = this.selectedSessionId
    try {
      if (name === 'goal' && (match[2] ?? '').trim() === '') return this.execGoalView(sessionId)
      // Every built-in command is dispatched natively in 0.1.5 (compact,
      // export, feedback, goal, permission, plan). compaction can run long,
      // so give the RPC a generous timeout.
      const native = new Set(['compact', 'export', 'feedback', 'goal', 'permission', 'plan'])
      if (native.has(name)) {
        const normalized = name === 'permission' ? this.normalizePermissionLine(line) : line
        const out = await this.rpc<{ result?: { kind?: string; text?: string } } | undefined>('commands/execute', { agentId: sessionId, line: normalized, submittedAttachments: [] }, 120_000)
        if (out === undefined) return { kind: 'error', text: `Unknown command: /${name}` }
        const result = out.result ?? {}
        return { kind: result.kind === 'error' ? 'error' : 'success', ...(typeof result.text === 'string' ? { text: result.text } : {}) }
      }
      // Unknown command — could be a skill. Queue it as a prompt so the model
      // sees it. Graceful degradation for skill-loaded sessions.
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      await this.rpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: line }], clientTimeZone: timeZone } })
      this.running = true; this.emit()
      this.startPromptWatch(sessionId)
      return { kind: 'success' }
    } catch (e) {
      console.warn('[narwhal] executeCommand failed:', e)
      return { kind: 'error', text: e instanceof Error ? e.message : String(e) }
    }
  }
  private normalizePermissionLine(line: string): string {
    // 0.1.5 preset ids: read-only | workspace-write | danger-full-access.
    const aliases: Record<string, string> = { safe: 'workspace-write', 'full-access': 'danger-full-access' }
    return line.replace(/^(\/permission\s+)(\S+)\s*$/u, (whole, head: string, preset: string) => `${head}${aliases[preset] ?? preset}`)
  }
  /** /goal with no args — read the live goal projection from session/list. */
  private async execGoalView(sessionId: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    const current = await this.fetchCurrentGoal(sessionId)
    if (!current) return { kind: 'success', text: 'No active goal. Use `/goal <objective>` to set one.' }
    const phase = current.goal.phase ?? 'unknown'
    return { kind: 'success', text: `Current goal (${phase}): "${current.goal.objective}"` }
  }
  /** Fetch the current session's goal ref from the session list projection. */
  private async fetchCurrentGoal(sessionId: string): Promise<{ goal: { id: string; revision: number; objective: string; phase?: string } } | undefined> {
    try {
      const list = await this.rpc<{ items?: unknown[] }>('session/list', { _request: {} })
      const items = list?.items ?? []
      for (const raw of items) {
        if (!isRecord(raw) || raw.sessionId !== sessionId) continue
        const projsObj = raw.projections as Record<string, unknown> | undefined
        const projs = (projsObj && isRecord(projsObj.values) ? projsObj.values : null) as Record<string, unknown> | null
        const goal = projs && isRecord(projs.goal) ? projs.goal : null
        const inner = goal && isRecord(goal.goal) ? goal.goal : null
        if (inner && typeof inner.id === 'string' && typeof inner.revision === 'number') {
          return { goal: { id: inner.id, revision: inner.revision, objective: typeof inner.objective === 'string' ? inner.objective : '', phase: typeof inner.phase === 'string' ? inner.phase : undefined } }
        }
        return undefined
      }
    } catch { /* ignore */ }
    return undefined
  }

  // ── Configuration: providers, models, permission ──────────────────────────

  private async settingsDescribe(): Promise<{ writable: boolean; namespaces: JsonRecord[] }> {
    const value = await this.rpc<{ writable?: unknown; namespaces?: unknown }>('settings/describe', {})
    return { writable: value.writable === true, namespaces: Array.isArray(value.namespaces) ? value.namespaces.filter(isRecord) : [] }
  }
  private async configurableProviders(): Promise<JsonRecord[]> {
    // Every route the pi-ai adapter knows about (declared or catalog-only),
    // plus built-ins such as deepseek-official.
    const value = await this.rpc<unknown[]>('llm/listConfigurableProviders', {})
    return Array.isArray(value) ? value.filter(isRecord) : []
  }

  private async configuration(): Promise<AgentConfiguration> {
    try {
      const [activeResult, catalogResult, settingsResult] = await Promise.allSettled([
        this.rpc<unknown[]>('llm/listProviders', {}),
        this.rpc<{ default?: unknown; groups?: unknown }>('session/modelCatalog', {}),
        this.settingsDescribe(),
      ])
      const activeProviders = activeResult.status === 'fulfilled' && Array.isArray(activeResult.value)
        ? new Set(activeResult.value.flatMap((row) => isRecord(row) && typeof row.id === 'string' ? [row.id] : []))
        : new Set<string>()
      const catalogValue = catalogResult.status === 'fulfilled' ? catalogResult.value : { groups: [] as unknown[] }
      if (activeResult.status === 'rejected') this.pushTrajectory({ id: `cfg-providers-${Date.now()}`, kind: 'error', label: 'Provider list unavailable', text: 'Some provider data could not be loaded.', time: Date.now() })
      if (catalogResult.status === 'rejected') this.pushTrajectory({ id: `cfg-models-${Date.now()}`, kind: 'error', label: 'Model list unavailable', text: 'Some model data could not be loaded.', time: Date.now() })
      const { writable, namespaces } = settingsResult.status === 'fulfilled' ? settingsResult.value : { writable: false, namespaces: [] as JsonRecord[] }

      const configurable = await this.configurableProviders().catch(() => [] as JsonRecord[])
      const nsById = new Map(namespaces.map((ns) => [string(ns.ns, 120), ns]))
      const profileAt = (ns: string | undefined, path: readonly string[]): JsonRecord | undefined => {
        if (!ns) return undefined
        const section = nsById.get(ns)
        if (!section || !isRecord(section.value)) return undefined
        const profile = path.length === 0 ? section.value : valueAt(section.value, path)
        return isRecord(profile) ? profile : undefined
      }
      // Provider rows worth showing: declared (configured) rows plus anything
      // Narwhal's own config.json knows about (covers settings.yaml-provisioned
      // providers across restarts).
      const cfg = getConfig()
      const configIds = new Set(Object.keys(cfg.providers ?? {}))
      const rows = configurable.filter((row) => row.declared === true || (typeof row.provider === 'string' && configIds.has(row.provider)))
      const references: string[] = []
      const coords = rows.flatMap((row) => {
        const id = validId(row.provider); const ns = string(row.settingsNs, 120)
        const path = Array.isArray(row.settingsPath) && row.settingsPath.every((p) => typeof p === 'string') ? row.settingsPath as string[] : []
        const profile = id ? profileAt(ns, path) : undefined
        const ref = id && profile ? credentialRefFor(id, profile) : undefined
        if (id && ref) references.push(ref)
        return id ? [{ id, ns, path, profile, ref, displayName: string(row.displayName, 120) }] : []
      })
      // config.json providers the Host does not list at all.
      for (const idRaw of configIds) {
        if (coords.some((c) => c.id === idRaw)) continue
        const profile = isRecord(cfg.providers?.[idRaw]) ? cfg.providers![idRaw] as JsonRecord : undefined
        const id = validId(idRaw)
        const ref = id && profile ? credentialRefFor(id, profile) : undefined
        if (id && ref) references.push(ref)
        if (id) coords.push({ id, ns: undefined, path: [], profile: profile ?? undefined, ref, displayName: profile ? string(profile.displayName, 120) ?? id : id })
      }
      const credentialMap: Record<string, { configured?: boolean; writable?: boolean }> = references.length
        ? await this.rpc<Record<string, { configured?: boolean; writable?: boolean }>>('credentials/describe', { refs: references }).catch(() => ({}))
        : {}
      const normalizedProviders: ProviderSetting[] = coords.flatMap((c) => {
        const profile = c.profile ?? (isRecord(cfg.providers?.[c.id]) ? cfg.providers![c.id] as JsonRecord : undefined)
        if (!profile) return []
        const name = c.displayName ?? string(profile.displayName, 120) ?? c.id
        const credential = c.ref && isRecord(credentialMap[c.ref]) ? credentialMap[c.ref] : undefined
        return [{
          id: c.id,
          name,
          active: activeProviders.has(c.id),
          apiKeyConfigured: credential?.configured === true,
          apiKeyWritable: credential ? credential.writable === true : c.ref !== undefined,
          baseUrl: string(profile.baseURL, 600),
          protocol: string(profile.api, 80) ?? 'openai-completions',
        }]
      })
      function detectProtocol(protocol: string | undefined, providerId: string, baseUrl: string | undefined, modelIds: string[]): string {
        if (protocol) return protocol
        const lowerId = providerId.toLowerCase()
        if (lowerId.includes('deepseek')) return 'deepseek'
        if (lowerId.includes('anthropic') || lowerId.includes('claude')) return 'anthropic'
        const url = (baseUrl ?? '').toLowerCase()
        if (url.includes('openai') || url.includes('deepseek')) return 'openai'
        if (url.includes('anthropic') || url.includes('claude')) return 'anthropic'
        const hasOpenAIPattern = modelIds.some((m) => /^(gpt|o[1-9]|sora)-/.test(m.toLowerCase()))
        if (hasOpenAIPattern) return 'openai'
        const hasAnthropicPattern = modelIds.some((m) => /^claude-/.test(m.toLowerCase()))
        if (hasAnthropicPattern) return 'anthropic'
        return ''
      }
      const providerInfoMap = new Map<string, { protocol: string; baseUrl: string | undefined }>()
      for (const p of normalizedProviders) { providerInfoMap.set(p.id, { protocol: p.protocol ?? '', baseUrl: p.baseUrl }) }
      const models: ModelProvider[] = (Array.isArray(catalogValue.groups) ? catalogValue.groups : []).flatMap((group) => {
        if (!isRecord(group)) return []; const id = validId(group.id); const name = string(group.name, 120); const modelRows = Array.isArray(group.models) ? group.models : []
        if (!id || !name) return []
        const info = providerInfoMap.get(id) ?? { protocol: '', baseUrl: undefined }
        const modelIds = modelRows.flatMap((m) => { if (!isRecord(m)) return []; const mid = string(m.id, 160); return mid ? [mid] : [] })
        const protocol = detectProtocol(info.protocol, id, info.baseUrl, modelIds)
        return [{ id, name, models: modelRows.flatMap((model) => {
          if (!isRecord(model)) return []; const modelId = string(model.id, 160); const modelName = string(model.name, 160); if (!modelId || !modelName) return []
          const reasoning = isRecord(model.reasoning) ? model.reasoning : {}
          const rawEfforts = Array.isArray(reasoning.efforts) ? reasoning.efforts.flatMap((effort) => isRecord(effort) && string(effort.id, 100) && string(effort.name, 100) ? [{ id: string(effort.id, 100)!, name: string(effort.name, 100)!, description: string(effort.description, 300) }] : []) : []
          const isOpenAI = protocol.includes('openai')
          const isAnthropic = protocol.includes('anthropic')
          // Fallback efforts: when DSH reports no native reasoning metadata,
          // OpenAI-compatible models get the full five-level ladder and
          // Anthropic models low/medium/high. Displayed in the UI; the host
          // persists the pick per model and degrades gracefully if DSH
          // rejects session/selectModel with an effort the model lacks.
          const useFallbackEfforts = rawEfforts.length === 0 && (isOpenAI || isAnthropic)
          const fallbackEfforts = useFallbackEfforts ? fallbackReasoningEfforts(protocol) : []
          const efforts = useFallbackEfforts ? fallbackEfforts : rawEfforts
          const defaultEffort = string(reasoning.defaultEffort, 100) ?? (useFallbackEfforts ? 'medium' : undefined)
          return [{ id: modelId, name: modelName, description: string(model.description, 300), efforts, defaultEffort, effortsNative: !useFallbackEfforts }]
        }) }]
      })
      // Also merge models from config.json for custom providers the catalog
      // does not expose (pi-ai routes with hand-declared model lists).
      const modelGroupIds = new Set(models.map((m) => m.id))
      for (const [idRaw, profile] of Object.entries(cfg.providers ?? {})) {
        if (modelGroupIds.has(idRaw) || !isRecord(profile) || !Array.isArray(profile.models)) continue
        const groupId = validId(idRaw); const groupName = string(profile.displayName, 120) ?? groupId
        if (!groupId || !groupName) continue
        const info = providerInfoMap.get(groupId) ?? { protocol: '', baseUrl: string(profile.baseURL, 600) }
        const flatModelIds = profile.models.flatMap((m) => string(isRecord(m) ? m.id : undefined, 160) ?? [])
        const protocol = detectProtocol(info.protocol, groupId, info.baseUrl, flatModelIds)
        const providerModels = profile.models.flatMap((m) => {
          if (!isRecord(m)) return []
          const mid = string(m.id, 160); const mname = string(m.name, 160) ?? mid
          if (!mid || !mname) return []
          const isOpenAI = protocol.includes('openai')
          const isAnthropic = protocol.includes('anthropic')
          const useFallbackEfforts = isOpenAI || isAnthropic
          const fallbackEfforts = useFallbackEfforts ? fallbackReasoningEfforts(protocol) : []
          return [{ id: mid, name: mname, description: '', efforts: fallbackEfforts, defaultEffort: useFallbackEfforts ? 'medium' : undefined, effortsNative: false }]
        })
        if (providerModels.length) models.push({ id: groupId, name: groupName, models: providerModels })
      }
      const permission = namespaces.find((entry) => string(entry.ns, 100) === 'permission')
      const permissionValue = permission && isRecord(permission.value) ? permission.value : {}
      // Selected model: the live session projection wins; otherwise the
      // catalog's global default; a per-model local preference fills effort.
      let selected: { provider: string; model: string; reasoningEffort?: string } | undefined
      const liveSelection = await this.liveModelSelection()
      const catalogDefault = isRecord(catalogValue.default) ? catalogValue.default : undefined
      const currentProvider = string(liveSelection?.provider ?? catalogDefault?.provider, 120)
      const currentModel = string(liveSelection?.model ?? catalogDefault?.model, 160)
      const baseReasoning = string(liveSelection?.reasoningEffort ?? catalogDefault?.reasoningEffort, 100)
      let prefReasoning: string | undefined
      try {
        if (currentProvider && currentModel) prefReasoning = string(getConfig().modelPreferences?.[`${currentProvider}/${currentModel}`]?.reasoningEffort, 100)
      } catch { /* ignore */ }
      const finalReasoningEffort = baseReasoning ?? prefReasoning
      if (currentProvider && currentModel) selected = { provider: currentProvider, model: currentModel, ...(finalReasoningEffort ? { reasoningEffort: finalReasoningEffort } : {}) }
      return { available: true, writable, providers: normalizedProviders, models, defaultPermission: string(permissionValue.defaultPreset, 100), permissionOptions: permission ? permissionOptions(permission.schema) : [], customProvider: customProviderCapability(namespaces, writable), selectedModel: selected }
    } catch (error) { return { available: false, writable: false, providers: [], models: [], permissionOptions: [], customProvider: { available: false, protocols: [], reason: 'Local Agent configuration is unavailable.' }, error: error instanceof Error ? error.message : 'Local Agent configuration is unavailable' } }
  }
  /** modelSelection.lastUsed for the selected session from session/list projections. */
  private async liveModelSelection(): Promise<{ provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined> {
    if (!this.selectedSessionId) return undefined
    try {
      const list = await this.rpc<{ items?: unknown[] }>('session/list', { _request: {} })
      for (const raw of list.items ?? []) {
        if (!isRecord(raw) || raw.sessionId !== this.selectedSessionId) continue
        const values = isRecord(raw.projections) && isRecord(raw.projections.values) ? raw.projections.values : undefined
        // 0.1.5 keeps two slots: `next` is the selection that will serve the
        // next turn (updated immediately by session/selectModel); lastUsed
        // only changes once a turn actually ran. The model button must mirror
        // the pending `next`, otherwise the UI snaps back to the old model.
        const modelSelection = values && isRecord(values.modelSelection) ? values.modelSelection : undefined
        const selection = modelSelection && (isRecord(modelSelection.next) ? modelSelection.next : isRecord(modelSelection.lastUsed) ? modelSelection.lastUsed : undefined)
        return selection
      }
    } catch { /* best-effort */ }
    return undefined
  }
  async getConfiguration(): Promise<AgentConfiguration> { return this.configuration() }
  private isReasoningUnsupported(err: unknown): boolean {
    // rpc() throws Error with stable DSH code "model-unavailable" when a
    // reasoning effort is not supported by the selected model.
    return err instanceof Error && (err as Error & { code?: string }).code === 'session/model-unavailable'
      && err.message.includes('reasoning effort')
  }
  async selectModel(provider: string, model: string, explicitEffort?: string): Promise<AgentConfiguration> {
    const prefKey = `${provider}/${model}`
    // Distinguish two intents:
    //   • explicit effort change (3rd arg provided) → persist per-model preference
    //   • plain model switch (3rd arg omitted)       → reuse the saved preference for THIS
    //     model, and never overwrite it with a hardcoded default.
    const explicit = explicitEffort !== undefined
    let effectiveEffort: string | undefined
    try {
      const existingPrefs = getConfig().modelPreferences ?? {}
      if (explicit) {
        const nextPrefs = { ...existingPrefs }
        if (explicitEffort) nextPrefs[prefKey] = { ...(nextPrefs[prefKey] ?? {}), reasoningEffort: explicitEffort }
        await saveConfig({ modelPreferences: nextPrefs })
        effectiveEffort = explicitEffort || undefined
      } else {
        effectiveEffort = string(existingPrefs[prefKey]?.reasoningEffort, 100)
      }
    } catch (err) {
      console.warn('[narwhal] selectModel: modelPreferences update failed:', err instanceof Error ? err.message : String(err))
      if (!explicit) effectiveEffort = undefined
    }
    // Step 1: If a session is selected, update its current model (session-scoped).
    // DSH rejects effort for fallback providers → retry the model switch without it
    // (the effort is still remembered locally in modelPreferences).
    if (this.selectedSessionId) {
      try {
        await this.rpc('session/selectModel', { request: { sessionId: this.selectedSessionId, provider, model, ...(effectiveEffort && { reasoningEffort: effectiveEffort }) } })
      } catch (err) {
        if (effectiveEffort && this.isReasoningUnsupported(err)) {
          console.warn('[narwhal] selectModel: DSH rejected reasoningEffort, retrying without (kept as local preference)')
          await this.rpc('session/selectModel', { request: { sessionId: this.selectedSessionId, provider, model } })
        } else throw err
      }
    }
    // Step 2: Update DSH agent-default-model namespace (global default),
    // gracefully dropping reasoningEffort if DSH rejects it.
    try {
      const { namespaces } = await this.settingsDescribe()
      const existingDefaultNs = namespaces.find((ns) => string(ns.ns, 100) === 'agent-default-model')
      const applyNs = async (nsRev: number) => {
        const val: JsonRecord = { provider, model }
        if (effectiveEffort) val.reasoningEffort = effectiveEffort
        try {
          await this.rpc('settings/mutate', { ns: 'agent-default-model', ops: [{ op: 'set', path: [], value: val }], expectedRevision: nsRev })
        } catch (mutErr) {
          if (effectiveEffort && this.isReasoningUnsupported(mutErr)) {
            await this.rpc('settings/mutate', { ns: 'agent-default-model', ops: [{ op: 'set', path: [], value: { provider, model } }], expectedRevision: nsRev })
          } else throw mutErr
        }
      }
      if (existingDefaultNs && typeof existingDefaultNs.revision === 'number') {
        await applyNs(existingDefaultNs.revision)
      } else {
        const anyNsRev = namespaces.find((ns) => typeof ns.revision === 'number')?.revision as number | undefined
        if (anyNsRev !== undefined) await applyNs(anyNsRev)
      }
    } catch (err) {
      console.warn('[narwhal] selectModel: settings/mutate failed:', err instanceof Error ? err.message : String(err))
    }
    // Step 3: Remember the active model (+its effective effort) for startup default.
    try {
      await saveConfig({ defaultModel: { provider, model, ...(effectiveEffort ? { reasoningEffort: effectiveEffort } : {}) } })
    } catch (err) {
      console.warn('[narwhal] selectModel: saveConfig defaultModel failed:', err instanceof Error ? err.message : String(err))
    }
    // Step 4: configuration() merges DSH session effort + the per-model preference.
    return this.configuration()
  }
  async setDefaultPermission(preset: string): Promise<AgentConfiguration> {
    const config = await this.configuration(); const option = config.permissionOptions.find((item) => item.id === preset); if (!option) throw new Error('Permission preset is unavailable')
    const { namespaces } = await this.settingsDescribe()
    const permission = namespaces.find((item) => string(item.ns, 100) === 'permission'); if (!isRecord(permission) || typeof permission.revision !== 'number') throw new Error('Permission settings are unavailable')
    await this.rpc('settings/mutate', { ns: 'permission', ops: [{ op: 'set', path: ['defaultPreset'], value: option.id }], expectedRevision: permission.revision }); return this.configuration()
  }
  async setProviderApiKey(providerId: string, value: string): Promise<AgentConfiguration> {
    const key = value.trim()
    if (!/^[\x21-\x7E]+$/u.test(key) || /^(?:[A-Za-z_][A-Za-z0-9_]*)=/u.test(key)) throw new Error('API key format is invalid')
    const config = await this.configuration()
    const provider = config.providers.find((item) => item.id === providerId)
    if (!provider?.apiKeyWritable) throw new Error('This provider does not accept a local API key')
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!resolved) throw new Error('Provider settings are unavailable')
    const { ns, path } = resolved
    const { namespaces } = await this.settingsDescribe()
    const section = namespaces.find((item) => string(item.ns, 100) === ns)
    const profile = section && isRecord(section.value) ? valueAt(section.value, path) : undefined
    if (!isRecord(profile)) throw new Error('Provider configuration is unavailable')
    const reference = credentialRefFor(providerId, profile)
    if (!reference) throw new Error('Provider credential is unavailable')
    await this.rpc('credentials/set', { ref: reference, value: key })
    return this.configuration()
  }
  async setProviderBaseUrl(providerId: string, value: string): Promise<AgentConfiguration> {
    const baseUrl = value.trim()
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Base URL must use HTTP or HTTPS')
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!resolved) throw new Error('Provider settings are unavailable')
    const { ns, path } = resolved
    const { namespaces } = await this.settingsDescribe()
    const section = namespaces.find((item) => string(item.ns, 100) === ns)
    if (!section || typeof section.revision !== 'number') throw new Error('Provider settings are unavailable')
    await this.rpc('settings/mutate', { ns, ops: [{ op: 'set', path: [...path, 'baseURL'], value: baseUrl }], expectedRevision: section.revision })
    // Persist to config.json
    try {
      const cfg = getConfig()
      const currentProviders = { ...(cfg.providers ?? {}) }
      const existing = currentProviders[providerId] ?? {}
      currentProviders[providerId] = { ...(existing as JsonRecord), baseURL: baseUrl }
      await saveConfig({ providers: currentProviders })
    } catch (err) { console.warn('[narwhal] setProviderBaseUrl: saveConfig failed:', err instanceof Error ? err.message : String(err)) }
    return this.configuration()
  }
  async updateProvider(input: { provider: string; baseUrl?: string; modelIds?: string[] }): Promise<AgentConfiguration> {
    const providerId = input.provider
    // Pre-validate inputs locally before touching the runtime so an invalid
    // base URL or model ID fails without a round-trip.
    let baseUrl: string | undefined
    let modelIds: string[] | undefined
    if (input.baseUrl !== undefined) {
      const trimmed = input.baseUrl.trim()
      const url = new URL(trimmed)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Base URL must use HTTP or HTTPS')
      baseUrl = trimmed
    }
    if (input.modelIds !== undefined) {
      const trimmed = input.modelIds.map((m) => m.trim()).filter(Boolean)
      if (!trimmed.length) throw new Error('At least one model ID is required')
      trimmed.forEach((modelId) => { if (!validModelId(modelId)) throw new Error(`Model ID "${modelId}" is invalid`) })
      modelIds = trimmed
    }
    if (baseUrl === undefined && modelIds === undefined) return this.configuration()
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!resolved) throw new Error('Provider settings are unavailable')
    const { ns, path } = resolved
    const { namespaces } = await this.settingsDescribe()
    const section = namespaces.find((item) => string(item.ns, 100) === ns)
    if (!section || typeof section.revision !== 'number') throw new Error('Provider settings are unavailable')
    // Protocol comes from the existing stored profile (the edit form doesn't
    // resend it). Custom providers are openai-completions unless configured
    // otherwise — reasoning levels are only declared for the openai family.
    const existingApi = (getConfig().providers?.[providerId] as { api?: unknown } | undefined)?.api ?? 'openai-completions'
    const dshModels = modelIds ? modelsForDsh(modelIds, existingApi) : undefined
    const configModels = modelIds ? modelsForConfig(modelIds, existingApi) : undefined
    const ops: { op: 'set'; path: string[]; value: unknown }[] = []
    if (baseUrl !== undefined) ops.push({ op: 'set', path: [...path, 'baseURL'], value: baseUrl })
    if (dshModels !== undefined) ops.push({ op: 'set', path: [...path, 'models'], value: dshModels })
    await this.rpc('settings/mutate', { ns, ops, expectedRevision: section.revision })
    // Persist to config.json
    try {
      const cfg = getConfig()
      const currentProviders = { ...(cfg.providers ?? {}) }
      const existing = currentProviders[providerId] ?? {}
      const merged: JsonRecord = { ...(existing as JsonRecord) }
      if (baseUrl !== undefined) merged.baseURL = baseUrl
      if (configModels !== undefined) merged.models = configModels
      currentProviders[providerId] = merged
      await saveConfig({ providers: currentProviders })
    } catch (err) { console.warn('[narwhal] updateProvider: saveConfig failed:', err instanceof Error ? err.message : String(err)) }
    return this.configuration()
  }
  async deleteProvider(providerId: string): Promise<AgentConfiguration> {
    // Delete from config.json FIRST (authoritative store). If the provider
    // isn't even in config.json and DSH can't resolve it either, that's an
    // error — user is trying to delete something that doesn't exist.
    const cfg = getConfig()
    const inConfig = cfg.providers && providerId in cfg.providers
    // Try to resolve DSH namespace/path (may fail for config-only providers)
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!inConfig && !resolved) throw new Error('Provider not found')
    if (resolved && resolved.path.length === 0) throw new Error('Built-in providers cannot be removed')
    // 1) Remove from DSH settings namespace AND clear any stored API key.
    //    We need the current profile to derive the credential ref before we
    //    unset the settings path (after unset, the profile is gone and we
    //    can't compute the ref anymore).
    if (resolved) {
      let credentialRef: string | undefined
      try {
        const { namespaces } = await this.settingsDescribe()
        const section = namespaces.find((item) => string(item.ns, 100) === resolved.ns)
        if (section) {
          const profile = isRecord(section.value) ? valueAt(section.value, resolved.path) : undefined
          if (isRecord(profile)) credentialRef = credentialRefFor(providerId, profile)
          if (typeof section.revision === 'number') {
            await this.rpc('settings/mutate', { ns: resolved.ns, ops: [{ op: 'unset', path: resolved.path }], expectedRevision: section.revision })
          }
        }
      } catch (err) {
        console.warn('[narwhal] deleteProvider: DSH settings unset failed (config.json still being updated):', err instanceof Error ? err.message : String(err))
      }
      // Clear credential after settings are gone (best-effort). DSH rejects
      // credentials.set with empty value so we use credentials.unset instead.
      if (credentialRef) {
        try {
          // Verify it's actually configured before unsetting — avoids unnecessary calls.
          const desc = await this.rpc<Record<string, { configured?: boolean }>>('credentials/describe', { refs: [credentialRef] })
          const entry = desc[credentialRef]
          if (isRecord(entry) && entry.configured === true) {
            await this.rpc('credentials/unset', { ref: credentialRef })
            console.log(`[narwhal] deleteProvider: cleared credential ref=${credentialRef}`)
          }
        } catch (err) {
          console.warn('[narwhal] deleteProvider: credential unset failed:', err instanceof Error ? err.message : String(err))
        }
      }
    }
    // 2) Remove from config.json
    if (inConfig) {
      const currentProviders = { ...(cfg.providers ?? {}) }
      delete currentProviders[providerId]
      await saveConfig({ providers: currentProviders })
    }
    return this.configuration()
  }

  /** Resolve the { ns, path } for a provider in 0.1.5's configurable-provider
   *  catalog. A direct match works for both declared and catalog routes; if
   *  the Host has never heard of the id, borrow the llm-pi-ai path shape
   *  (`providers/<id>`) from any pi-ai catalog row. Returns null when no
   *  pi-ai namespace is visible at all. */
  private async resolveProviderNsPath(providerId: string): Promise<{ ns: string; path: string[] } | null> {
    try {
      const rows = await this.configurableProviders()
      const direct = rows.find((row) => row.provider === providerId)
      if (direct) {
        const ns = string(direct.settingsNs, 120)
        const pathArr = Array.isArray(direct.settingsPath) && direct.settingsPath.every((p) => typeof p === 'string') ? direct.settingsPath as string[] : undefined
        if (ns && pathArr) return { ns, path: pathArr }
      }
      const piAi = rows.find((row) => string(row.settingsNs, 120) === PIAI_SETTINGS_NS
        && Array.isArray(row.settingsPath) && (row.settingsPath as unknown[]).length >= 2
        && (row.settingsPath as unknown[])[0] === PIAI_PROVIDERS_PATH[0])
      if (!piAi) return null
      return { ns: PIAI_SETTINGS_NS, path: [PIAI_PROVIDERS_PATH[0], providerId] }
    } catch { return null }
  }

  async createProvider(input: { id: string; displayName?: string; baseUrl: string; protocol: string; modelIds: string[]; apiKey?: string }): Promise<CreateProviderResult> {
    const id = input.id.trim(); const displayName = input.displayName?.trim(); const baseUrl = input.baseUrl.trim(); const protocol = input.protocol.trim(); const modelIds = input.modelIds.map((m) => m.trim()).filter(Boolean); const apiKey = input.apiKey?.trim()
    const errors: string[] = []
    // Step 1: Validate provider ID
    if (!validCustomProviderId(id)) errors.push('Provider ID must start with a lowercase letter and contain only lowercase letters, digits, or hyphens (e.g. my-provider)')
    // Step 2: Validate display name
    if (displayName !== undefined && !displayName) errors.push('Display name cannot be empty when provided')
    // Step 3: Validate model IDs (at least one)
    if (!modelIds.length) errors.push('At least one model ID is required')
    modelIds.forEach((modelId) => {
      if (!validModelId(modelId)) errors.push(`Model ID "${modelId}" is invalid. Use letters, digits, dots, and underscores`)
    })
    // Step 4: Validate base URL
    let url: URL | null = null
    try { url = new URL(baseUrl) } catch { errors.push('Base URL must be a valid URL (e.g. https://api.example.com)') }
    if (url && !['https:', 'http:'].includes(url.protocol)) errors.push('Base URL must use HTTP or HTTPS protocol')
    // Step 5: Validate API key format (optional)
    if (apiKey !== undefined && !validApiKey(apiKey)) errors.push('API key contains invalid characters or format')
    // Aggregate pre-validation errors
    if (errors.length) throw new Error(errors.join(' '))
    // Step 6: Check Host capability
    const { writable, namespaces } = await this.settingsDescribe()
    if (!writable) throw new Error('The local Host settings are read-only and cannot accept new providers')
    const descriptor = customProviderDescriptor(namespaces)
    // The 0.1.5 pi-ai adapter ships a fixed protocol set; accept any of those
    // whether or not the serialized settings schema was walkable.
    const supportedProtocols = descriptor?.protocols ?? [...PIAI_PROTOCOLS]
    if (!supportedProtocols.includes(protocol)) throw new Error(`API protocol "${protocol}" is not supported by this local Host. Supported: ${supportedProtocols.join(', ')}`)
    // Step 7: Resolve target namespace + path. pi-ai providers always live at
    // llm-pi-ai/providers/<id>; prefer a walked descriptor, fall back to the
    // known constant.
    let targetNs: string, targetPath: string[], targetRevision: number
    if (descriptor?.ns === PIAI_SETTINGS_NS) {
      targetNs = descriptor.ns
      targetPath = [descriptor.providersPath, id]
      targetRevision = descriptor.revision
    } else {
      targetNs = PIAI_SETTINGS_NS
      targetPath = [PIAI_PROVIDERS_PATH[0], id]
      const section = namespaces.find((item) => string(item.ns, 100) === targetNs)
      if (!section || typeof section.revision !== 'number') throw new Error('Provider settings namespace is unavailable')
      targetRevision = section.revision
    }
    // Step 7b: Check for duplicate ID (declared providers only)
    const configurable = await this.configurableProviders()
    const duplicate = configurable.some((row) => row.provider === id && row.declared === true)
    if (duplicate) throw new Error(`A provider with ID "${id}" already exists. Choose a different ID.`)
    // Step 8: Build the provider profile.
    // IMPORTANT: apiKeyEnv MUST be a valid non-empty credential ref — DSH
    // runtime's settings schema rejects "" (empty) and anything not matching
    // /^[A-Za-z_][A-Za-z0-9_]*$/. We always derive one from the provider id
    // so pi-ai registers an adapter for this route immediately; the actual
    // request fails auth naturally when no credential is configured.
    // DSH pi-ai needs reasoning levels as a dict to actually send
    // reasoning_effort upstream; config.json keeps Narwhal's enum-array shape.
    const dshModels = modelsForDsh(modelIds, protocol)
    const configModels = modelsForConfig(modelIds, protocol)
    const profile: JsonRecord = { baseURL: baseUrl, api: protocol, models: dshModels }
    if (displayName) profile.displayName = displayName
    const credentialRef = credentialRefFor(id, profile)
    if (!credentialRef) throw new Error('Provider credential reference could not be generated. Try a different provider ID.')
    profile.apiKeyEnv = credentialRef
    // Step 9: Write to DSH runtime settings namespace. The pi-ai plugin
    // watches its namespace and re-registers adapters on change.
    await this.rpc('settings/mutate', { ns: targetNs, ops: [{ op: 'set', path: targetPath, value: profile }], expectedRevision: targetRevision })
    // Step 10: Persist to config.json (authoritative store for Narwhal)
    try {
      const cfg = getConfig()
      const configProfile: JsonRecord = { ...profile, models: configModels }
      await saveConfig({ providers: { ...(cfg.providers ?? {}), [id]: configProfile } })
    } catch (err) {
      console.warn('[narwhal] createProvider: saveConfig failed:', err instanceof Error ? err.message : String(err))
    }
    // Step 11: Store API key if provided
    if (!apiKey) {
      const cfg = await this.configuration()
      return { configuration: cfg, keyStored: true }
    }
    let keyStored = true
    try { await this.rpc('credentials/set', { ref: credentialRef, value: apiKey }) } catch { keyStored = false }
    const cfg = await this.configuration()
    return { configuration: cfg, keyStored }
  }
}
