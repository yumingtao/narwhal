import type {
  AgentConfiguration,
  AgentConversation,
  AgentSnapshot,
  Attachment,
  Conversation,
  ConversationStatus,
  CreateProviderResult,
  DesktopSettings,
  NarwhalBridge,
  NarwhalConfig,
  WorkbenchSnapshot,
} from '../shared/desktop-contract.js'

const mockNarwhalConfig: NarwhalConfig = {
  version: 1,
  theme: 'auto',
  defaultModel: 'deepseek-chat',
  defaultEffort: 'medium',
  agentMode: 'minimal',
  permissionLevel: 'default',
  providers: {
    deepseek: { enabled: true, options: { apiKey: '{env:DEEPSEEK_API_KEY}' } },
    anthropic: { enabled: true, options: { apiKey: '{env:ANTHROPIC_API_KEY}' } },
    openai: { enabled: true, options: { apiKey: '{env:OPENAI_API_KEY}' } },
  },
}

const mockAgent: AgentSnapshot = { state: 'ready', origin: 'http://127.0.0.1:18789' }

const mockWorkbench: WorkbenchSnapshot = {
  workspaces: [
    { id: 'ws-1', name: 'Narwhal', displayPath: '/Users/dev/narwhal', lastOpenedAt: '2026-08-18T10:00:00Z' },
  ],
  selectedWorkspaceId: 'ws-1',
  conversations: [
    {
      id: 'conv-1',
      workspaceId: 'ws-1',
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
      id: 'conv-2',
      workspaceId: 'ws-1',
      title: 'Fix release blockers',
      goal: 'Resolve P0/P1 issues before release',
      status: 'active',
      todos: [
        { id: 'r1', text: 'Fix Promise.all → allSettled', done: false },
        { id: 'r2', text: 'Better createConversation errors', done: false },
      ],
      createdAt: '2026-08-18T09:00:00Z',
      updatedAt: '2026-08-18T09:00:00Z',
    },
    {
      id: 'conv-3',
      workspaceId: 'ws-1',
      title: 'Sidebar resizable implementation',
      goal: 'Add drag-to-resize functionality for left sidebar',
      status: 'done',
      todos: [
        { id: 's1', text: 'Add 5px resizer on right edge', done: true },
        { id: 's2', text: 'Implement drag interaction logic', done: true },
        { id: 's3', text: 'Persist width to localStorage', done: true },
      ],
      createdAt: '2026-08-18T10:00:00Z',
      updatedAt: '2026-08-18T11:00:00Z',
    },
    {
      id: 'conv-4',
      workspaceId: 'ws-1',
      title: 'Provider multi-model support',
      goal: 'Enhance provider management to support multiple models',
      status: 'active',
      todos: [
        { id: 'p1', text: 'Update createProvider API for modelIds array', done: true },
        { id: 'p2', text: 'Add dynamic model input fields in UI', done: true },
        { id: 'p3', text: 'Handle model deletion and fallback', done: false },
      ],
      createdAt: '2026-08-18T12:00:00Z',
      updatedAt: '2026-08-19T08:00:00Z',
    },
    {
      id: 'conv-5',
      workspaceId: 'ws-1',
      title: 'Trajectory view design',
      goal: 'Design and implement trajectory visualization',
      status: 'done',
      todos: [
        { id: 'tr1', text: 'Build timeline component', done: true },
        { id: 'tr2', text: 'Add event table with filtering', done: true },
        { id: 'tr3', text: 'Implement inspector panel', done: true },
      ],
      createdAt: '2026-08-18T14:00:00Z',
      updatedAt: '2026-08-18T16:00:00Z',
    },
    {
      id: 'conv-6',
      workspaceId: 'ws-1',
      title: 'Settings dialog refactor',
      goal: 'Unified settings dialog with grouped navigation',
      status: 'active',
      todos: [
        { id: 'se1', text: 'Group settings into Agent/Security/System', done: true },
        { id: 'se2', text: 'Compact list layout for providers', done: false },
      ],
      createdAt: '2026-08-19T08:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    },
    {
      id: 'conv-7',
      workspaceId: 'ws-1',
      title: 'Icon system migration',
      goal: 'Replace custom SVG icons with DSH native icons',
      status: 'done',
      todos: [
        { id: 'i1', text: 'Extract icons from DSH source', done: true },
        { id: 'i2', text: 'Create iconMap component', done: true },
        { id: 'i3', text: 'Update all icon references', done: true },
      ],
      createdAt: '2026-08-19T09:00:00Z',
      updatedAt: '2026-08-19T09:30:00Z',
    },
    {
      id: 'conv-8',
      workspaceId: 'ws-1',
      title: 'Status bar metrics',
      goal: 'Display DSH-style usage metrics in bottom status bar',
      status: 'active',
      todos: [
        { id: 'st1', text: 'Add UsageStats interface', done: true },
        { id: 'st2', text: 'Mock data for metrics', done: true },
        { id: 'st3', text: 'CSS styling for metrics display', done: false },
      ],
      createdAt: '2026-08-19T11:00:00Z',
      updatedAt: '2026-08-19T14:00:00Z',
    },
  ],
  selectedConversationId: 'conv-1',
  deliverables: [
    { relativePath: 'dist/Narwhal.dmg', label: 'macOS build', pinnedAt: '2026-08-17T12:00:00Z' },
    { relativePath: 'release/release-notes.md', label: 'Release notes', pinnedAt: '2026-08-18T07:00:00Z' },
  ],
  panelOpen: false,
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
    usage: {
      turns: 3,
      steps: 5,
      llmLatency: 2100,
      ttftAvg: 1000,
      tokenThroughput: 103,
      cacheHitRate: 0,
      inputTokens: 8700,
      outputTokens: 117,
    },
  },
}

