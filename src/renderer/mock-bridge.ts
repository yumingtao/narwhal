import type {
  AgentConfiguration,
  AgentConversation,
  AgentSnapshot,
  CreateProviderResult,
  DesktopSettings,
  NarwhalBridge,
  Task,
  TaskStatus,
  WorkbenchSnapshot,
} from '../shared/desktop-contract.js'

const mockAgent: AgentSnapshot = { state: 'ready', origin: 'http://127.0.0.1:18789' }

const mockWorkbench: WorkbenchSnapshot = {
  workspaces: [
    { id: 'ws-1', name: 'Narwhal Forge', displayPath: '/Users/dev/narwhal-forge', lastOpenedAt: '2026-08-18T10:00:00Z' },
  ],
  selectedWorkspaceId: 'ws-1',
  tasks: [
    {
      id: 'task-1',
      title: 'Composer controls',
      goal: 'Build model picker, permission picker, and effort selector',
      status: 'active',
      todos: [
        { id: 't1', text: 'Model picker with provider grouping', done: true },
        { id: 't2', text: 'Permission preset selector', done: true },
        { id: 't3', text: 'Effort selector integration', done: false },
      ],
      createdAt: '2026-08-17T08:00:00Z',
      updatedAt: '2026-08-18T06:30:00Z',
    },
    {
      id: 'task-2',
      title: 'Fix release blockers',
      goal: 'Resolve P0/P1 issues before release',
      status: 'active',
      todos: [
        { id: 'r1', text: 'Fix Promise.all → allSettled', done: false },
        { id: 'r2', text: 'Better createProvider errors', done: false },
      ],
      createdAt: '2026-08-18T09:00:00Z',
      updatedAt: '2026-08-18T09:00:00Z',
    },
  ],
  selectedTaskId: 'task-1',
  deliverables: [
    { relativePath: 'dist/Narwhal Forge.dmg', label: 'macOS build', pinnedAt: '2026-08-17T12:00:00Z' },
    { relativePath: 'release/release-notes.md', label: 'Release notes', pinnedAt: '2026-08-18T07:00:00Z' },
  ],
  panelOpen: true,
  git: {
    branch: 'main',
    changes: [
      { path: 'src/renderer/main.tsx', kind: 'M' },
      { path: 'src/main/host-bridge.ts', kind: 'M' },
      { path: 'src/renderer/styles.css', kind: 'M' },
      { path: 'src/shared/desktop-contract.ts', kind: 'M' },
      { path: 'src/preload/index.cts', kind: 'M' },
    ],
  },
  conversation: {
    sessions: [
      { id: 'sess-1', title: 'Composer controls design', updatedAt: Date.now() - 3600000, running: false },
      { id: 'sess-2', title: 'Untitled conversation', updatedAt: Date.now() - 7200000, running: false },
    ],
    selectedSessionId: 'sess-1',
    messages: [
      { id: 'sess-1:1', kind: 'user', text: 'Add a model picker to the composer footer with provider grouping.', time: Date.now() - 1800000 },
      { id: 'sess-1:2', kind: 'assistant', text: "Here's my plan for the composer footer controls:\n\n1. **Model Picker** — Group models by provider in a `<select>` element, with the current selection pre-highlighted.\n2. **Effort Picker** — When a model supports reasoning efforts, show a compact `<select>` next to the model picker.\n3. **Permission Picker** — A shield-icon button that cycles through the preset permission levels.\n\nAll controls sit right next to the Send/Stop button in the composer footer. Want me to start implementing?", time: Date.now() - 1700000 },
      { id: 'sess-1:3', kind: 'user', text: 'Yes, implement it.', time: Date.now() - 1600000 },
      { id: 'sess-1:4', kind: 'assistant', text: "I've implemented the composer controls. Here's what was built:\n\n- Provider-grouped model picker\n- Effort selector with reasoning levels\n- Permission preset selector with full-access warning\n- Send/Stop button states\n\nThe controls are fully functional and integrate with the Agent's configuration API.", time: Date.now() - 1000000, streaming: false },
    ],
    trajectory: [
      { id: 'sess-1:1', kind: 'user', text: 'Could you analyze the project and find bottlenecks?', time: Date.now() - 2000000 },
      { id: 'sess-1:10', kind: 'trajectory', label: 'Turn started', text: 'The Agent started working on your request.', time: Date.now() - 1950000 },
      { id: 'sess-1:11', kind: 'trajectory', label: 'Updated context', text: 'Workspace context was refreshed for this turn.', time: Date.now() - 1900000 },
      { id: 'sess-1:12', kind: 'trajectory', label: 'Used local tool', text: 'The Agent is working in the local workspace.', time: Date.now() - 1850000 },
      { id: 'sess-1:13', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 1800000 },
      { id: 'sess-1:14', kind: 'assistant', text: "I've analyzed the project. Here are the main bottlenecks:\n\n1. The configuration loading is serial instead of parallel\n2. The model list is refetched on every turn\n3. The bridge emits events too frequently\n\nWould you like me to fix these?", time: Date.now() - 1750000 },
      { id: 'sess-1:15', kind: 'trajectory', label: 'Turn completed', text: 'The Agent finished this response.', time: Date.now() - 1700000 },
      { id: 'sess-1:2', kind: 'user', text: 'Yes, please fix all three issues.', time: Date.now() - 1500000 },
      { id: 'sess-1:20', kind: 'trajectory', label: 'Turn started', text: 'The Agent started working on your request.', time: Date.now() - 1450000 },
      { id: 'sess-1:21', kind: 'trajectory', label: 'Updated context', text: 'Workspace context was refreshed for this turn.', time: Date.now() - 1400000 },
      { id: 'sess-1:22', kind: 'trajectory', label: 'Used local tool', text: 'The Agent is working in the local workspace.', time: Date.now() - 1350000 },
      { id: 'sess-1:23', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 1300000 },
      { id: 'sess-1:24', kind: 'trajectory', label: 'Used local tool', text: 'The Agent is working in the local workspace.', time: Date.now() - 1250000 },
      { id: 'sess-1:25', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 1200000 },
      { id: 'sess-1:26', kind: 'assistant', text: 'All three optimizations are now in place. The bridge uses parallel RPC calls, caches model configs per session, and throttles state emissions.', time: Date.now() - 1100000 },
      { id: 'sess-1:27', kind: 'trajectory', label: 'Turn completed', text: 'The Agent finished this response.', time: Date.now() - 1050000 },
      { id: 'sess-1:3', kind: 'user', text: 'Great. Show me the diff.', time: Date.now() - 900000 },
      { id: 'sess-1:30', kind: 'trajectory', label: 'Turn started', text: 'The Agent started working on your request.', time: Date.now() - 850000 },
      { id: 'sess-1:31', kind: 'trajectory', label: 'Updated context', text: 'Workspace context was refreshed for this turn.', time: Date.now() - 800000 },
      { id: 'sess-1:32', kind: 'trajectory', label: 'Used local tool', text: 'The Agent is working in the local workspace.', time: Date.now() - 750000 },
      { id: 'sess-1:33', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 700000 },
      { id: 'sess-1:34', kind: 'trajectory', label: 'Used local tool', text: 'The Agent is working in the local workspace.', time: Date.now() - 650000 },
      { id: 'sess-1:35', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 600000 },
      { id: 'sess-1:36', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 550000 },
      { id: 'sess-1:37', kind: 'trajectory', label: 'Used local tool', text: 'The Agent is working in the local workspace.', time: Date.now() - 500000 },
      { id: 'sess-1:38', kind: 'trajectory', label: 'Step completed', text: 'The Agent completed a work step.', time: Date.now() - 450000 },
      { id: 'sess-1:39', kind: 'assistant', text: "Here's the diff summary:\n\n**host-bridge.ts**\n- Replaced `Promise.all` with `Promise.allSettled` for independent RPC tolerance\n- Added model/config caching per session\n- Throttled state emissions to 200ms\n\n**main.tsx**\n- Added `useMemo` for derived trajectory data\n- Added selection state for trajectory records", time: Date.now() - 400000 },
      { id: 'sess-1:40', kind: 'trajectory', label: 'Turn completed', text: 'The Agent finished this response.', time: Date.now() - 350000 },
    ],
    running: false,
  },
}

