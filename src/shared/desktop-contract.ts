import type { ProviderErrorCode } from './provider-error.js'

export type AgentState = 'ready' | 'starting' | 'needs-restart'
export type ConversationStatus = 'active' | 'done'
export interface TodoItem { readonly id: string; readonly text: string; readonly done: boolean }
export interface Conversation { readonly id: string; readonly workspaceId: string; readonly title: string; readonly goal: string; readonly status: ConversationStatus; readonly todos: readonly TodoItem[]; readonly createdAt: string; readonly updatedAt: string }
export interface Deliverable { readonly relativePath: string; readonly label: string; readonly pinnedAt: string }
export interface Workspace { readonly id: string; readonly name: string; readonly displayPath: string; readonly lastOpenedAt: string }
export interface GitChange { readonly path: string; readonly kind: string }
export interface AgentSession { readonly id: string; readonly title: string; readonly updatedAt: number; readonly running: boolean; readonly cwd?: string }
export interface Attachment { readonly id: string; readonly name: string; readonly size: number; readonly type: string; readonly dataUrl?: string }
export interface ChatItem { readonly id: string; readonly kind: 'user' | 'assistant' | 'trajectory' | 'error'; readonly text: string; readonly label?: string; readonly time: number; readonly streaming?: boolean; readonly attachments?: readonly Attachment[]; readonly code?: ProviderErrorCode }
export interface UsageStats { readonly turns: number; readonly steps: number; readonly llmLatency: number; readonly ttftAvg: number; readonly tokenThroughput: number; readonly cacheHitRate: number; readonly inputTokens: number; readonly outputTokens: number }
export interface AgentConversation { readonly sessions: readonly AgentSession[]; readonly selectedSessionId?: string; readonly messages: readonly ChatItem[]; readonly trajectory: readonly ChatItem[]; readonly running: boolean; readonly usage?: UsageStats }
export interface WorkbenchSnapshot { readonly workspaces: readonly Workspace[]; readonly selectedWorkspaceId?: string; readonly conversations: readonly Conversation[]; readonly selectedConversationId?: string; readonly deliverables: readonly Deliverable[]; readonly panelOpen: boolean; readonly git: { readonly branch?: string; readonly changes: readonly GitChange[] }; readonly conversation: AgentConversation }
export interface AgentSnapshot { readonly state: AgentState; readonly origin?: string }
export interface DesktopSettings { readonly appVersion: string; readonly runtimeVersion: string; readonly dataDirectory: string }
export type ThemeMode = 'auto' | 'dark' | 'light'
export interface NarwhalConfig {
  readonly version: 1
  readonly theme: ThemeMode
  readonly language?: 'en' | 'zh'
  readonly defaultModel?: string
  readonly defaultEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
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
// --- Integrations: MCP / Plugins / Skills ---
export interface McpServerCard {
  readonly name: string                // e.g. "io.github.modelcontextprotocol/server-github"
  readonly displayName: string         // e.g. "GitHub"
  readonly description: string
  readonly packageName: string         // e.g. "@modelcontextprotocol/server-github"
  readonly packageType: 'npm' | 'python' | 'docker'
  readonly version?: string
  readonly stars?: number
  readonly repositoryUrl?: string
  readonly homepageUrl?: string
  readonly tags: readonly string[]
}
export interface McpServerStdio {
  readonly serverName: string
  readonly transport: 'stdio'
  readonly command: string
  readonly args: readonly string[]
  readonly env?: ReadonlyRecord<string, string>
  readonly cwd?: string
}
export interface McpServerHttp {
  readonly serverName: string
  readonly transport: 'streamable-http'
  readonly url: string
  readonly headers?: ReadonlyRecord<string, string>
}
export type McpServer = McpServerStdio | McpServerHttp
export interface BundlePluginCard {
  readonly packageName: string         // npm package name with dsh.bundle declaration
  readonly displayName: string
  readonly description: string
  readonly version?: string
  readonly stars?: number
  readonly repositoryUrl?: string
  readonly bundleIds: readonly string[] // declared cordis bundle IDs
  readonly tags: readonly string[]
}
export interface InstalledPlugin {
  readonly packageName: string
  readonly version: string
  readonly enabled: boolean
  readonly location: string            // resolved path
}
export interface SkillCard {
  readonly id: string                  // unique skill identifier
  readonly name: string
  readonly description: string
  readonly source: 'builtin' | 'custom' | 'market'
  readonly location: string             // file path
  readonly installed: boolean
  readonly tags: readonly string[]
}
export interface InstallResult {
  readonly ok: boolean
  readonly message?: string
  readonly logs?: readonly string[]
  /** Absolute path of the installed artifact dir (skill/MCP/plugin) */
  readonly installDir?: string
}
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
  setNativeTheme(source: 'system' | 'light' | 'dark'): Promise<{ readonly applied: string }>
  // --- Integrations ---
  searchMcpServers(query: string, limit?: number): Promise<readonly McpServerCard[]>
  listInstalledMcpServers(): Promise<readonly McpServer[]>
  installMcpServer(server: McpServer): Promise<InstallResult>
  uninstallMcpServer(serverName: string): Promise<InstallResult>
  searchPlugins(query: string): Promise<readonly BundlePluginCard[]>
  listInstalledPlugins(): Promise<readonly InstalledPlugin[]>
  installPlugin(packageName: string): Promise<InstallResult>
  uninstallPlugin(packageName: string): Promise<InstallResult>
  listSkills(): Promise<readonly SkillCard[]>
  installSkillFromUrl(url: string): Promise<InstallResult>
  removeSkill(id: string): Promise<InstallResult>
  onAgentState(listener: (state: AgentSnapshot) => void): () => void
  onConversation(listener: (conversation: AgentConversation) => void): () => void
  onWorkbench(listener: (workbench: WorkbenchSnapshot) => void): () => void
}
declare global { interface Window { readonly narwhal?: NarwhalBridge } }
export {}
