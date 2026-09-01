export type AgentState = 'ready' | 'starting' | 'needs-restart'
export type ConversationStatus = 'active' | 'done'
export interface TodoItem { readonly id: string; readonly text: string; readonly done: boolean }
export interface Conversation { readonly id: string; readonly workspaceId: string; readonly title: string; readonly goal: string; readonly status: ConversationStatus; readonly todos: readonly TodoItem[]; readonly createdAt: string; readonly updatedAt: string }
export interface Deliverable { readonly relativePath: string; readonly label: string; readonly pinnedAt: string }
export interface Workspace { readonly id: string; readonly name: string; readonly displayPath: string; readonly lastOpenedAt: string }
export interface GitChange { readonly path: string; readonly kind: string }
export interface AgentSession { readonly id: string; readonly title: string; readonly updatedAt: number; readonly running: boolean; readonly cwd?: string }
export interface Attachment { readonly id: string; readonly name: string; readonly size: number; readonly type: string; readonly dataUrl?: string }
export interface ChatItem { readonly id: string; readonly kind: 'user' | 'assistant' | 'trajectory' | 'error'; readonly text: string; readonly label?: string; readonly time: number; readonly streaming?: boolean; readonly attachments?: readonly Attachment[] }
export interface UsageStats { readonly turns: number; readonly steps: number; readonly llmLatency: number; readonly ttftAvg: number; readonly tokenThroughput: number; readonly cacheHitRate: number; readonly inputTokens: number; readonly outputTokens: number }
export interface AgentConversation { readonly sessions: readonly AgentSession[]; readonly selectedSessionId?: string; readonly messages: readonly ChatItem[]; readonly trajectory: readonly ChatItem[]; readonly running: boolean; readonly usage?: UsageStats }
export interface WorkbenchSnapshot { readonly workspaces: readonly Workspace[]; readonly selectedWorkspaceId?: string; readonly conversations: readonly Conversation[]; readonly selectedConversationId?: string; readonly deliverables: readonly Deliverable[]; readonly panelOpen: boolean; readonly git: { readonly branch?: string; readonly changes: readonly GitChange[] }; readonly conversation: AgentConversation }
export interface AgentSnapshot { readonly state: AgentState; readonly origin?: string }
export interface DesktopSettings { readonly appVersion: string; readonly runtimeVersion: string; readonly dataDirectory: string }
export type ThemeMode = 'auto' | 'dark' | 'light'
export interface NarwhalConfig {
  readonly version: 1
  readonly theme: ThemeMode
  readonly defaultModel?: string
  readonly defaultEffort: 'low' | 'medium' | 'high'
  readonly agentMode: string
  readonly permissionLevel: string
  readonly providers: ReadonlyRecord<string, ProviderConfig>
}
export interface ProviderConfig {
  readonly type?: string
  readonly enabled: boolean
  readonly options?: ProviderOptions
  readonly models?: readonly { readonly id: string; readonly name?: string }[]
}
export interface ProviderOptions {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly headers?: ReadonlyRecord<string, string>
}
type ReadonlyRecord<K extends string, V> = { readonly [key in K]?: V }
export interface ModelEffort { readonly id: string; readonly name: string; readonly description?: string }
export interface AgentModel { readonly id: string; readonly name: string; readonly description?: string; readonly efforts: readonly ModelEffort[]; readonly defaultEffort?: string; readonly effortsNative?: boolean }
export interface ModelProvider { readonly id: string; readonly name: string; readonly models: readonly AgentModel[] }
export interface ProviderSetting { readonly id: string; readonly name: string; readonly active: boolean; readonly apiKeyConfigured: boolean; readonly apiKeyWritable: boolean; readonly baseUrl?: string; readonly protocol?: string }
export interface CustomProviderCapability { readonly available: boolean; readonly protocols: readonly string[]; readonly reason?: string }
export interface AgentConfiguration { readonly available: boolean; readonly writable: boolean; readonly providers: readonly ProviderSetting[]; readonly models: readonly ModelProvider[]; readonly defaultPermission?: string; readonly permissionOptions: readonly { readonly id: string; readonly label: string }[]; readonly customProvider: CustomProviderCapability; readonly selectedModel?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }; readonly error?: string }
export interface CreateProviderResult { readonly configuration: AgentConfiguration; readonly keyStored: boolean }
export interface Command { readonly name: string; readonly description: string; readonly input?: { readonly hint?: string; readonly images?: boolean } }
export interface CommandResult { readonly kind: 'success' | 'error'; readonly text?: string }
export interface NarwhalBridge {
  bootstrap(): Promise<{ readonly agent: AgentSnapshot; readonly workbench: WorkbenchSnapshot; readonly settings: DesktopSettings; readonly config: NarwhalConfig; readonly configLoadError?: string }>
  chooseWorkspace(): Promise<WorkbenchSnapshot>
  selectWorkspace(workspaceId: string): Promise<WorkbenchSnapshot>
  renameWorkspace(input: { readonly workspaceId: string; readonly name: string }): Promise<WorkbenchSnapshot>
  deleteWorkspace(workspaceId: string): Promise<WorkbenchSnapshot>
  createConversation(input: { readonly title: string; readonly goal: string }): Promise<WorkbenchSnapshot>
  updateConversation(input: { readonly conversationId: string; readonly title?: string; readonly goal?: string; readonly status?: ConversationStatus }): Promise<WorkbenchSnapshot>
  addTodo(input: { readonly conversationId: string; readonly text: string }): Promise<WorkbenchSnapshot>
  toggleTodo(input: { readonly conversationId: string; readonly todoId: string; readonly done: boolean }): Promise<WorkbenchSnapshot>
  selectConversation(conversationId?: string): Promise<WorkbenchSnapshot>
  setPanelOpen(open: boolean): Promise<WorkbenchSnapshot>
  pinDeliverable(input: { readonly relativePath: string; readonly label: string }): Promise<WorkbenchSnapshot>
  unpinDeliverable(relativePath: string): Promise<WorkbenchSnapshot>
  revealDeliverable(relativePath: string): Promise<void>
  listSessions(): Promise<AgentConversation>
  createSession(): Promise<AgentConversation>
  selectSession(sessionId: string): Promise<AgentConversation>
  sendPrompt(text: string, attachments?: readonly Attachment[]): Promise<AgentConversation>
  cancelPrompt(): Promise<void>
  listCommands(): Promise<readonly Command[]>
  executeCommand(line: string): Promise<CommandResult>
  getAgentConfiguration(): Promise<AgentConfiguration>
  selectAgentModel(input: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<AgentConfiguration>
  setDefaultPermission(preset: string): Promise<AgentConfiguration>
  setProviderApiKey(input: { readonly provider: string; readonly value: string }): Promise<AgentConfiguration>
  setProviderBaseUrl(input: { readonly provider: string; readonly value: string }): Promise<AgentConfiguration>
  updateProvider(input: { readonly provider: string; readonly baseUrl?: string; readonly modelIds?: readonly string[] }): Promise<AgentConfiguration>
  deleteProvider(providerId: string): Promise<AgentConfiguration>
  createProvider(input: { readonly id: string; readonly displayName?: string; readonly baseUrl: string; readonly protocol: string; readonly modelIds: readonly string[]; readonly apiKey?: string }): Promise<CreateProviderResult>
  retryAgent(): Promise<void>
  getConfig(): Promise<NarwhalConfig>
  saveConfig(patch: Partial<NarwhalConfig>): Promise<NarwhalConfig>
  getConfigPath(): Promise<string>
  onAgentState(listener: (state: AgentSnapshot) => void): () => void
  onConversation(listener: (conversation: AgentConversation) => void): () => void
  onWorkbench(listener: (workbench: WorkbenchSnapshot) => void): () => void
}
declare global { interface Window { readonly narwhal?: NarwhalBridge } }
export {}