const mockConfig: AgentConfiguration = {
  available: true,
  writable: true,
  providers: [
    { id: 'deepseek', name: 'DeepSeek', active: true, apiKeyConfigured: true, apiKeyWritable: true },
    { id: 'anthropic', name: 'Anthropic', active: true, apiKeyConfigured: true, apiKeyWritable: true },
    { id: 'openai', name: 'OpenAI', active: false, apiKeyConfigured: false, apiKeyWritable: true },
  ],
  models: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'General-purpose chat model', efforts: [{ id: 'low', name: 'Fast', description: 'Quick responses' }, { id: 'medium', name: 'Balanced', description: 'Default reasoning' }, { id: 'high', name: 'Deep', description: 'Thorough analysis' }], defaultEffort: 'medium' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Advanced reasoning model', efforts: [{ id: 'low', name: 'Fast' }, { id: 'medium', name: 'Balanced' }, { id: 'high', name: 'Deep' }], defaultEffort: 'high' },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Balanced intelligence and speed', efforts: [], defaultEffort: undefined },
        { id: 'claude-4-opus', name: 'Claude 4 Opus', description: 'Maximum intelligence', efforts: [], defaultEffort: undefined },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', description: 'Versatile reasoning model', efforts: [], defaultEffort: undefined },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable', efforts: [], defaultEffort: undefined },
      ],
    },
  ],
  defaultPermission: 'normal',
  permissionOptions: [
    { id: 'normal', label: 'Normal' },
    { id: 'full', label: 'Full Access' },
    { id: 'read-only', label: 'Read Only' },
  ],
  customProvider: { available: true, protocols: ['openai-compatible', 'anthropic-compatible'] },
  selectedModel: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' },
}

