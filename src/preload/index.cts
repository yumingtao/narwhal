import { contextBridge, ipcRenderer } from 'electron'
import type { AgentConfiguration, AgentConversation, AgentSnapshot, Attachment, BundlePluginCard, Command, CommandResult, ConversationStatus, CreateProviderResult, DesktopSettings, InstallResult, InstalledPlugin, McpServer, McpServerCard, NarwhalBridge, NarwhalConfig, SkillCard, WorkbenchSnapshot } from '../shared/desktop-contract.js'

const invoke = <T,>(channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload) as Promise<T>
const bridge: NarwhalBridge = Object.freeze({
  bootstrap: () => invoke<{ agent: AgentSnapshot; workbench: WorkbenchSnapshot; settings: DesktopSettings; config: NarwhalConfig; configLoadError?: string }>('narwhal:bootstrap'),
  chooseWorkspace: () => invoke<WorkbenchSnapshot>('narwhal:choose-workspace'),
  selectWorkspace: (workspaceId: string) => invoke<WorkbenchSnapshot>('narwhal:select-workspace', { workspaceId }),
  renameWorkspace: (input: { workspaceId: string; name: string }) => invoke<WorkbenchSnapshot>('narwhal:rename-workspace', input),
  deleteWorkspace: (workspaceId: string) => invoke<WorkbenchSnapshot>('narwhal:delete-workspace', { workspaceId }),
  createConversation: (input: { title: string; goal: string }) => invoke<WorkbenchSnapshot>('narwhal:create-conversation', input),
  updateConversation: (input: { conversationId: string; title?: string; goal?: string; status?: ConversationStatus }) => invoke<WorkbenchSnapshot>('narwhal:update-conversation', input),
  addTodo: (input: { conversationId: string; text: string }) => invoke<WorkbenchSnapshot>('narwhal:add-todo', input),
  toggleTodo: (input: { conversationId: string; todoId: string; done: boolean }) => invoke<WorkbenchSnapshot>('narwhal:toggle-todo', input),
  selectConversation: (conversationId: string | undefined) => invoke<WorkbenchSnapshot>('narwhal:select-conversation', { conversationId }),
  setPanelOpen: (open: boolean) => invoke<WorkbenchSnapshot>('narwhal:set-panel-open', { open }),
  pinDeliverable: (input: { relativePath: string; label: string }) => invoke<WorkbenchSnapshot>('narwhal:pin-deliverable', input),
  unpinDeliverable: (relativePath: string) => invoke<WorkbenchSnapshot>('narwhal:unpin-deliverable', { relativePath }),
  revealDeliverable: (relativePath: string) => invoke<void>('narwhal:reveal-deliverable', { relativePath }),
  listSessions: () => invoke<AgentConversation>('narwhal:list-sessions'),
  createSession: () => invoke<AgentConversation>('narwhal:create-session'),
  selectSession: (sessionId: string) => invoke<AgentConversation>('narwhal:select-session', { sessionId }),
  sendPrompt: (text: string, attachments?: readonly Attachment[]) => {
    const meta = attachments ? attachments.map((a) => ({ id: a.id, name: a.name, size: a.size, type: a.type })) : undefined
    return invoke<AgentConversation>('narwhal:send-prompt', { text, attachments: meta })
  },
  cancelPrompt: () => invoke<void>('narwhal:cancel-prompt'),
  listCommands: () => invoke<readonly Command[]>('narwhal:list-commands'),
  executeCommand: (line: string) => invoke<CommandResult>('narwhal:execute-command', { line }),
  getAgentConfiguration: () => invoke<AgentConfiguration>('narwhal:get-agent-configuration'),
  selectAgentModel: (input: { provider: string; model: string; reasoningEffort?: string }) => invoke<AgentConfiguration>('narwhal:select-agent-model', input),
  setDefaultPermission: (preset: string) => invoke<AgentConfiguration>('narwhal:set-default-permission', { preset }),
  setProviderApiKey: (input: { provider: string; value: string }) => invoke<AgentConfiguration>('narwhal:set-provider-api-key', input),
  setProviderBaseUrl: (input: { provider: string; value: string }) => invoke<AgentConfiguration>('narwhal:set-provider-base-url', input),
  updateProvider: (input: { provider: string; baseUrl?: string; modelIds?: string[] }) => invoke<AgentConfiguration>('narwhal:update-provider', input),
  deleteProvider: (providerId: string) => invoke<AgentConfiguration>('narwhal:delete-provider', { providerId }),
  createProvider: (input: { id: string; displayName?: string; baseUrl: string; protocol: string; modelIds: string[]; apiKey?: string }) => invoke<CreateProviderResult>('narwhal:create-provider', input),
  retryAgent: () => invoke<void>('narwhal:retry-agent'),
  getConfig: () => invoke<NarwhalConfig>('narwhal:get-config'),
  saveConfig: (patch: Partial<NarwhalConfig>) => invoke<NarwhalConfig>('narwhal:save-config', patch),
  getConfigPath: () => invoke<string>('narwhal:get-config-path'),
  setNativeTheme: (source: 'system' | 'light' | 'dark') => invoke<{ applied: string }>('narwhal:set-native-theme', { source }),
  // --- Integrations ---
  searchMcpServers: (query: string, limit?: number) => invoke<readonly McpServerCard[]>('narwhal:search-mcp-servers', { query, limit }),
  listInstalledMcpServers: () => invoke<readonly McpServer[]>('narwhal:list-installed-mcp-servers'),
  installMcpServer: (server: McpServer) => invoke<InstallResult>('narwhal:install-mcp-server', server),
  uninstallMcpServer: (serverName: string) => invoke<InstallResult>('narwhal:uninstall-mcp-server', { serverName }),
  searchPlugins: (query: string) => invoke<readonly BundlePluginCard[]>('narwhal:search-plugins', { query }),
  listInstalledPlugins: () => invoke<readonly InstalledPlugin[]>('narwhal:list-installed-plugins'),
  installPlugin: (packageName: string) => invoke<InstallResult>('narwhal:install-plugin', { packageName }),
  uninstallPlugin: (packageName: string) => invoke<InstallResult>('narwhal:uninstall-plugin', { packageName }),
  listSkills: () => invoke<readonly SkillCard[]>('narwhal:list-skills'),
  installSkillFromUrl: (url: string) => invoke<InstallResult>('narwhal:install-skill-from-url', { url }),
  removeSkill: (id: string) => invoke<InstallResult>('narwhal:remove-skill', { id }),
  onAgentState: (listener: (state: AgentSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AgentSnapshot) => listener(state)
    ipcRenderer.on('narwhal:agent-state', handler)
    return () => ipcRenderer.removeListener('narwhal:agent-state', handler)
  },
  onConversation: (listener: (conversation: AgentConversation) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, conversation: AgentConversation) => listener(conversation)
    ipcRenderer.on('narwhal:conversation', handler)
    return () => ipcRenderer.removeListener('narwhal:conversation', handler)
  },
  onWorkbench: (listener: (workbench: WorkbenchSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workbench: WorkbenchSnapshot) => listener(workbench)
    ipcRenderer.on('narwhal:workbench', handler)
    return () => ipcRenderer.removeListener('narwhal:workbench', handler)
  },
})
contextBridge.exposeInMainWorld('narwhal', bridge)
