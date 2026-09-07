import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { AgentConfiguration, AgentConversation, AgentSession, Attachment, ChatItem, CreateProviderResult, CustomProviderCapability, ModelProvider, ProviderSetting, UsageStats } from '../shared/desktop-contract.js'
import { classifyTrajectory } from '../shared/trajectory-classifier.js'
import { getConfig, saveConfig } from './config.js'

type JsonRecord = Record<string, unknown>
type Listener = (conversation: AgentConversation) => void

const MAX_TEXT = 24_000
const MAX_ITEMS = 400
const MAX_SEEN_EVENTS = 2_000

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
    const field = schema.properties.defaultPreset; const values = Array.isArray(field.enum) ? field.enum : []; const labels = Array.isArray(field.enumNames) ? field.enumNames : []
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
  // Fallback: DSH runtime may not expose a writable custom-provider schema in
  // its settings.describe response, but Narwhal implements its own full
  // create/delete/update provider flow (see createProvider / deleteProvider /
  // updateProvider). We advertise a minimal capability here so the Add provider
  // button stays usable — the actual write path bypasses the schema check anyway.
  return { available: true, protocols: ['openai-completions'] }
}
function validCustomProviderId(value: string): boolean { return /^[a-z][a-z0-9-]{0,79}$/u.test(value) }
function validModelId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value) }
function validApiKey(value: string): boolean { return /^[\x21-\x7E]+$/u.test(value) && !/^(?:[A-Za-z_][A-Za-z0-9_]*)=/u.test(value) && !/^(['"]).*\1$/u.test(value) }

/** Owns the fixed loopback-only Host API and normalizes its output for the renderer. */
export class HostBridge {
  private origin: string | undefined
  private mux: WebSocket | undefined
  private host: WebSocket | undefined
  private reconnectTimer: NodeJS.Timeout | undefined
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

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  snapshot(): AgentConversation { return { sessions: this.sessions, selectedSessionId: this.selectedSessionId, messages: this.messages, trajectory: this.trajectory, running: this.running, ...(this.usage && { usage: this.usage }) } }
  private emit(): void { const value = this.snapshot(); for (const listener of this.listeners) listener(value) }
  private resetSelectedSession(): void {
    this.selectedSessionId = undefined; this.messages = []; this.trajectory = []; this.running = false; this.seenEventIds.clear(); this.usage = undefined; this.openSteps.clear(); this.totalTtft = 0; this.ttftSamples = 0; this.decodeTokens = 0; this.decodeMs = 0; this.cacheReadTokens = 0
  }
  clearSelection(): AgentConversation { this.resetSelectedSession(); this.emit(); return this.snapshot() }

  async start(origin: string): Promise<void> {
    await this.stop()
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Error('Local Agent origin is invalid')
    this.origin = parsed.origin; this.stopped = false
    this.connectStreams()
  }
  async stop(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    for (const socket of [this.mux, this.host]) { socket?.removeAllListeners(); socket?.terminate() }
    this.mux = undefined; this.host = undefined; this.origin = undefined
  }
  private connectStreams(): void {
    if (this.stopped || !this.origin) return
    const wsOrigin = this.origin.replace(/^http:/u, 'ws:')
    this.mux = this.open(`${wsOrigin}/api/events.mux`, 'mux')
    this.host = this.open(`${wsOrigin}/api/events.host`, 'host')
  }
  private open(url: string, channel: 'mux' | 'host'): WebSocket {
    const socket = new WebSocket(url, { handshakeTimeout: 5_000 })
    socket.on('message', (raw) => this.handleWire(raw.toString(), channel))
    socket.on('close', () => this.scheduleReconnect())
    socket.on('error', () => undefined)
    return socket
  }
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connectStreams() }, 1_500)
  }
  private handleWire(raw: string, channel: 'mux' | 'host'): void {
    if (raw.length > 256_000) return
    let envelope: unknown
    try { envelope = JSON.parse(raw) } catch { return }
    if (!isRecord(envelope) || envelope.type !== 'server-request' || !isRecord(envelope.payload)) return
    const frame = envelope.payload
    if (channel === 'mux') this.handleMux(frame)
    else this.handleHost(frame)
  }
  private handleMux(frame: JsonRecord): void {
    const type = string(frame.type, 80)
    if (type === 'session/event') {
      const sessionId = validId(frame.sessionId); const event = isRecord(frame.event) ? frame.event : undefined
      if (!sessionId || !event || sessionId !== this.selectedSessionId) return
      this.ingestEvent(sessionId, event)
    } else if (type === 'stream/error') this.pushTrajectory({ id: `stream-${Date.now()}`, kind: 'error', label: 'Agent event stream', text: 'The local Agent stream needs to reconnect.', time: Date.now() })
  }
  private handleHost(frame: JsonRecord): void {
    const type = string(frame.type, 80); const sessionId = validId(frame.sessionId)
    if (type === 'host/session-status' && sessionId) { if (sessionId === this.selectedSessionId) this.running = frame.running === true; this.sessions = this.sessions.map((item) => item.id === sessionId ? { ...item, running: frame.running === true } : item); this.emit() }
    if (type === 'host/agent-error' && sessionId === this.selectedSessionId) this.pushTrajectory({ id: `error-${Date.now()}`, kind: 'error', label: 'Agent error', text: string(frame.message) ?? 'The local Agent reported an error.', time: Date.now() })
    if (type === 'host/session-added' || type === 'host/session-removed') void this.listSessions()
  }
  private pushTrajectory(item: ChatItem, emit = true): void { this.trajectory = [...this.trajectory, item].slice(-MAX_ITEMS); if (emit) this.emit() }
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
      const inputTokens = finiteNumber(report.inputTokens) ?? 0
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
    } else if (type === 'assistant/chunk') {
      const text = eventText(event); if (text) {
        const existing = this.messages.find((item) => item.id === `${sessionId}:stream`)
        const next: ChatItem = { id: `${sessionId}:stream`, kind: 'assistant', text: `${existing?.text ?? ''}${text}`.slice(0, MAX_TEXT), time, streaming: true }
        this.messages = [...this.messages.filter((item) => item.id !== next.id), next].slice(-MAX_ITEMS)
      }
    } else {
      const traj = trajectoryFor(event, type)
      if (traj) this.pushTrajectory({ id: `${sessionId}:${seq}`, kind: traj.kind, label: traj.label, text: traj.text, time }, false)
      if (type === 'turn/end') {
        this.running = false
        this.messages = this.messages.map((item) => item.id === `${sessionId}:stream` ? { ...item, streaming: false } : item)
        return
      }
    }
    if (type === 'turn/start') this.running = true
    this.emit()
  }
  private async rpc<T>(method: 'session.list' | 'session.create' | 'session.history' | 'session.prompt' | 'session.cancel' | 'session.models' | 'session.selectModel' | 'llm.providers' | 'llm.models' | 'settings.describe' | 'settings.mutate' | 'credentials.describe' | 'credentials.set' | 'skill.list' | 'goal.create' | 'goal.edit' | 'goal.pause' | 'goal.resume' | 'goal.complete' | 'goal.clear', payload: JsonRecord): Promise<T> {
    if (!this.origin) throw new Error('Local Agent is not ready')
    const response = await fetch(`${this.origin}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Local Agent HTTP ${response.status} on ${method}: ${body.slice(0, 400)}`)
    }
    const envelope: unknown = await response.json()
    if (!isRecord(envelope) || envelope.type !== 'server-response' || !isRecord(envelope.result) || envelope.result.ok !== true) {
      throw new Error(`Local Agent RPC rejected ${method}: ${JSON.stringify(envelope).slice(0, 400)}`)
    }
    return envelope.result.value as T
  }
  async listSessions(): Promise<AgentConversation> {
    const value = await this.rpc<{ items?: unknown }>('session.list', {})
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
    const value = await this.rpc<{ sessionId?: unknown }>('session.create', { cwd })
    const id = validId(value.sessionId); if (!id) throw new Error('Local Agent returned an invalid session')
    await this.listSessions(); this.resetSelectedSession(); this.selectedSessionId = id; this.emit(); return this.snapshot()
  }
  async selectSession(sessionId: string, cwd: string): Promise<AgentConversation> {
    if (!this.sessions.some((item) => item.id === sessionId)) await this.listSessions()
    const session = this.sessions.find((item) => item.id === sessionId)
    if (!session || session.cwd !== cwd) throw new Error('Conversation is not available in this workspace')
    this.resetSelectedSession(); this.selectedSessionId = sessionId; this.running = session.running; this.emit()
    await this.refreshHistory(sessionId)
    return this.snapshot()
  }
  private async refreshHistory(sessionId: string): Promise<void> {
    const value = await this.rpc<{ events?: unknown }>('session.history', { sessionId, maxMessages: 100 })
    const entries = Array.isArray(value.events) ? value.events : []
    for (const entry of entries) if (isRecord(entry) && isRecord(entry.event)) this.ingestEvent(sessionId, entry.event)
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
    await this.rpc('session.prompt', { sessionId, mode: 'queue', content, clientTimeZone: timeZone })
    const displayText = text || (hasAttachments ? `Analyzing ${attachments!.length} attachment${attachments!.length !== 1 ? 's' : ''}` : '')
    const accepted: ChatItem = { id: `accepted-${randomUUID()}`, kind: 'user', text: displayText, time: Date.now(), attachments: attachments ? [...attachments] : undefined }
    this.messages = [...this.messages, accepted].slice(-MAX_ITEMS)
    this.running = true; this.emit()
    for (const delay of [1_000, 3_000, 8_000]) setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, delay)
    return this.snapshot()
  }
  async cancel(): Promise<void> { if (this.selectedSessionId) { await this.rpc('session.cancel', { sessionId: this.selectedSessionId }); this.running = false; this.emit() } }
  async listCommands(): Promise<{ name: string; description: string; input?: { hint?: string; images?: boolean } }[]> {
    // Hardcoded built-in commands (same 6 registered by dsh-command-* packages)
    type Cmd = { name: string; description: string; input?: { hint?: string; images?: boolean } }
    const builtin: Cmd[] = [
      { name: 'compact', description: 'Compress the conversation context to save tokens' },
      { name: 'export', description: 'Export the current conversation as a zip file' },
      { name: 'goal', description: 'Manage long-term goals for this conversation', input: { hint: 'objective | clear | pause | resume' } },
      { name: 'plan', description: 'Toggle plan mode — the agent will plan before acting' },
      { name: 'permission', description: 'Show or change the operation permission preset', input: { hint: 'preset name' } },
      { name: 'feedback', description: 'Send feedback to the DeepSeek Harness team' },
    ]
    // DSH exposes skill.list over HTTP — fetch any skills the Host currently has loaded
    let skillList: { name: string; description: string }[] = []
    try {
      if (this.selectedSessionId) {
        const value = await this.rpc<{ skills?: unknown[] }>('skill.list', { sessionId: this.selectedSessionId })
        skillList = (value.skills ?? []).flatMap((row) => {
          if (!isRecord(row) || typeof row.name !== 'string' || typeof row.description !== 'string') return []
          return [{ name: row.name, description: row.description }]
        })
      }
    } catch (e) { console.warn('[narwhal] skill.list failed:', e) }
    // De-dup: builtin wins over skills with the same name
    const seen = new Set(builtin.map((c) => c.name))
    const result = [...builtin]
    for (const s of skillList) if (!seen.has(s.name)) { result.push({ ...s, input: { hint: 'optional arguments' } }); seen.add(s.name) }
    return result
  }
  async executeCommand(line: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    if (!this.selectedSessionId) throw new Error('Choose a conversation first')
    // Parse "/name args..." into command name and remaining args
    const match = line.match(/^\/([A-Za-z0-9_-]+)(?:\s*(.*))?$/s)
    if (!match) return { kind: 'error', text: 'Invalid slash command format' }
    const name = match[1].toLowerCase()
    const args = (match[2] ?? '').trim()
    const sessionId = this.selectedSessionId
    try {
      switch (name) {
        case 'goal':  return this.execGoal(sessionId, args)
        case 'plan':    return this.execPlan(sessionId, args)
        case 'compact': return this.execCompact(sessionId)
        case 'permission': return this.execPermission(sessionId, args)
        case 'export': return this.execExport(sessionId)
        case 'feedback': return this.execFeedback(sessionId, args)
        default: {
          // Unknown command — could be a skill. Try to dispatch via session.prompt so the
          // model sees it. This is a graceful degradation for future skill-loaded sessions.
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          await this.rpc<unknown>('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: line }], clientTimeZone: timeZone })
          this.running = true; this.emit()
          for (const delay of [1000, 3000, 6000]) setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, delay)
          return { kind: 'success' }
        }
      }
    } catch (e) {
      console.warn('[narwhal] executeCommand failed:', e)
      return { kind: 'error', text: String(e) }
    }
  }
  private async execGoal(sessionId: string, args: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    const control = args.toLowerCase()
    if (!args) {
      const current = await this.fetchCurrentGoal(sessionId)
      if (!current) return { kind: 'success', text: 'No active goal. Use `/goal <objective>` to set one.' }
      const phase = current.goal.phase ?? 'unknown'
      return { kind: 'success', text: `Current goal (${phase}): "${current.goal.objective}"` }
    }
    if (control === 'clear' || control === 'pause' || control === 'resume') {
      const current = await this.fetchCurrentGoal(sessionId)
      if (!current) return { kind: 'error', text: 'No active goal to operate on.' }
      const op = `goal.${control}` as const
      const result = await this.rpc<{ ref?: { id: string; revision: number } }>(op, { sessionId, ref: { id: current.goal.id, revision: current.goal.revision } })
      // pause/resume return new ref with bumped revision; clear may return empty
      if (result?.ref) current.goal = { ...current.goal, ...result.ref }
      setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, 500)
      return { kind: 'success', text: `Goal ${control}${control.endsWith('e') ? 'd' : 'ed'}.` }
    }
    if (control.startsWith('edit')) {
      const objective = args.slice(4).trim()
      if (!objective) return { kind: 'error', text: 'Usage: /goal edit <new objective>' }
      const current = await this.fetchCurrentGoal(sessionId)
      if (!current) return { kind: 'error', text: 'No active goal to edit.' }
      const result = await this.rpc<{ ref?: { id: string; revision: number } }>('goal.edit', { sessionId, ref: { id: current.goal.id, revision: current.goal.revision }, objective })
      if (result?.ref) current.goal = { ...current.goal, ...result.ref }
      setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, 500)
      return { kind: 'success', text: `Goal updated: "${objective}"` }
    }
    // Treat remaining text as a new goal objective
    const result = await this.rpc<{ ref?: { id: string; revision: number } }>('goal.create', { sessionId, objective: args })
    setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, 500)
    if (result?.ref) return { kind: 'success', text: `Goal set: "${args}" (${result.ref.id.slice(-8)})` }
    return { kind: 'success', text: `Goal set: "${args}"` }
  }
  /** Fetch the current session's goal ref from the session list projection. */
  private async fetchCurrentGoal(sessionId: string): Promise<{ goal: { id: string; revision: number; objective: string; phase?: string } } | undefined> {
    try {
      const list = await this.rpc<{ items?: unknown[] }>('session.list', {})
      const items = list?.items ?? []
      for (const raw of items) {
        if (!isRecord(raw)) continue
        if (raw.sessionId !== sessionId) continue
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
  private async execPermission(_sessionId: string, args: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    // The setDefaultPermission path is already exposed through select-agent-model / set-default-permission IPC
    // We can reuse it: credentials.set with the preset name. For now just show current state.
    if (!args) {
      return { kind: 'success', text: 'Use the permission dropdown in the composer bar to switch presets (Workspace Write, Safe, etc.).' }
    }
    // Map common preset aliases to the internal names used by setDefaultPermission
    const presets = new Set<string>(['workspace-write', 'safe', 'read-only', 'full-access'])
    if (!presets.has(args)) {
      return { kind: 'error', text: `Unknown permission preset "${args}". Valid: workspace-write, safe, read-only, full-access.` }
    }
    await this.setDefaultPermission(args)
    return { kind: 'success', text: `Permission preset set to "${args}".` }
  }
  private async execExport(sessionId: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    if (!this.origin) return { kind: 'error', text: 'Host not ready' }
    const url = `${this.origin}/api/session.export?sessionId=${encodeURIComponent(sessionId)}`
    // We can't trigger a browser download from Node. Instead return the URL and let the renderer open it.
    return { kind: 'success', text: `Download: ${url}` }
  }

  // ── Narwhal plugin endpoints (direct fetch, not rpc envelope) ───────────

  /** Fetch helper that talks directly to the narwhal-commands cordis patch plugin. */
  private async narwhalFetch(path: string, body: JsonRecord): Promise<Record<string, unknown>> {
    if (!this.origin) throw new Error('Local Agent is not ready')
    const response = await fetch(`${this.origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || data.ok !== true) {
      const msg = typeof data.error === 'string' ? data.error : `HTTP ${response.status}`
      throw new Error(msg)
    }
    return data
  }

  /** /plan  — toggle plan mode on/off for the session. */
  private async execPlan(sessionId: string, args: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    const control = args.toLowerCase()
    let active: boolean
    if (control === 'off' || control === 'false') {
      active = false
    } else if (!control || control === 'on' || control === 'true') {
      active = true
    } else {
      return { kind: 'error', text: 'Usage: /plan [on|off]' }
    }
    try {
      await this.narwhalFetch('/api/narwhal/plan', { sessionId, active })
      setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, 500)
      return { kind: 'success', text: `Plan mode ${active ? 'enabled' : 'disabled'}.` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { kind: 'error', text: `/plan failed: ${msg}` }
    }
  }

  /** /feedback  — record a feedback entry on the session. */
  private async execFeedback(sessionId: string, args: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    if (!args.trim()) return { kind: 'error', text: 'Usage: /feedback <your feedback text>' }
    try {
      await this.narwhalFetch('/api/narwhal/feedback', { sessionId, text: args })
      return { kind: 'success', text: 'Feedback recorded. Thank you!' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { kind: 'error', text: `/feedback failed: ${msg}` }
    }
  }

  /** /compact  — trigger manual compaction on the session. */
  private async execCompact(sessionId: string): Promise<{ kind: 'success' | 'error'; text?: string }> {
    try {
      const data = await this.narwhalFetch('/api/narwhal/compact', { sessionId })
      if (data.compacted === false) {
        return { kind: 'success', text: typeof data.reason === 'string' ? data.reason : 'No compactable history yet.' }
      }
      const seqs = typeof data.shadowedSeqs === 'number' ? data.shadowedSeqs : 0
      const tokens = typeof data.shadowedTokens === 'number' ? data.shadowedTokens : 0
      setTimeout(() => { if (this.selectedSessionId === sessionId) void this.refreshHistory(sessionId).catch(() => undefined) }, 1000)
      return { kind: 'success', text: `Compacted ${seqs} history items (~${tokens} tokens).` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { kind: 'error', text: `/compact failed: ${msg}` }
    }
  }

  private async configuration(): Promise<AgentConfiguration> {
    try {
      const [providersResult, modelsResult, settingsResult, sessionModelsResult] = await Promise.allSettled([
        this.rpc<{ providers?: unknown }>('llm.providers', {}),
        this.rpc<{ groups?: unknown }>('llm.models', {}),
        this.rpc<{ writable?: unknown; namespaces?: unknown }>('settings.describe', {}),
        this.selectedSessionId ? this.rpc<{ current?: unknown }>('session.models', { sessionId: this.selectedSessionId }) : Promise.resolve<{ current?: unknown }>({}),
      ])

      // Each RPC is independently validated — a single failure does not block the others
      const providersValue = providersResult.status === 'fulfilled' ? providersResult.value : { providers: [] as unknown[] }
      const modelsValue = modelsResult.status === 'fulfilled' ? modelsResult.value : { groups: [] as unknown[] }
      const settingsValue = settingsResult.status === 'fulfilled' ? settingsResult.value : { writable: false, namespaces: [] as unknown[] }
      const sessionModels = sessionModelsResult.status === 'fulfilled' ? sessionModelsResult.value : { current: undefined as unknown }

      if (providersResult.status === 'rejected') this.pushTrajectory({ id: `cfg-providers-${Date.now()}`, kind: 'error', label: 'Provider list unavailable', text: 'Some provider data could not be loaded.', time: Date.now() })
      if (modelsResult.status === 'rejected') this.pushTrajectory({ id: `cfg-models-${Date.now()}`, kind: 'error', label: 'Model list unavailable', text: 'Some model data could not be loaded.', time: Date.now() })
      const namespaces = Array.isArray(settingsValue.namespaces) ? settingsValue.namespaces.filter(isRecord) : []
      const providers = Array.isArray(providersValue.providers) ? providersValue.providers.filter(isRecord) : []
      const references = providers.flatMap((provider) => {
        const id = validId(provider.provider); const ns = string(provider.settingsNs, 120); const path = Array.isArray(provider.settingsPath) && provider.settingsPath.every((part) => typeof part === 'string') ? provider.settingsPath as string[] : []
        const settings = id && ns ? namespaces.find((entry) => entry.ns === ns) : undefined; const profile = settings && isRecord(settings.value) ? valueAt(settings.value, path) : undefined
        return id && isRecord(profile) ? [credentialRefFor(id, profile)] : []
      }).filter((reference): reference is string => reference !== undefined)
      const credentials = references.length ? await this.rpc<{ credentials?: unknown }>('credentials.describe', { refs: references }) : { credentials: {} }
      const credentialMap = isRecord(credentials.credentials) ? credentials.credentials : {}
      const normalizedProviders: ProviderSetting[] = providers.flatMap((provider) => {
        const id = validId(provider.provider); const name = string(provider.displayName, 120); const ns = string(provider.settingsNs, 120); const path = Array.isArray(provider.settingsPath) && provider.settingsPath.every((part) => typeof part === 'string') ? provider.settingsPath as string[] : []
        const settings = id && ns ? namespaces.find((entry) => entry.ns === ns) : undefined; const profile = settings && isRecord(settings.value) ? valueAt(settings.value, path) : undefined
        if (!id || !name || !isRecord(profile)) return []
        const reference = credentialRefFor(id, profile); const credential = reference && isRecord(credentialMap[reference]) ? credentialMap[reference] : undefined
        return [{ id, name, active: provider.active === true, apiKeyConfigured: credential?.configured === true, apiKeyWritable: credential?.writable === true, baseUrl: string(profile.baseURL, 600) ?? string(profile.baseUrl, 600), protocol: string(profile.api, 80) }]
      })
      // Merge custom providers from config.json that DSH's llm.providers RPC
      // does not expose (DSH only returns built-in providers). This makes
      // UI show custom providers even before DSH's model registry picks them up.
      try {
        const cfg = getConfig()
        const existingIds = new Set(normalizedProviders.map((p) => p.id))
        for (const [idRaw, profile] of Object.entries(cfg.providers ?? {})) {
          if (existingIds.has(idRaw)) continue
          if (!isRecord(profile)) continue
          const id = validId(idRaw); const name = string(profile.displayName, 120) ?? id
          if (!id || !name) continue
          const apiKeyEnv = string(profile.apiKeyEnv, 120)
          const credential = apiKeyEnv && isRecord(credentialMap[apiKeyEnv]) ? credentialMap[apiKeyEnv] : undefined
          normalizedProviders.push({
            id, name,
            active: true,
            apiKeyConfigured: credential?.configured === true,
            apiKeyWritable: credential !== undefined,
            baseUrl: string(profile.baseURL, 600),
            protocol: string(profile.api, 80) ?? 'openai-completions',
          })
        }
      } catch { /* config read is best-effort */ }
      const OPENAI_COMPAT_EFFORTS = [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }]
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
      const providerInfoMap = new Map<string, { protocol: string, baseUrl: string | undefined }>()
      for (const p of normalizedProviders) { providerInfoMap.set(p.id, { protocol: p.protocol ?? '', baseUrl: p.baseUrl }) }
      const models: ModelProvider[] = (Array.isArray(modelsValue.groups) ? modelsValue.groups : []).flatMap((group) => {
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
          const useFallbackEfforts = rawEfforts.length === 0 && (isOpenAI || isAnthropic)
          const efforts = useFallbackEfforts ? OPENAI_COMPAT_EFFORTS : rawEfforts
          const defaultEffort = string(reasoning.defaultEffort, 100) ?? (useFallbackEfforts ? 'medium' : undefined)
          return [{ id: modelId, name: modelName, description: string(model.description, 300), efforts, defaultEffort, effortsNative: !useFallbackEfforts }]
        }) }]
      })
      // Also merge models from config.json for custom providers that DSH's
      // llm.models RPC doesn't expose. This lets ProviderRow show the model
      // list and the "Select model" button stays enabled.
      try {
        const cfg = getConfig()
        const modelGroupIds = new Set(models.map((m) => m.id))
        for (const [idRaw, profile] of Object.entries(cfg.providers ?? {})) {
          if (modelGroupIds.has(idRaw)) continue
          if (!isRecord(profile) || !Array.isArray(profile.models)) continue
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
            const efforts = useFallbackEfforts ? OPENAI_COMPAT_EFFORTS : []
            return [{ id: mid, name: mname, description: '', efforts, defaultEffort: useFallbackEfforts ? 'medium' : undefined, effortsNative: false }]
          })
          if (providerModels.length) models.push({ id: groupId, name: groupName, models: providerModels })
        }
      } catch { /* best-effort */ }
      const permission = namespaces.find((entry) => entry.ns === 'permission'); const permissionValue = permission && isRecord(permission.value) ? permission.value : {}; const current = isRecord(sessionModels.current) ? sessionModels.current : undefined
      return { available: true, writable: settingsValue.writable === true, providers: normalizedProviders, models, defaultPermission: string(permissionValue.defaultPreset, 100), permissionOptions: permission ? permissionOptions(permission.schema) : [], customProvider: customProviderCapability(namespaces, settingsValue.writable === true), selectedModel: current && string(current.provider, 120) && string(current.model, 160) ? { provider: string(current.provider, 120)!, model: string(current.model, 160)!, reasoningEffort: string(current.reasoningEffort, 100) } : undefined }
    } catch (error) { return { available: false, writable: false, providers: [], models: [], permissionOptions: [], customProvider: { available: false, protocols: [], reason: 'Local Agent configuration is unavailable.' }, error: error instanceof Error ? error.message : 'Local Agent configuration is unavailable' } }
  }
  async getConfiguration(): Promise<AgentConfiguration> { return this.configuration() }
  async selectModel(provider: string, model: string, reasoningEffort?: string): Promise<AgentConfiguration> {
    if (!this.selectedSessionId) throw new Error('Choose a conversation first')
    await this.rpc('session.selectModel', { sessionId: this.selectedSessionId, provider, model, ...(reasoningEffort && { reasoningEffort }) })
    // Lightweight refresh: only fetch session.models for the current selection instead of full configuration
    const sessionModels = await this.rpc<{ current?: unknown }>('session.models', { sessionId: this.selectedSessionId })
    const current = isRecord(sessionModels.current) ? sessionModels.current : undefined
    // Update just the selectedModel field on the cached config
    const config = await this.configuration()
    const selectedModel = current && string(current.provider, 120) && string(current.model, 160)
      ? { provider: string(current.provider, 120)!, model: string(current.model, 160)!, reasoningEffort: string(current.reasoningEffort, 100) }
      : config.selectedModel
    return { ...config, selectedModel }
  }
  async setDefaultPermission(preset: string): Promise<AgentConfiguration> { const config = await this.configuration(); const option = config.permissionOptions.find((item) => item.id === preset); if (!option) throw new Error('Permission preset is unavailable'); const descriptor = await this.rpc<{ namespaces?: unknown }>('settings.describe', {}); const permission = Array.isArray(descriptor.namespaces) ? descriptor.namespaces.find((item) => isRecord(item) && item.ns === 'permission') : undefined; if (!isRecord(permission) || typeof permission.revision !== 'number') throw new Error('Permission settings are unavailable'); await this.rpc('settings.mutate', { ns: 'permission', ops: [{ op: 'set', path: ['defaultPreset'], value: option.id }], expectedRevision: permission.revision }); return this.configuration() }
  async setProviderApiKey(providerId: string, value: string): Promise<AgentConfiguration> {
    const key = value.trim()
    if (!/^[\x21-\x7E]+$/u.test(key) || /^(?:[A-Za-z_][A-Za-z0-9_]*)=/u.test(key)) throw new Error('API key format is invalid')
    const config = await this.configuration()
    const provider = config.providers.find((item) => item.id === providerId)
    if (!provider?.apiKeyWritable) throw new Error('This provider does not accept a local API key')
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!resolved) throw new Error('Provider settings are unavailable')
    const { ns, path } = resolved
    const settings = await this.rpc<{ namespaces?: unknown }>('settings.describe', {})
    const section = Array.isArray(settings.namespaces) ? settings.namespaces.find((item) => isRecord(item) && item.ns === ns) : undefined
    const profile = isRecord(section) && isRecord(section.value) ? valueAt(section.value, path) : undefined
    if (!isRecord(profile)) throw new Error('Provider configuration is unavailable')
    const reference = credentialRefFor(providerId, profile)
    if (!reference) throw new Error('Provider credential is unavailable')
    await this.rpc('credentials.set', { ref: reference, value: key })
    return this.configuration()
  }
  async setProviderBaseUrl(providerId: string, value: string): Promise<AgentConfiguration> {
    const baseUrl = value.trim()
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Base URL must use HTTP or HTTPS')
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!resolved) throw new Error('Provider settings are unavailable')
    const { ns, path } = resolved
    const settings = await this.rpc<{ namespaces?: unknown }>('settings.describe', {})
    const section = Array.isArray(settings.namespaces) ? settings.namespaces.find((item) => isRecord(item) && item.ns === ns) : undefined
    if (!isRecord(section) || typeof section.revision !== 'number') throw new Error('Provider settings are unavailable')
    await this.rpc('settings.mutate', { ns, ops: [{ op: 'set', path: [...path, 'baseURL'], value: baseUrl }], expectedRevision: section.revision })
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
    let models: { id: string; name: string }[] | undefined
    if (input.baseUrl !== undefined) {
      const trimmed = input.baseUrl.trim()
      const url = new URL(trimmed)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Base URL must use HTTP or HTTPS')
      baseUrl = trimmed
    }
    if (input.modelIds !== undefined) {
      const modelIds = input.modelIds.map((m) => m.trim()).filter(Boolean)
      if (!modelIds.length) throw new Error('At least one model ID is required')
      modelIds.forEach((modelId) => { if (!validModelId(modelId)) throw new Error(`Model ID "${modelId}" is invalid`) })
      models = modelIds.map((modelId) => ({ id: modelId, name: modelId }))
    }
    if (baseUrl === undefined && models === undefined) return this.configuration()
    const resolved = await this.resolveProviderNsPath(providerId)
    if (!resolved) throw new Error('Provider settings are unavailable')
    const { ns, path } = resolved
    const settings = await this.rpc<{ namespaces?: unknown }>('settings.describe', {})
    const section = Array.isArray(settings.namespaces) ? settings.namespaces.find((item) => isRecord(item) && item.ns === ns) : undefined
    if (!isRecord(section) || typeof section.revision !== 'number') throw new Error('Provider settings are unavailable')
    const ops: { op: 'set'; path: string[]; value: unknown }[] = []
    if (baseUrl !== undefined) ops.push({ op: 'set', path: [...path, 'baseURL'], value: baseUrl })
    if (models !== undefined) ops.push({ op: 'set', path: [...path, 'models'], value: models })
    await this.rpc('settings.mutate', { ns, ops, expectedRevision: section.revision })
    // Persist to config.json
    try {
      const cfg = getConfig()
      const currentProviders = { ...(cfg.providers ?? {}) }
      const existing = currentProviders[providerId] ?? {}
      const merged: JsonRecord = { ...(existing as JsonRecord) }
      if (baseUrl !== undefined) merged.baseURL = baseUrl
      if (models !== undefined) merged.models = models
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
    // 1) Remove from DSH settings namespace (best-effort — may fail for
    //    config-only providers that never wrote into DSH).
    if (resolved) {
      try {
        const settings = await this.rpc<{ namespaces?: unknown }>('settings.describe', {})
        const section = Array.isArray(settings.namespaces) ? settings.namespaces.find((item) => isRecord(item) && item.ns === resolved.ns) : undefined
        if (isRecord(section) && typeof section.revision === 'number') {
          await this.rpc('settings.mutate', { ns: resolved.ns, ops: [{ op: 'unset', path: resolved.path }], expectedRevision: section.revision })
        }
      } catch (err) {
        console.warn('[narwhal] deleteProvider: DSH unset failed (config.json still being updated):', err instanceof Error ? err.message : String(err))
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

  /** Resolve the { ns, path } for a provider. First tries llm.providers RPC
   *  (works for built-in providers). If DSH doesn't expose the target there
   *  (common for custom providers created via settings.yaml), borrows ns +
   *  path template from an existing built-in provider and replaces its id
   *  segment with the target id. Returns null when neither yields usable coords. */
  private async resolveProviderNsPath(providerId: string): Promise<{ ns: string; path: string[] } | null> {
    try {
      const registered = await this.rpc<{ providers?: unknown }>('llm.providers', {})
      const arr = Array.isArray(registered.providers) ? registered.providers.filter(isRecord) : []
      // Direct match
      const direct = arr.find((item) => item.provider === providerId)
      if (direct) {
        const ns = string(direct.settingsNs, 120)
        const pathArr = Array.isArray(direct.settingsPath)
          ? direct.settingsPath.every((p) => typeof p === 'string') ? direct.settingsPath as string[] : undefined
          : undefined
        if (ns && pathArr) return { ns, path: pathArr }
      }
      // Fallback: borrow from a built-in provider
      const builtIn = arr.find((item) => string(item.settingsNs, 120) && Array.isArray(item.settingsPath) && item.settingsPath.every((p) => typeof p === 'string'))
      if (!builtIn) return null
      const bNs = string(builtIn.settingsNs, 120)!
      const bPath = builtIn.settingsPath as string[]
      const fallbackPath = [...bPath.slice(0, -1), providerId]
      return { ns: bNs, path: fallbackPath }
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
    modelIds.forEach((modelId, index) => {
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
    const settings = await this.rpc<{ writable?: unknown; namespaces?: unknown }>('settings.describe', {})
    const namespaces = Array.isArray(settings.namespaces) ? settings.namespaces.filter(isRecord) : []
    const descriptor = settings.writable === true ? customProviderDescriptor(namespaces) : undefined
    if (settings.writable !== true) throw new Error('The local Host settings are read-only and cannot accept new providers')
    // Fallback when DSH runtime doesn't expose a writable schema — Narwhal
    // implements its own write path, so "openai-completions" is always valid.
    const supportedProtocols = descriptor?.protocols ?? ['openai-completions']
    if (!supportedProtocols.includes(protocol)) throw new Error(`API protocol "${protocol}" is not supported by this local Host. Supported: ${supportedProtocols.join(', ')}`)
    // Step 7: Resolve target namespace + path (with fallback when schema missing)
    let targetNs: string, targetPath: string[], targetRevision: number
    if (descriptor) {
      targetNs = descriptor.ns
      targetPath = [descriptor.providersPath, id]  // descriptor.providersPath is a single string segment
      targetRevision = descriptor.revision
    } else {
      // Fallback: DSH runtime didn't expose a writable custom-provider schema.
      // Borrow the namespace + providers path pattern from an existing built-in
      // provider (e.g. deepseek) — DSH always has at least one registered.
      const registered = await this.rpc<{ providers?: unknown }>('llm.providers', {})
      const builtIn = Array.isArray(registered.providers)
        ? registered.providers.find((item) => isRecord(item) && string(item.settingsNs, 120) && Array.isArray(item.settingsPath))
        : undefined
      if (!builtIn) throw new Error('Cannot resolve target namespace for custom providers — no built-in provider found')
      targetNs = string(builtIn.settingsNs, 120)!
      targetPath = [...(builtIn.settingsPath as string[]), id]
      const section = namespaces.find((item) => item.ns === targetNs)
      if (!section || typeof section.revision !== 'number') throw new Error('Provider settings namespace is unavailable')
      targetRevision = section.revision
    }
    // Step 7b: Check for duplicate ID
    const registered = await this.rpc<{ providers?: unknown }>('llm.providers', {})
    const duplicate = Array.isArray(registered.providers) && registered.providers.some((item) => isRecord(item) && item.provider === id)
    if (duplicate) throw new Error(`A provider with ID "${id}" already exists. Choose a different ID.`)
    // Step 8: Build the provider profile.
    // IMPORTANT: apiKeyEnv MUST be a valid non-empty credential ref — DSH
    // runtime's settings schema rejects "" (empty) and anything not matching
    // /^[A-Za-z_][A-Za-z0-9_]*$/. We always derive one from the provider id
    // (e.g. "LLM_PI_AI_MY_GATEWAY") even when the user hasn't stored an API
    // key yet. This lets DSH's pi-ai plugin register an adapter for this
    // route so session.selectModel and session.prompt work; the actual
    // request will fail auth naturally when no credential is configured.
    const models = modelIds.map((modelId) => ({ id: modelId, name: modelId }))
    const profile: JsonRecord = { baseURL: baseUrl, api: protocol, models }
    if (displayName) profile.displayName = displayName
    const credentialRef = credentialRefFor(id, profile)
    if (!credentialRef) throw new Error('Provider credential reference could not be generated. Try a different provider ID.')
    profile.apiKeyEnv = credentialRef
    // Step 9: Write to DSH runtime settings namespace. This is the critical
    // write — DSH's pi-ai plugin watches its own namespace and re-registers
    // adapters on change. Without this, session.selectModel throws
    // "no adapter registered for provider X".
    await this.rpc('settings.mutate', { ns: targetNs, ops: [{ op: 'set', path: targetPath, value: profile }], expectedRevision: targetRevision })
    // Step 10: Persist to config.json (authoritative store for Narwhal)
    try {
      const cfg = getConfig()
      await saveConfig({ providers: { ...(cfg.providers ?? {}), [id]: profile } })
    } catch (err) {
      console.warn('[narwhal] createProvider: saveConfig failed:', err instanceof Error ? err.message : String(err))
    }
    // Step 11: Store API key if provided
    if (!apiKey) {
      const cfg = await this.configuration()
      return { configuration: cfg, keyStored: true }
    }
    let keyStored = true
    try { await this.rpc('credentials.set', { ref: credentialRef, value: apiKey }) } catch { keyStored = false }
    const cfg = await this.configuration()
    return { configuration: cfg, keyStored }
  }
}