const mockSettings: DesktopSettings = {
  appVersion: '0.1.0',
  runtimeVersion: '0.1.0-rc.5',
  dataDirectory: '/Users/dev/Library/Application Support/narwhal-forge-macos',
}

const listeners = {
  agent: new Set<(state: AgentSnapshot) => void>(),
  conversation: new Set<(conv: AgentConversation) => void>(),
  workbench: new Set<(wb: WorkbenchSnapshot) => void>(),
}

const emitAgent = () => listeners.agent.forEach((fn) => fn(mockAgent))
const emitConversation = () => listeners.conversation.forEach((fn) => fn(mockWorkbench.conversation))
const emitWorkbench = () => listeners.workbench.forEach((fn) => fn(mockWorkbench))

let currentConfig = { ...mockConfig }
let currentWorkbench = { ...mockWorkbench }

function delay<T>(value: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const _mockBridge = Object.freeze({
  bootstrap: async () => {
    if (listeners.agent.size === 0) {
      setTimeout(emitAgent, 150)
      setTimeout(emitConversation, 200)
      setTimeout(emitWorkbench, 250)
    }
    return delay({ agent: mockAgent, workbench: currentWorkbench, settings: mockSettings }, 300)
  },

  chooseWorkspace: async () => {
    const ws: WorkbenchSnapshot = {
      ...currentWorkbench,
      workspaces: [{ ...currentWorkbench.workspaces[0] }],
      selectedWorkspaceId: currentWorkbench.workspaces[0].id,
    }
    emitWorkbench()
    return delay(ws)
  },

  selectWorkspace: async (workspaceId: string) => {
    const wb: WorkbenchSnapshot = { ...currentWorkbench, selectedWorkspaceId: workspaceId }
    emitWorkbench()
    return delay(wb)
  },

  createTask: async (input: { title: string; goal: string }) => {
    const task: Task = {
      id: `task-${Date.now()}`,
      title: input.title,
      goal: input.goal,
      status: 'active',
      todos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    currentWorkbench = { ...currentWorkbench, tasks: [...currentWorkbench.tasks, task], selectedTaskId: task.id }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  updateTask: async (input: { readonly taskId: string; readonly title?: string; readonly goal?: string; readonly status?: TaskStatus }) => {
    currentWorkbench = {
      ...currentWorkbench,
      tasks: currentWorkbench.tasks.map((t) =>
        t.id === input.taskId
          ? { ...t, ...(input.title !== undefined && { title: input.title }), ...(input.goal !== undefined && { goal: input.goal }), ...(input.status !== undefined && { status: input.status }), updatedAt: new Date().toISOString() }
          : t,
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  addTodo: async (input: { readonly taskId: string; readonly text: string }) => {
    currentWorkbench = {
      ...currentWorkbench,
      tasks: currentWorkbench.tasks.map((t) =>
        t.id === input.taskId
          ? { ...t, todos: [...t.todos, { id: `todo-${Date.now()}`, text: input.text, done: false }], updatedAt: new Date().toISOString() }
          : t,
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  toggleTodo: async (input: { readonly taskId: string; readonly todoId: string; readonly done: boolean }) => {
    currentWorkbench = {
      ...currentWorkbench,
      tasks: currentWorkbench.tasks.map((t) =>
        t.id === input.taskId
          ? { ...t, todos: t.todos.map((td) => (td.id === input.todoId ? { ...td, done: input.done } : td)) }
          : t,
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  selectTask: async (taskId?: string) => {
    currentWorkbench = { ...currentWorkbench, selectedTaskId: taskId }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  setPanelOpen: async (open: boolean) => {
    currentWorkbench = { ...currentWorkbench, panelOpen: open }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  pinDeliverable: async (input: { readonly relativePath: string; readonly label: string }) => {
    currentWorkbench = {
      ...currentWorkbench,
      deliverables: [...currentWorkbench.deliverables, { relativePath: input.relativePath, label: input.label, pinnedAt: new Date().toISOString() }],
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  unpinDeliverable: async (relativePath: string) => {
    currentWorkbench = { ...currentWorkbench, deliverables: currentWorkbench.deliverables.filter((d) => d.relativePath !== relativePath) }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  revealDeliverable: async (_relativePath: string) => delay(undefined),

  listSessions: async () => delay(currentWorkbench.conversation),

  createSession: async () => {
    const conv: AgentConversation = {
      sessions: [...currentWorkbench.conversation.sessions, { id: `sess-${Date.now()}`, title: 'New conversation', updatedAt: Date.now(), running: false }],
      selectedSessionId: `sess-${Date.now()}`,
      messages: [],
      trajectory: [],
      running: false,
    }
    currentWorkbench = { ...currentWorkbench, conversation: conv }
    emitWorkbench()
    emitConversation()
    return delay(conv)
  },

  selectSession: async (sessionId: string) => {
    const conv: AgentConversation = { ...currentWorkbench.conversation, selectedSessionId: sessionId, messages: [], trajectory: [], running: false }
    currentWorkbench = { ...currentWorkbench, conversation: conv }
    emitWorkbench()
    emitConversation()
    return delay(conv)
  },

  sendPrompt: async (text: string) => {
    const msg = { id: `msg-${Date.now()}`, kind: 'user' as const, text, time: Date.now() }
    const conv: AgentConversation = {
      ...currentWorkbench.conversation,
      messages: [...currentWorkbench.conversation.messages, msg],
      running: true,
    }
    currentWorkbench = { ...currentWorkbench, conversation: conv }
    emitWorkbench()
    emitConversation()

    // Simulate streaming response
    setTimeout(() => {
      const reply = { id: `reply-${Date.now()}`, kind: 'assistant' as const, text: `Here's a mock response to: "${text}"\n\nThis is the browser debug preview with mock data.`, time: Date.now() }
      const updated: AgentConversation = {
        ...currentWorkbench.conversation,
        messages: [...currentWorkbench.conversation.messages.filter((m) => m.id !== reply.id), reply],
        running: false,
      }
      currentWorkbench = { ...currentWorkbench, conversation: updated }
      emitWorkbench()
      emitConversation()
    }, 1500)

    return delay(conv)
  },

  cancelPrompt: async () => {
    const conv: AgentConversation = { ...currentWorkbench.conversation, running: false }
    currentWorkbench = { ...currentWorkbench, conversation: conv }
    emitWorkbench()
    emitConversation()
    return delay(undefined)
  },

  getAgentConfiguration: async () => delay(currentConfig),

  selectAgentModel: async (input: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }) => {
    currentConfig = { ...currentConfig, selectedModel: { provider: input.provider, model: input.model, reasoningEffort: input.reasoningEffort } }
    return delay(currentConfig)
  },

  setDefaultPermission: async (preset: string) => {
    currentConfig = { ...currentConfig, defaultPermission: preset }
    return delay(currentConfig)
  },

  setProviderApiKey: async () => delay(currentConfig),

  setProviderBaseUrl: async () => delay(currentConfig),

  createProvider: async (input: { readonly id: string; readonly displayName?: string; readonly baseUrl: string; readonly protocol: string; readonly modelId: string; readonly apiKey?: string }) => {
    const newProvider = {
      id: input.id,
      name: input.displayName ?? input.id,
      active: true,
      apiKeyConfigured: !!input.apiKey,
      apiKeyWritable: true,
      baseUrl: input.baseUrl,
    }
    const newModelGroup = {
      id: input.id,
      name: input.displayName ?? input.id,
      models: [{ id: input.modelId, name: input.modelId, description: 'Custom provider model', efforts: [], defaultEffort: undefined }],
    }
    currentConfig = {
      ...currentConfig,
      providers: [...currentConfig.providers, newProvider],
      models: [...currentConfig.models, newModelGroup],
    }
    return delay<CreateProviderResult>({ configuration: currentConfig, keyStored: !!input.apiKey })
  },

  retryAgent: async () => {
    setTimeout(emitAgent, 200)
    return delay(undefined)
  },

  onAgentState: (listener: (state: AgentSnapshot) => void) => {
    listeners.agent.add(listener)
    return () => listeners.agent.delete(listener)
  },

  onConversation: (listener: (conversation: AgentConversation) => void) => {
    listeners.conversation.add(listener)
    return () => listeners.conversation.delete(listener)
  },

  onWorkbench: (listener: (workbench: WorkbenchSnapshot) => void) => {
    listeners.workbench.add(listener)
    return () => listeners.workbench.delete(listener)
  },
})

export const mockBridge: NarwhalBridge = _mockBridge as NarwhalBridge

// Assign to window for browser usage
if (typeof window !== 'undefined') {
  ;(window as unknown as { narwhal?: NarwhalBridge }).narwhal = mockBridge
}