const mockConfig: AgentConfiguration = {
  available: true,
  writable: true,
  providers: [
    { id: 'deepseek', name: 'DeepSeek', active: true, apiKeyConfigured: true, apiKeyWritable: true, protocol: 'deepseek' },
    { id: 'anthropic', name: 'Anthropic', active: true, apiKeyConfigured: true, apiKeyWritable: true, protocol: 'anthropic' },
    { id: 'openai', name: 'OpenAI', active: false, apiKeyConfigured: false, apiKeyWritable: true, protocol: 'openai' },
  ],
  models: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high', effortsNative: true },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high', effortsNative: true },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet', efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium', effortsNative: false },
        { id: 'claude-4-opus', name: 'Claude 4 Opus', efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium', effortsNative: false },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', efforts: [], defaultEffort: undefined },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', efforts: [], defaultEffort: undefined },
        { id: 'o3', name: 'o3', efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium', effortsNative: true },
        { id: 'o4-mini', name: 'o4-mini', efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium', effortsNative: true },
      ],
    },
  ],
  defaultPermission: 'workspace-write',
  permissionOptions: [
    { id: 'read-only', label: 'Read Only' },
    { id: 'workspace-write', label: 'Workspace Write' },
    { id: 'full-access', label: 'Full Access' },
  ],
  customProvider: { available: true, protocols: ['openai-compatible', 'anthropic-compatible'] },
  selectedModel: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
}

