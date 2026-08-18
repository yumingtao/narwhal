export type AgentState = 'ready' | 'starting' | 'needs-restart'
export type TaskStatus = 'active' | 'done'
export interface TodoItem { readonly id: string; readonly text: string; readonly done: boolean }
export interface Task { readonly id: string; readonly title: string; readonly goal: string; readonly status: TaskStatus; readonly todos: readonly TodoItem[]; readonly createdAt: string; readonly updatedAt: string }
export interface Deliverable { readonly relativePath: string; readonly label: string; readonly pinnedAt: string }
export interface Workspace { readonly id: string; readonly name: string; readonly displayPath: string; readonly lastOpenedAt: string }
export interface GitChange { readonly path: string; readonly kind: string }
export interface AgentSession { readonly id: string; readonly title: string; readonly updatedAt: number; readonly running: boolean }
export interface ChatItem { readonly id: string; readonly kind: 'user' | 'assistant' | 'trajectory' | 'error'; readonly text: string; readonly label?: string; readonly time: number; readonly streaming?: boolean }
export interface AgentConversation { readonly sessions: readonly AgentSession[]; readonly selectedSessionId?: string; readonly messages: readonly ChatItem[]; readonly trajectory: readonly ChatItem[]; readonly running: boolean }
export interface WorkbenchSnapshot { readonly workspaces: readonly Workspace[]; readonly selectedWorkspaceId?: string; readonly tasks: readonly Task[]; readonly selectedTaskId?: string; readonly deliverables: readonly Deliverable[]; readonly panelOpen: boolean; readonly git: { readonly branch?: string; readonly changes: readonly GitChange[] }; readonly conversation: AgentConversation }
export interface AgentSnapshot { readonly state: AgentState; readonly origin?: string }
export interface DesktopSettings { readonly appVersion: string; readonly runtimeVersion: string; readonly dataDirectory: string }
export interface ModelEffort { readonly id: string; readonly name: string; readonly description?: string }
export interface AgentModel { readonly id: string; readonly name: string; readonly description?: string; readonly efforts: readonly ModelEffort[]; readonly defaultEffort?: string }
export interface ModelProvider { readonly id: string; readonly name: string; readonly models: readonly AgentModel[] }
export interface ProviderSetting { readonly id: string; readonly name: string; readonly active: boolean; readonly apiKeyConfigured: boolean; readonly apiKeyWritable: boolean; readonly baseUrl?: string }
export interface CustomProviderCapability { readonly available: boolean; readonly protocols: readonly string[]; readonly reason?: string }
export interface AgentConfiguration { readonly available: boolean; readonly writable: boolean; readonly providers: readonly ProviderSetting[]; readonly models: readonly ModelProvider[]; readonly defaultPermission?: string; readonly permissionOptions: readonly { readonly id: string; readonly label: string }[]; readonly customProvider: CustomProviderCapability; readonly selectedModel?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }; readonly error?: string }
export interface CreateProviderResult { readonly configuration: AgentConfiguration; readonly keyStored: boolean }
export interface NarwhalBridge {
  bootstrap(): Promise<{ readonly agent: AgentSnapshot; readonly workbench: WorkbenchSnapshot; readonly settings: DesktopSettings }>
  chooseWorkspace(): Promise<WorkbenchSnapshot>
  selectWorkspace(workspaceId: string): Promise<WorkbenchSnapshot>
  createTask(input: { readonly title: string; readonly goal: string }): Promise<WorkbenchSnapshot>
  updateTask(input: { readonly taskId: string; readonly title?: string; readonly goal?: string; readonly status?: TaskStatus }): Promise<WorkbenchSnapshot>
  addTodo(input: { readonly taskId: string; readonly text: string }): Promise<WorkbenchSnapshot>
  toggleTodo(input: { readonly taskId: string; readonly todoId: string; readonly done: boolean }): Promise<WorkbenchSnapshot>
  selectTask(taskId?: string): Promise<WorkbenchSnapshot>
  setPanelOpen(open: boolean): Promise<WorkbenchSnapshot>
  pinDeliverable(input: { readonly relativePath: string; readonly label: string }): Promise<WorkbenchSnapshot>
  unpinDeliverable(relativePath: string): Promise<WorkbenchSnapshot>
  revealDeliverable(relativePath: string): Promise<void>
  listSessions(): Promise<AgentConversation>
  createSession(): Promise<AgentConversation>
  selectSession(sessionId: string): Promise<AgentConversation>
  sendPrompt(text: string): Promise<AgentConversation>
  cancelPrompt(): Promise<void>
  getAgentConfiguration(): Promise<AgentConfiguration>
  selectAgentModel(input: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<AgentConfiguration>
  setDefaultPermission(preset: string): Promise<AgentConfiguration>
  setProviderApiKey(input: { readonly provider: string; readonly value: string }): Promise<AgentConfiguration>
  setProviderBaseUrl(input: { readonly provider: string; readonly value: string }): Promise<AgentConfiguration>
  createProvider(input: { readonly id: string; readonly displayName?: string; readonly baseUrl: string; readonly protocol: string; readonly modelId: string; readonly apiKey?: string }): Promise<CreateProviderResult>
  retryAgent(): Promise<void>
  onAgentState(listener: (state: AgentSnapshot) => void): () => void
  onConversation(listener: (conversation: AgentConversation) => void): () => void
  onWorkbench(listener: (workbench: WorkbenchSnapshot) => void): () => void
}
declare global { interface Window { readonly narwhal?: NarwhalBridge } }
export {}