const mockSettings: DesktopSettings = {
  appVersion: '0.1.0',
  runtimeVersion: '0.1.0-rc.5',
  dataDirectory: '/Users/dev/Library/Application Support/com.narwhal.app',
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
    return delay({ agent: mockAgent, workbench: currentWorkbench, settings: mockSettings, config: mockNarwhalConfig }, 300)
  },

  chooseWorkspace: async () => {
    // Use File System Access API to trigger native "Select Folder" dialog
    // showDirectoryPicker() shows a system-level folder selector (not upload)
    const anyWindow = window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> }
    if (typeof anyWindow.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await anyWindow.showDirectoryPicker()
        const dirName = dirHandle.name || 'New Workspace'
        const newWs = {
          id: `ws-${Date.now()}`,
          name: dirName,
          displayPath: `/Users/dev/${dirName}`,
          lastOpenedAt: new Date().toISOString(),
        }
        const ws: WorkbenchSnapshot = {
          ...currentWorkbench,
          workspaces: [...currentWorkbench.workspaces, newWs],
          selectedWorkspaceId: newWs.id,
        }
        Object.assign(currentWorkbench, ws)
        emitWorkbench()
        return delay(ws)
      } catch {
        // User cancelled the dialog
        return delay(currentWorkbench)
      }
    }

    // Fallback: use webkitdirectory input for browsers without showDirectoryPicker
    return new Promise<WorkbenchSnapshot>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true
      input.multiple = true
      input.style.display = 'none'

      input.onchange = () => {
        const files = Array.from(input.files ?? [])
        if (files.length === 0) {
          resolve(delay(currentWorkbench))
          return
        }
        const firstFile = files[0] as File & { webkitRelativePath: string }
        const dirName = firstFile.webkitRelativePath.split('/')[0] || 'New Workspace'
        const newWs = {
          id: `ws-${Date.now()}`,
          name: dirName,
          displayPath: `/Users/dev/${dirName}`,
          lastOpenedAt: new Date().toISOString(),
        }
        const ws: WorkbenchSnapshot = {
          ...currentWorkbench,
          workspaces: [...currentWorkbench.workspaces, newWs],
          selectedWorkspaceId: newWs.id,
        }
        Object.assign(currentWorkbench, ws)
        emitWorkbench()
        resolve(delay(ws))
      }

      input.oncancel = () => { resolve(delay(currentWorkbench)) }
      document.body.appendChild(input)
      input.click()
      setTimeout(() => { if (input.parentNode) input.parentNode.removeChild(input) }, 60000)
    })
  },

  selectWorkspace: async (workspaceId: string) => {
    const wb: WorkbenchSnapshot = { ...currentWorkbench, selectedWorkspaceId: workspaceId }
    emitWorkbench()
    return delay(wb)
  },

  renameWorkspace: async (input: { readonly workspaceId: string; readonly name: string }) => {
    currentWorkbench = {
      ...currentWorkbench,
      workspaces: currentWorkbench.workspaces.map((w) =>
        w.id === input.workspaceId ? { ...w, name: input.name } : w
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  deleteWorkspace: async (workspaceId: string) => {
    const remaining = currentWorkbench.workspaces.filter((w) => w.id !== workspaceId)
    const remainingConversations = currentWorkbench.conversations.filter((c) => c.workspaceId !== workspaceId)
    const nextSelected = currentWorkbench.selectedWorkspaceId === workspaceId
      ? remaining[0]?.id
      : currentWorkbench.selectedWorkspaceId
    currentWorkbench = {
      ...currentWorkbench,
      workspaces: remaining,
      conversations: remainingConversations,
      selectedWorkspaceId: nextSelected,
      selectedConversationId: remainingConversations[0]?.id,
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  createConversation: async (input: { title: string; goal: string }) => {
    const conversation: Conversation = {
      id: `conv-${Date.now()}`,
      workspaceId: currentWorkbench.selectedWorkspaceId ?? '',
      title: input.title,
      goal: input.goal,
      status: 'active',
      todos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    currentWorkbench = { ...currentWorkbench, conversations: [...currentWorkbench.conversations, conversation], selectedConversationId: conversation.id }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  updateConversation: async (input: { readonly conversationId: string; readonly title?: string; readonly goal?: string; readonly status?: ConversationStatus }) => {
    currentWorkbench = {
      ...currentWorkbench,
      conversations: currentWorkbench.conversations.map((t) =>
        t.id === input.conversationId
          ? { ...t, ...(input.title !== undefined && { title: input.title }), ...(input.goal !== undefined && { goal: input.goal }), ...(input.status !== undefined && { status: input.status }), updatedAt: new Date().toISOString() }
          : t,
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  addTodo: async (input: { readonly conversationId: string; readonly text: string }) => {
    currentWorkbench = {
      ...currentWorkbench,
      conversations: currentWorkbench.conversations.map((t) =>
        t.id === input.conversationId
          ? { ...t, todos: [...t.todos, { id: `todo-${Date.now()}`, text: input.text, done: false }], updatedAt: new Date().toISOString() }
          : t,
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  toggleTodo: async (input: { readonly conversationId: string; readonly todoId: string; readonly done: boolean }) => {
    currentWorkbench = {
      ...currentWorkbench,
      conversations: currentWorkbench.conversations.map((t) =>
        t.id === input.conversationId
          ? { ...t, todos: t.todos.map((td) => (td.id === input.todoId ? { ...td, done: input.done } : td)) }
          : t,
      ),
    }
    emitWorkbench()
    return delay(currentWorkbench)
  },

  selectConversation: async (conversationId?: string) => {
    currentWorkbench = { ...currentWorkbench, selectedConversationId: conversationId }
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

  sendPrompt: async (text: string, attachments?: readonly Attachment[]) => {
    const hasAttachments = !!(attachments && attachments.length)
    const displayText = text || (hasAttachments ? `Analyzing ${attachments!.length} attachment${attachments!.length !== 1 ? 's' : ''}` : '')
    const msg = { id: `msg-${Date.now()}`, kind: 'user' as const, text: displayText, time: Date.now(), attachments: attachments ? [...attachments] : undefined }
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
      const attachmentNote = hasAttachments
        ? `\n\nI've received ${attachments!.length} attachment${attachments!.length !== 1 ? 's' : ''} (${attachments!.map(a => a.name).join(', ')}). `
        : ''
      const promptNote = text ? `"${text}"` : 'your request'
      const reply = { id: `reply-${Date.now()}`, kind: 'assistant' as const, text: `Here's a mock response to ${promptNote}${attachmentNote}\n\nThis is the browser debug preview with mock data.`, time: Date.now() }
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

  listCommands: async () => delay([
    { name: 'compact', description: 'Compress the conversation context to save tokens' },
    { name: 'export', description: 'Export the current conversation as a zip file' },
    { name: 'goal', description: 'Set a long-term goal for this conversation', input: { hint: 'Describe your goal' } },
    { name: 'plan', description: 'Toggle plan mode — the agent will plan before acting' },
    { name: 'permission', description: 'Show or change the operation permission preset' },
    { name: 'feedback', description: 'Send feedback to the DeepSeek Harness team' },
    { name: 'repo', description: 'Show git branch and recent commits (skill)', input: { hint: 'path or . for current' } },
  ]),

  executeCommand: async (line: string) => {
    console.log('[mock] executeCommand:', line)
    return delay({ kind: 'success' as const, text: `Command executed: ${line}` })
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

  updateProvider: async (input: { readonly provider: string; readonly baseUrl?: string; readonly modelIds?: readonly string[] }) => {
    const providerId = input.provider
    // Update provider baseUrl if provided
    if (input.baseUrl !== undefined) {
      currentConfig = {
        ...currentConfig,
        providers: currentConfig.providers.map((p) =>
          p.id === providerId ? { ...p, baseUrl: input.baseUrl } : p
        ),
      }
    }
    // Update model list if provided
    if (input.modelIds !== undefined) {
      const modelIds = input.modelIds.filter((m) => m.trim())
      currentConfig = {
        ...currentConfig,
        models: currentConfig.models.map((m) => {
          if (m.id === providerId) {
            return {
              ...m,
              models: modelIds.map((modelId) => ({
                id: modelId.trim(),
                name: modelId.trim(),
                efforts: [] as Array<{ id: string; name: string }>,
                defaultEffort: undefined as string | undefined,
              })),
            }
          }
          return m
        }),
      }
      // If current selected model was removed, fallback
      const current = currentConfig.selectedModel
      if (current?.provider === providerId) {
        const providerGroup = currentConfig.models.find((m) => m.id === providerId)
        const stillExists = providerGroup?.models.some((m) => m.id === current.model)
        if (!stillExists && providerGroup?.models.length) {
          currentConfig = {
            ...currentConfig,
            selectedModel: {
              provider: providerId,
              model: providerGroup.models[0].id,
              reasoningEffort: providerGroup.models[0].defaultEffort,
            },
          }
        }
      }
    }
    return delay(currentConfig)
  },

  deleteProvider: async (providerId: string) => {
    currentConfig = {
      ...currentConfig,
      providers: currentConfig.providers.filter((p) => p.id !== providerId),
      models: currentConfig.models.filter((m) => m.id !== providerId),
    }
    // If deleted provider was selected, fallback to first available
    if (currentConfig.selectedModel?.provider === providerId) {
      const firstAvailable = currentConfig.models[0]
      if (firstAvailable) {
        currentConfig = {
          ...currentConfig,
          selectedModel: {
            provider: firstAvailable.id,
            model: firstAvailable.models[0]?.id ?? '',
            reasoningEffort: firstAvailable.models[0]?.defaultEffort,
          },
        }
      }
    }
    return delay(currentConfig)
  },

  createProvider: async (input: { readonly id: string; readonly displayName?: string; readonly baseUrl: string; readonly protocol: string; readonly modelIds: readonly string[]; readonly apiKey?: string }) => {
    const protocol = input.protocol.includes('openai') ? 'openai' : input.protocol.includes('anthropic') ? 'anthropic' : input.protocol
    const newProvider = {
      id: input.id,
      name: input.displayName ?? input.id,
      active: true,
      apiKeyConfigured: !!input.apiKey,
      apiKeyWritable: true,
      baseUrl: input.baseUrl,
      protocol,
    }
    const openaiEfforts = [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }]
    const supportsFallbackEfforts = protocol === 'openai' || protocol === 'anthropic'
    const models = input.modelIds.map((modelId) => ({
      id: modelId,
      name: modelId,
      efforts: supportsFallbackEfforts ? openaiEfforts : [] as Array<{ id: string; name: string }>,
      defaultEffort: supportsFallbackEfforts ? 'medium' as string | undefined : undefined as string | undefined,
      effortsNative: false,
    }))
    const newModelGroup = {
      id: input.id,
      name: input.displayName ?? input.id,
      models,
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

  // ── Integrations (browser preview: real HTTP via fetch()) ──
  searchMcpServers: async (query: string, limit = 12) => {
    try {
      const q = query?.trim() || ''
      const url = q
        ? `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(q)}&limit=${limit}`
        : `https://registry.modelcontextprotocol.io/v0.1/servers?limit=${limit}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) return delay([])
      const raw = await res.json()
      const entries: any[] = Array.isArray(raw?.servers) ? raw.servers : []
      return delay(entries.map((e) => {
        const s = e.server ?? e
        const name: string = s.name ?? ''
        const lastSeg = name.includes('/') ? name.split('/').pop()! : name
        return {
          name, displayName: s.title || lastSeg || name,
          description: s.description ?? '',
          packageName: `registry:${name}`, packageType: 'http' as const,
          version: s.version, stars: undefined, repositoryUrl: undefined,
          tags: (s.remotes ?? []).map((r: any) => r?.type ?? 'unknown'),
        }
      }))
    } catch { return delay([]) }
  },
  listInstalledMcpServers: async () => delay([]),
  installMcpServer: async (_server: any) => delay({ ok: true, message: 'Installed (browser preview mock)' }),
  uninstallMcpServer: async (_serverName: string) => delay({ ok: true, message: 'Uninstalled (browser preview mock)' }),
  searchPlugins: async (query: string) => {
    try {
      const q = query?.trim() ? `${query} dsh-plugin` : 'dsh-plugin deepseek-harness'
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) return delay([])
      const raw = await res.json()
      const items: any[] = Array.isArray(raw?.objects) ? raw.objects : []
      return delay(items.filter((it) => it.package?.name?.startsWith?.('@deepseek-ai')).map((it) => ({
        packageName: it.package.name, displayName: it.package.name.replace(/^dsh-/, '').trim(),
        description: it.package.description ?? '', version: it.package.version,
        stars: Math.round((it.score?.detail?.popularity ?? 0) * 1000),
        repositoryUrl: it.package.links?.repository, bundleIds: [], tags: it.keywords ?? [],
      })))
    } catch { return delay([]) }
  },
  listInstalledPlugins: async () => delay([]),
  installPlugin: async (_packageName: string) => delay({ ok: true, message: 'Installed (browser preview mock)' }),
  uninstallPlugin: async (_packageName: string) => delay({ ok: true, message: 'Uninstalled (browser preview mock)' }),
  listSkills: async () => delay([]),
  installSkillFromUrl: async (_url: string) => delay({ ok: true, message: 'Installed (browser preview mock)' }),
  removeSkill: async (_id: string) => delay({ ok: true, message: 'Removed (browser preview mock)' }),

  getConfig: async () => delay(mockNarwhalConfig),
  saveConfig: async (patch: Partial<NarwhalConfig>) => delay({ ...mockNarwhalConfig, ...patch } as NarwhalConfig),
  getConfigPath: async () => delay('~/.config/narwhal/config.json'),

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

// Install the browser-preview mock bridge on window.narwhal.
// - In Electron, the preload script always sets window.narwhal FIRST via
//   contextBridge.exposeInMainWorld(), so we leave the real bridge untouched.
// - In browser dev preview, window.narwhal starts undefined → we set it.
// - During HMR a stale cached mock may have set window.narwhal without the
//   latest methods (e.g. searchMcpServers). Detect that case and overwrite.
//
// Detection strategy:
//   - A real Electron preload bridge ALWAYS exposes `bootstrap` as a function
//     (see electron/preload/index.cts). If we see bootstrap, do NOT overwrite.
//   - Anything else (missing, stale mock, incomplete HMR reload) gets refreshed.
if (typeof window !== 'undefined') {
  const existing = (window as any).narwhal as Partial<NarwhalBridge> | undefined
  const hasRealPreloadBridge = typeof existing?.bootstrap === 'function'
  if (!hasRealPreloadBridge) {
    ;(window as unknown as { narwhal: NarwhalBridge }).narwhal = mockBridge
  }
}
