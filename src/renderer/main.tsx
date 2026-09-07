// Load bridge first so that `window.narwhal` is available for all downstream modules
import './mock-bridge.js'

import { StrictMode, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import 'highlight.js/styles/github-dark.css'
import type { AgentConfiguration, AgentConversation, AgentSnapshot, Attachment, ChatItem, Command, Conversation, DesktopSettings, NarwhalConfig, ThemeMode, UsageStats, WorkbenchSnapshot } from '../shared/desktop-contract'
import { classifyTrajectory } from '../shared/trajectory-classifier'
import { buildTrajectoryData } from './trajectory/builder'
import { TrajectoryToolbar } from './trajectory/TrajectoryToolbar'
import { TrajectoryTimeline } from './trajectory/TrajectoryTimeline'
import { TrajectoryTable } from './trajectory/TrajectoryTable'
import { TrajectoryInspector } from './trajectory/TrajectoryInspector'
import { McpServersTab, PluginsTab, SkillsTab } from './integrations.tsx'
import './styles.css'

// Detect Electron vs. browser (dev preview) environment and load the appropriate bridge
const _api = window.narwhal
if (!_api) throw new Error('Narwhal desktop bridge is unavailable')
const api = _api
const blankConversation: AgentConversation = { sessions: [], messages: [], trajectory: [], running: false }
const blank: WorkbenchSnapshot = { workspaces: [], conversations: [], deliverables: [], panelOpen: false, git: { changes: [] }, conversation: blankConversation }
import { iconMap, type IconName } from './icons'
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const render = iconMap[name]
  return render ? <span className={`icon i-${name}`} aria-hidden="true">{render(size)}</span> : null
}
function statusText(state: AgentSnapshot['state']) { return state === 'ready' ? 'Agent ready' : state === 'starting' ? 'Starting agent' : 'Agent needs restart' }
function formatTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}` }
function formatLatency(ms: number) { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms` }
type StatusMetrics = Pick<UsageStats, 'turns' | 'steps'> & Partial<Omit<UsageStats, 'turns' | 'steps'>>

function deriveStatusMetrics(conversation: AgentConversation): StatusMetrics {
  if (conversation.usage) return conversation.usage

  const completedSteps = conversation.trajectory.filter((item) => item.label === 'Step completed').length
  const startedSteps = conversation.trajectory.filter((item) => item.label === 'Started analysis').length
  return {
    // Message history is the authoritative local record of user-initiated turns.
    turns: conversation.messages.filter((item) => item.kind === 'user').length,
    // A step can expose a start, a completion, or both; count each completed step
    // once, while still showing in-progress work when completion events are absent.
    steps: Math.max(completedSteps, startedSteps),
  }
}

function formatOptionalLatency(value: number | undefined) { return value === undefined ? '—' : formatLatency(value) }
function formatOptionalTokens(value: number | undefined) { return value === undefined ? '—' : formatTokens(value) }
function formatRelativeTime(dateStr: string) {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}d`
  const diffWeek = Math.floor(diffDay / 7)
  if (diffWeek < 5) return `${diffWeek}w`
  const diffMonth = Math.floor(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}mo`
  return `${Math.floor(diffMonth / 12)}y`
}

// Agent mode definitions (UI-level, matching DSH native modes)
type AgentMode = 'standard' | 'ptc' | 'minimal' | 'creator'
const AGENT_MODES: Record<AgentMode, { name: string; description: string }> = {
  standard: {
    name: 'Standard mode',
    description: 'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  },
  ptc: {
    name: 'PTC mode',
    description: 'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  },
  minimal: {
    name: 'Minimal mode',
    description: 'Two-tool coding agent with persistent bash and str_replace_editor.',
  },
  creator: {
    name: 'Creator mode',
    description: 'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  },
}
const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/u.exec(className ?? '')?.[1]
    const text = String(children).replace(/\n$/u, '')
    if (!language) return <code className={className} {...props}>{children}</code>
    return <div className="code-block"><div><span>{language}</span><button type="button" aria-label="Copy code" onClick={() => void navigator.clipboard.writeText(text).catch(() => undefined)}>Copy</button></div><pre><code className={className} {...props}>{children}</code></pre></div>
  },
}
export function MarkdownMessage({ content }: { content: string }) { return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>{content}</ReactMarkdown> }

const DEFAULT_SIDEBAR_WIDTH = 285
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 400
const SIDEBAR_WIDTH_KEY = 'narwhal:sidebar-width'
const SIDEBAR_COLLAPSED_KEY = 'narwhal:sidebar-collapsed'
const COLLAPSED_SIDEBAR_WIDTH = 54
const DEFAULT_PANEL_WIDTH = 304
const MIN_PANEL_WIDTH = 220
const MAX_PANEL_WIDTH = 500
const PANEL_WIDTH_KEY = 'narwhal:panel-width'

function App() {
  const [workbench, setWorkbench] = useState<WorkbenchSnapshot>(blank)
  const [conversation, setConversation] = useState<AgentConversation>(blankConversation)
  const [agent, setAgent] = useState<AgentSnapshot>({ state: 'starting' })
  const [settings, setSettings] = useState<DesktopSettings>({ appVersion: '0.1.0', runtimeVersion: 'Unavailable', dataDirectory: '' })
  const [configuration, setConfiguration] = useState<AgentConfiguration>({ available: false, writable: false, providers: [], models: [], permissionOptions: [], customProvider: { available: false, protocols: [] } })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deliverableDraft, setDeliverableDraft] = useState(false)
  const [trajectoryOpen, setTrajectoryOpen] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<AgentMode>(() => {
    const stored = localStorage.getItem('narwhal:agent-mode') as AgentMode | null
    return stored && stored in AGENT_MODES ? stored : 'standard'
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    // Migrate: clear the previous default (236) so the new default (285) takes effect
    if (stored === '236') { localStorage.removeItem(SIDEBAR_WIDTH_KEY); return DEFAULT_SIDEBAR_WIDTH }
    return stored ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parseInt(stored, 10))) : DEFAULT_SIDEBAR_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true')
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY)
    return stored ? Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, parseInt(stored, 10))) : DEFAULT_PANEL_WIDTH
  })
  const [config, setConfig] = useState<NarwhalConfig | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('narwhal:theme') as ThemeMode | null
    return stored ?? 'auto'
  })
  const selectedConversation = useMemo(() => workbench.conversations.find((conv) => conv.id === workbench.selectedConversationId) ?? workbench.conversations[0], [workbench])
  const workspace = workbench.workspaces.find((item) => item.id === workbench.selectedWorkspaceId)
  const mutate = async (operation: () => Promise<WorkbenchSnapshot>) => { try { setError(''); const next = await operation(); setWorkbench(next); setConversation(next.conversation) } catch { setError('We couldn’t complete that action. Your local files were not changed.') } }
  const agentCall = async (operation: () => Promise<AgentConversation>) => { try { setError(''); setConversation(await operation()) } catch { setError('The local Agent could not complete that request. Check its status and try again.') } }
  const createSession = async (workspaceId: string) => {
    try {
      setError('')
      if (workspaceId !== workbench.selectedWorkspaceId) {
        const next = await api.selectWorkspace(workspaceId)
        setWorkbench(next)
        setConversation(next.conversation)
      }
      setConversation(await api.createSession())
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      setError(`Couldn’t create a local Agent session in this workspace: ${detail}`)
    }
  }
  const selectSessionForWorkspace = async (workspaceId: string, sessionId: string) => {
    try {
      setError('')
      if (workspaceId !== workbench.selectedWorkspaceId) {
        const next = await api.selectWorkspace(workspaceId)
        setWorkbench(next)
        setConversation(next.conversation)
      }
      setConversation(await api.selectSession(sessionId))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      setError(`Couldn’t open this local Agent session: ${detail}`)
    }
  }
  useEffect(() => {
    void api.bootstrap().then(({ agent, workbench, settings, config: bootstrapConfig }) => {
      setAgent(agent); setSettings(settings); setWorkbench(workbench); setConversation(workbench.conversation)
      if (bootstrapConfig) {
        setConfig(bootstrapConfig)
        setTheme(bootstrapConfig.theme)
      }
    }).catch(() => setError('Narwhal could not load its local workspace data.'))
    const unAgent = api.onAgentState(setAgent); const unConversation = api.onConversation(setConversation)
    const unWorkbench = api.onWorkbench((next) => { setWorkbench(next); setConversation(next.conversation) })
    return () => { unAgent(); unConversation(); unWorkbench() }
  }, [])
  useEffect(() => { if (agent.state === 'ready') void api.getAgentConfiguration().then(setConfiguration).catch(() => undefined) }, [agent.state, conversation.selectedSessionId])
  // Refresh main-window configuration whenever Settings dialog closes, so
  // provider/model additions, edits and deletes are immediately reflected in
  // the composer dropdown without requiring an app restart.
  const prevSettingsOpen = useRef(settingsOpen)
  useEffect(() => {
    if (prevSettingsOpen.current && !settingsOpen && agent.state === 'ready') {
      void api.getAgentConfiguration().then(setConfiguration).catch(() => undefined)
    }
    prevSettingsOpen.current = settingsOpen
  }, [settingsOpen, agent.state])
  const selectModel = async (input: { provider: string; model: string; reasoningEffort?: string }) => { try { setConfiguration(await api.selectAgentModel(input)) } catch { setError('The selected model could not be applied. Nothing was changed.') } }
  const selectPermission = async (preset: string) => { if (preset.toLowerCase().includes('full') && !window.confirm('Full access can allow unrestricted local tool operations. Continue?')) return; try { setConfiguration(await api.setDefaultPermission(preset)) } catch { setError('The selected permission could not be applied. Nothing was changed.') } }
  useEffect(() => { if (workspace && agent.state === 'ready') void agentCall(api.listSessions) }, [workspace?.id, agent.state])
  useEffect(() => { localStorage.setItem('narwhal:agent-mode', mode) }, [mode])
  useEffect(() => { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)) }, [sidebarWidth])
  useEffect(() => { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed)) }, [sidebarCollapsed])
  useEffect(() => { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)) }, [panelWidth])
  // Apply theme to document element
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('narwhal:theme', theme)
    console.log('[narwhal-renderer] theme applied:', theme, '→ data-theme=', document.documentElement.dataset.theme)
  }, [theme])
  // Listen to system preference changes when theme is "auto"
  useEffect(() => {
    if (theme !== 'auto') return
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => { /* CSS media query handles auto; no JS action needed */ }
    mql.addEventListener?.('change', onChange) ?? mql.addListener?.(onChange)
    return () => { mql.removeEventListener?.('change', onChange) ?? mql.removeListener?.(onChange) }
  }, [theme])
  // Persist theme to config.json
  useEffect(() => {
    if (!config) return
    void api.saveConfig({ theme }).catch(() => undefined)
  }, [theme])
  const layoutStyle = sidebarCollapsed
    ? workbench.panelOpen
      ? { gridTemplateColumns: `${COLLAPSED_SIDEBAR_WIDTH}px minmax(390px, 1fr) 5px ${panelWidth}px` }
      : { gridTemplateColumns: `${COLLAPSED_SIDEBAR_WIDTH}px minmax(390px, 1fr)` }
    : workbench.panelOpen
      ? { gridTemplateColumns: `${sidebarWidth}px 5px minmax(390px, 1fr) 5px ${panelWidth}px` }
      : { gridTemplateColumns: `${sidebarWidth}px 5px minmax(390px, 1fr)` }
  const onSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + ev.clientX - startX))
      setSidebarWidth(newWidth)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const onSidebarDoubleClick = () => { setSidebarWidth(DEFAULT_SIDEBAR_WIDTH) }
  const onPanelResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, startWidth - (ev.clientX - startX)))
      setPanelWidth(newWidth)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const onPanelDoubleClick = () => { setPanelWidth(DEFAULT_PANEL_WIDTH) }
  const gitChanges = workbench.git.changes
  const gitSummary = gitChanges.length
    ? `${gitChanges.length} ${gitChanges.length === 1 ? 'change' : 'changes'}`
    : 'Clean'
  const statusMetrics = useMemo(() => deriveStatusMetrics(conversation), [conversation])
  return <main className="app-shell">
    <header className="titlebar"><div className="drag-space" aria-hidden="true"/><button className={`agent-status ${agent.state} no-drag`} onClick={() => agent.state !== 'ready' && void api.retryAgent()}><i/>{statusText(agent.state)}</button></header>
    <section className={`layout${workbench.panelOpen ? ' panel-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} style={layoutStyle}>
      <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
        <div className="sidebar-identity" aria-label="Narwhal"><img src="./assets/narwhal-icon.png" alt=""/><div><span className="sidebar-product-name">Narwhal</span><span className="sidebar-product-subtitle">Based on DeepSeek Harness</span></div><button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}><Icon name="panel" size={17}/></button></div>
        <SideBar collapsed={sidebarCollapsed} workbench={workbench} sessions={conversation.sessions} selectedSessionId={conversation.selectedSessionId} choose={() => void mutate(() => api.chooseWorkspace())} selectWorkspace={(id) => void mutate(() => api.selectWorkspace(id))} createSession={(workspaceId) => void createSession(workspaceId)} selectSession={(workspaceId, sessionId) => void selectSessionForWorkspace(workspaceId, sessionId)} renameWorkspace={(id, name) => void mutate(() => api.renameWorkspace({ workspaceId: id, name }))} deleteWorkspace={(id) => void mutate(() => api.deleteWorkspace(id))}/>
        <div className="side-foot"><button onClick={() => setSettingsOpen(true)}><Icon name="settings"/><span>Settings</span></button></div>
      </aside>
      {!sidebarCollapsed && <div className="sidebar-resizer" onMouseDown={onSidebarResizeStart} onDoubleClick={onSidebarDoubleClick} title="Drag to resize · Double-click to reset"/>}
      <section className="agent-area">
        {error && <div className="notice"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
        {!workspace ? <EmptyWorkspace open={() => void mutate(api.chooseWorkspace)}/> : agent.state !== 'ready' ? <AgentLoading state={agent.state} retry={() => void api.retryAgent()}/> : !conversation.selectedSessionId ? <EmptyConversation create={() => void agentCall(api.createSession)}/> : <NativeConversation conversation={conversation} configuration={configuration} selectModel={selectModel} selectPermission={selectPermission} trajectoryOpen={trajectoryOpen} setTrajectoryOpen={setTrajectoryOpen} send={(text, attachments) => agentCall(() => api.sendPrompt(text, attachments))} cancel={() => void api.cancelPrompt().catch(() => setError('The Agent could not stop this turn.'))} workbench={workbench} selectWorkspace={(id) => void mutate(() => api.selectWorkspace(id))} chooseWorkspace={() => void mutate(() => api.chooseWorkspace())} mode={mode} setMode={setMode} conversationTitle={selectedConversation?.title ?? ''} onOpenSettings={() => setSettingsOpen(true)}/>} 
        <footer className="statusbar">
          <div className="statusbar-context">
            <span className="statusbar-workspace" title={workspace?.displayPath ?? workspace?.name}><Icon name="folder"/>{workspace?.name ?? 'No workspace'}</span>
            <span className={`statusbar-git${workbench.git.branch ? '' : ' unavailable'}`} title={workbench.git.branch ? `${workbench.git.branch} · ${gitSummary}` : 'No Git repository'}><Icon name="branch"/>{workbench.git.branch ?? 'No Git repository'}{workbench.git.branch && <small>{gitSummary}</small>}</span>
          </div>
          <div className="statusbar-metrics-scroll" aria-label="Run metrics">
            <span className="usage-metrics">
              <strong>{statusMetrics.turns}</strong> turns<em/>{statusMetrics.steps} steps<em/>LLM <strong>{formatOptionalLatency(statusMetrics.llmLatency)}</strong><em/>TTFT avg <strong>{formatOptionalLatency(statusMetrics.ttftAvg)}</strong><em/><strong>{statusMetrics.tokenThroughput ?? '—'}</strong> tok/s<em/>Cache hit <strong>{statusMetrics.cacheHitRate === undefined ? '—' : `${statusMetrics.cacheHitRate}%`}</strong><em/>Input <strong>{formatOptionalTokens(statusMetrics.inputTokens)} tok</strong><em/>Output <strong>{formatOptionalTokens(statusMetrics.outputTokens)} tok</strong>
            </span>
          </div>
        </footer>
      </section>
      {workbench.panelOpen && <div className="panel-resizer" onMouseDown={onPanelResizeStart} onDoubleClick={onPanelDoubleClick} title="Drag to resize · Double-click to reset"/>} 
      {workbench.panelOpen && <aside className="context-panel open" style={{ width: panelWidth }}><div className="panel-head"><div><p>Work context</p><h2>{selectedConversation?.title ?? 'No conversation selected'}</h2></div><button title="Close panel" onClick={() => void mutate(() => api.setPanelOpen(false))}><Icon name="close"/></button></div>{!workspace ? <p className="panel-empty">Choose a workspace to keep its plan, changed files and deliverables together.</p> : <><ConversationSection conversation={selectedConversation} onSelect={(conversationId) => void mutate(() => api.selectConversation(conversationId))} onNew={() => void mutate(() => api.createConversation({ title: 'New conversation', goal: '' }))} onUpdate={(input) => void mutate(() => api.updateConversation(input))} onTodo={(conversationId, todoId, done) => void mutate(() => api.toggleTodo({ conversationId, todoId, done }))} onAddTodo={(conversationId, text) => void mutate(() => api.addTodo({ conversationId, text }))}/><ChangesSection changes={workbench.git.changes}/><DeliverablesSection entries={workbench.deliverables} onNew={() => setDeliverableDraft(true)} onReveal={(path) => void api.revealDeliverable(path)} onRemove={(path) => void mutate(() => api.unpinDeliverable(path))}/></>}</aside>}
    </section>
    {workbench.panelOpen && <button className="drawer-backdrop" aria-label="Close work context" onClick={() => void mutate(() => api.setPanelOpen(false))}/>} 
    <button className={`panel-trigger${workbench.panelOpen ? ' open' : ''}`} style={workbench.panelOpen ? { right: panelWidth + 11 } : undefined} onClick={() => void mutate(() => api.setPanelOpen(!workbench.panelOpen))} aria-label="Toggle work context"><Icon name="panel"/></button>
    {deliverableDraft && <DeliverableDialog close={() => setDeliverableDraft(false)} save={(relativePath, label) => mutate(() => api.pinDeliverable({ relativePath, label })).then(() => setDeliverableDraft(false))}/>} 
    {settingsOpen && <SettingsDialog settings={settings} agent={agent} theme={theme} setTheme={setTheme} close={() => setSettingsOpen(false)} restart={() => void api.retryAgent()}/>} 
  </main>
}

const CONVERSATIONS_PER_PAGE = 5
type GroupBy = 'workspace' | 'flat'
type OrderBy = 'manual' | 'lastUpdated'

function SideBar({ collapsed, workbench, sessions, selectedSessionId, choose, selectWorkspace, createSession, selectSession, renameWorkspace, deleteWorkspace }: { collapsed: boolean; workbench: WorkbenchSnapshot; sessions: AgentConversation['sessions']; selectedSessionId?: string; choose: () => void; selectWorkspace: (id: string) => void; createSession: (workspaceId: string) => void; selectSession: (workspaceId: string, sessionId: string) => void; renameWorkspace: (id: string, name: string) => void; deleteWorkspace: (id: string) => void }) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({})
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('workspace')
  const [orderBy, setOrderBy] = useState<OrderBy>('lastUpdated')

  // --- Collapsed (icon-only) view ---
  if (collapsed) {
    return (
      <>
        <div className="collapsed-workspaces">
          {workbench.workspaces.map((item) => {
            const rawName = item.name || '?'
            const letterMatch = rawName.match(/[A-Za-z\u4e00-\u9fff]/)
            const initial = letterMatch ? letterMatch[0].toUpperCase() : rawName.charAt(0).toUpperCase()
            const active = item.id === workbench.selectedWorkspaceId
            return (
              <button
                key={item.id}
                className={`collapsed-ws-avatar${active ? ' active' : ''}`}
                title={`${item.name}${item.displayPath ? `\n${item.displayPath}` : ''}`}
                aria-label={`Open workspace ${item.name}`}
                onClick={() => selectWorkspace(item.id)}
              >{initial}</button>
            )
          })}
          <button className="collapsed-ws-avatar collapsed-ws-add" title="New workspace" aria-label="New workspace" onClick={choose}>
            <Icon name="folder-plus" size={14}/>
          </button>
        </div>
      </>
    )
  }

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces((prev) => ({ ...prev, [id]: !(prev[id] ?? id === workbench.selectedWorkspaceId) }))
    setVisibleCounts((prev) => ({ ...prev, [id]: prev[id] ?? CONVERSATIONS_PER_PAGE }))
  }
  const isExpanded = (id: string) => expandedWorkspaces[id] ?? id === workbench.selectedWorkspaceId
  const getVisibleCount = (id: string) => visibleCounts[id] ?? CONVERSATIONS_PER_PAGE
  const loadMore = (id: string) => {
    const workspace = workbench.workspaces.find((item) => item.id === id)
    const sessionCount = workspace ? sessions.filter((session) => session.cwd === workspace.displayPath).length : 0
    setVisibleCounts((prev) => ({ ...prev, [id]: Math.min((prev[id] ?? CONVERSATIONS_PER_PAGE) + CONVERSATIONS_PER_PAGE, sessionCount) }))
  }
  const sortSessions = (items: AgentConversation['sessions']) => {
    if (orderBy === 'lastUpdated') return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
    return items
  }

  // Filter menu popup
  const FilterMenu = () => filterMenuOpen ? (
    <>
      <div className="menu-overlay" onClick={() => { setFilterMenuOpen(false) }}/>
      <div className="menu-popup" onClick={(e) => e.stopPropagation()}>
        <div className="menu-section">
          <div className="menu-section-title">Group by</div>
          <button className={`menu-item${groupBy === 'workspace' ? ' active' : ''}`} onClick={() => { setGroupBy('workspace'); setFilterMenuOpen(false) }}>
            WorkSpace {groupBy === 'workspace' && <span className="menu-check">✓</span>}
          </button>
          <button className={`menu-item${groupBy === 'flat' ? ' active' : ''}`} onClick={() => { setGroupBy('flat'); setFilterMenuOpen(false) }}>
            In one list {groupBy === 'flat' && <span className="menu-check">✓</span>}
          </button>
        </div>
        <div className="menu-divider"/>
        <div className="menu-section">
          <div className="menu-section-title">Order by</div>
          <button className={`menu-item${orderBy === 'manual' ? ' active' : ''}`} onClick={() => { setOrderBy('manual'); setFilterMenuOpen(false) }}>
            Manual {orderBy === 'manual' && <span className="menu-check">✓</span>}
          </button>
          <button className={`menu-item${orderBy === 'lastUpdated' ? ' active' : ''}`} onClick={() => { setOrderBy('lastUpdated'); setFilterMenuOpen(false) }}>
            Last updated {orderBy === 'lastUpdated' && <span className="menu-check">✓</span>}
          </button>
        </div>
      </div>
    </>
  ) : null

  return <>
    {/* Workspaces/Sessions section */}
    <div className="side-section">
      <div className="section-heading filter-heading">
        <span>{groupBy === 'flat' ? 'Sessions' : 'Workspaces'}</span>
        <div className="section-heading-actions">
          <button className="heading-icon" aria-label="Search" title="Search"><Icon name="search"/></button>
          <button className={`heading-icon${filterMenuOpen ? ' active' : ''}`} aria-label="Filter" title="Filter / Sort" onClick={() => setFilterMenuOpen(!filterMenuOpen)}><Icon name="sliders"/></button>
          <button className="heading-icon" aria-label="New workspace" title="New workspace" onClick={choose}><Icon name="folder-plus"/></button>
        </div>
        <FilterMenu/>
      </div>
      <div className="workspace-list">
        {workbench.workspaces.length ? (
          groupBy === 'workspace' ? workbench.workspaces.map((item) => {
            const allConvs = sortSessions(sessions.filter((session) => session.cwd === item.displayPath))
            const expanded = isExpanded(item.id)
            const visibleCount = getVisibleCount(item.id)
            const visibleConvs = allConvs.slice(0, visibleCount)
            const hasMore = visibleCount < allConvs.length
            const isMenuOpen = workspaceMenuOpen === item.id
            const isRenaming = renamingId === item.id
            return (
              <div key={item.id} className="workspace-group">
                <div
                  className={item.id === workbench.selectedWorkspaceId ? 'workspace-row active' : 'workspace-row'}
                  onClick={() => { if (!isRenaming) { toggleWorkspace(item.id); selectWorkspace(item.id) } }}
                >
                  <span className={`workspace-chevron${expanded ? ' expanded' : ''}`} onClick={(e) => { e.stopPropagation(); toggleWorkspace(item.id) }}>
                    <Icon name="chevron" size={12}/>
                  </span>
                  <Icon name="folder" size={14}/>
                  {isRenaming ? (
                    <input
                      className="workspace-rename-input"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); if (renameValue.trim()) { renameWorkspace(item.id, renameValue.trim()); setRenamingId(null); setRenameValue('') } }
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                      }}
                      onBlur={() => { if (renameValue.trim()) { renameWorkspace(item.id, renameValue.trim()) } setRenamingId(null); setRenameValue('') }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="workspace-name">{item.name}</span>
                  )}
                  <div className="workspace-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`heading-icon workspace-action-btn${isMenuOpen ? ' active' : ''}`}
                      aria-label="Workspace options"
                      title="Workspace options"
                      onClick={() => setWorkspaceMenuOpen(isMenuOpen ? null : item.id)}
                    >
                      <Icon name="more" size={14}/>
                    </button>
                    <button
                      className="heading-icon workspace-action-btn"
                      aria-label="New session"
                      title="New session"
                      onClick={() => createSession(item.id)}
                    >
                      <Icon name="plus" size={14}/>
                    </button>
                  </div>
                  {isMenuOpen && (
                    <>
                      <div className="menu-overlay" onClick={() => setWorkspaceMenuOpen(null)}/>
                      <div className="menu-popup workspace-menu" onClick={(e) => e.stopPropagation()}>
                        <div className="menu-section">
                          <button className="menu-item" onClick={() => { setWorkspaceMenuOpen(null); setRenamingId(item.id); setRenameValue(item.name) }}>
                            <Icon name="pencil" size={14}/> Rename
                          </button>
                          <button className="menu-item danger" onClick={() => { setWorkspaceMenuOpen(null); if (window.confirm(`Delete workspace "${item.name}"? This also removes all its sessions.`)) { deleteWorkspace(item.id) } }}>
                            <Icon name="trash" size={14}/> Delete workspace
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {expanded && (
                  <div className="workspace-conversations">
                    {allConvs.length ? visibleConvs.map((conv) => (
                      <button
                        key={conv.id}
                        className={conv.id === selectedSessionId ? 'session active' : 'session'}
                        onClick={() => selectSession(item.id, conv.id)}
                      >
                        <span className="session-title">{conv.title}</span>
                        <small>{formatRelativeTime(conv.updatedAt)}</small>
                      </button>
                    )) : <p className="empty-side">No sessions yet.</p>}
                    {hasMore && (
                      <button className="load-more" onClick={(e) => { e.stopPropagation(); loadMore(item.id) }}>
                        Load more ({allConvs.length - visibleCount})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          }) : (
            // Flat list view - matching DSH native
            <>
              <div className="side-section top-section">
                <button className="btn-new-session" onClick={() => {
                  if (workbench.selectedWorkspaceId) createSession(workbench.selectedWorkspaceId)
                }}>
                  <Icon name="plus" size={16}/>
                  <span>New Session</span>
                </button>
              </div>
              {sortSessions(sessions).slice(0, CONVERSATIONS_PER_PAGE).map((conv) => {
                const workspace = workbench.workspaces.find((item) => item.displayPath === conv.cwd)
                return (
                <button
                  key={conv.id}
                  className={conv.id === selectedSessionId ? 'session active' : 'session'}
                  disabled={!workspace}
                  onClick={() => { if (workspace) selectSession(workspace.id, conv.id) }}
                >
                  <span className="session-title">{conv.title}</span>
                  <small>{formatRelativeTime(conv.updatedAt)}</small>
                </button>
                )
              })}
              {sessions.length > CONVERSATIONS_PER_PAGE && (
                <button className="load-more">Load more</button>
              )}
            </>
          )
        ) : <p className="empty-side">Open a local folder to begin.</p>}
      </div>
    </div>
  </>
}
function NativeConversation({ conversation, configuration, selectModel, selectPermission, trajectoryOpen, setTrajectoryOpen, send, cancel, workbench, selectWorkspace, chooseWorkspace, mode, setMode, conversationTitle, subagentsCount = 0, onOpenSettings }: { conversation: AgentConversation; configuration: AgentConfiguration; selectModel: (input: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>; selectPermission: (preset: string) => Promise<void>; trajectoryOpen: boolean; setTrajectoryOpen: (value: boolean) => void; send: (text: string, attachments?: readonly Attachment[]) => void; cancel: () => void; workbench: WorkbenchSnapshot; selectWorkspace: (id: string) => void; chooseWorkspace: () => void; mode: AgentMode; setMode: (mode: AgentMode) => void; conversationTitle: string; subagentsCount?: number; onOpenSettings?: () => void }) {
  const trajectoryData = useMemo(() => buildTrajectoryData(conversation.trajectory), [conversation.trajectory])
  const [duration, setDuration] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<number | null>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [subagentsMenuOpen, setSubagentsMenuOpen] = useState(false)
  const selectedRecordData = useMemo(() => {
    if (selectedRecord === null) return null
    for (const turn of trajectoryData.turns) {
      const found = turn.records.find((r) => r.index === selectedRecord)
      if (found) return found
    }
    return null
  }, [selectedRecord, trajectoryData])
  const timeline = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  useEffect(() => {
    if (conversation.running) followOutput.current = true
    const element = timeline.current
    if (element && followOutput.current) element.scrollTo({ top: element.scrollHeight, behavior: conversation.running ? 'auto' : 'smooth' })
  }, [trajectoryOpen, conversation.running, trajectoryData])
  const trackScroll = () => {
    const element = timeline.current
    if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
  }
  const turnCount = trajectoryData.turns.length
  const callCount = trajectoryData.kindCounts.tool + trajectoryData.kindCounts.subtool
  const currentWorkspace = workbench.workspaces.find((w) => w.id === workbench.selectedWorkspaceId)
  const hasMessages = conversation.messages.length > 0
  const chatContent = hasMessages
    ? conversation.messages.map((item) => <TimelineItem key={item.id} item={item} trajectory={false}/>)
    : null
  const trajectoryContent = (
    <div className="trajectory-view-root">
      <TrajectoryToolbar duration={duration} onDurationChange={setDuration} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} turnCount={turnCount} callCount={callCount}/>
      <TrajectoryTimeline spans={trajectoryData.spans} selectedIndex={selectedRecord} onSelect={setSelectedRecord}/>
      <div className="trajectory-main">
        {trajectoryData.turns.length ? (
          <TrajectoryTable turns={trajectoryData.turns} selectedIndex={selectedRecord} onSelect={setSelectedRecord} searchQuery={searchQuery}/>
        ) : (
          <div className="trajectory-empty"><img src="./assets/narwhal-icon.png"/><h2>Trajectory will appear here.</h2><p>Agent execution events — turns, tool calls, context updates — appear here as they happen.</p></div>
        )}
      </div>
      {selectedRecordData && <TrajectoryInspector record={selectedRecordData} onClose={() => setSelectedRecord(null)}/>}
    </div>
  )
  const isEmptyChat = !trajectoryOpen && !hasMessages
  return (
    <div className={`native-conversation${isEmptyChat ? ' empty-chat' : ''}`}>
      <div className="conversation-head">
        <div className="conversation-head-left">
          {conversationTitle && <span className="conversation-title">{conversationTitle}</span>}
          <div className="conversation-selectors">
            {/* Workspace selector pill */}
            <div className="selector-pill-wrapper">
              <button
                className="selector-pill"
                onClick={() => { setWorkspaceMenuOpen(!workspaceMenuOpen); setModeMenuOpen(false); setSubagentsMenuOpen(false) }}
                title={currentWorkspace?.displayPath ?? 'Select workspace'}
              >
                <Icon name="folder" size={14}/>
                <span className="selector-pill-label">{currentWorkspace?.name ?? 'No workspace'}</span>
                <Icon name="chevron" size={10}/>
              </button>
              {workspaceMenuOpen && (
                <>
                  <div className="menu-overlay" onClick={() => setWorkspaceMenuOpen(false)}/>
                  <div className="menu-popup selector-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="menu-section">
                      {workbench.workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          className={`menu-item ${ws.id === workbench.selectedWorkspaceId ? 'active' : ''}`}
                          onClick={() => { selectWorkspace(ws.id); setWorkspaceMenuOpen(false) }}
                        >
                          <span className="selector-item-icon"><Icon name="folder" size={14}/></span>
                          <span className="selector-item-label">{ws.name}</span>
                          {ws.id === workbench.selectedWorkspaceId && <span className="menu-check">✓</span>}
                        </button>
                      ))}
                    </div>
                    <div className="menu-divider"/>
                    <div className="menu-section">
                      <button className="menu-item" onClick={() => { setWorkspaceMenuOpen(false); chooseWorkspace() }}>
                        <span className="selector-item-icon"><Icon name="plus" size={14}/></span>
                        <span className="selector-item-label">Add workspace…</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Mode selector pill */}
            <div className="selector-pill-wrapper">
              <button
                className="selector-pill"
                onClick={() => { setModeMenuOpen(!modeMenuOpen); setWorkspaceMenuOpen(false); setSubagentsMenuOpen(false) }}
              >
                <Icon name="robot" size={14}/>
                <span className="selector-pill-label">{AGENT_MODES[mode].name}</span>
                <Icon name="chevron" size={10}/>
              </button>
              {modeMenuOpen && (
                <>
                  <div className="menu-overlay" onClick={() => setModeMenuOpen(false)}/>
                  <div className="menu-popup selector-menu mode-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="menu-section">
                      {(Object.entries(AGENT_MODES) as [AgentMode, { name: string; description: string }][]).map(([key, value]) => (
                        <button
                          key={key}
                          className={`menu-item mode-item ${mode === key ? 'active' : ''}`}
                          onClick={() => { setMode(key); setModeMenuOpen(false) }}
                        >
                          <div className="mode-item-content">
                            <span className="mode-item-name">{value.name}</span>
                            <span className="mode-item-desc">{value.description}</span>
                          </div>
                          {mode === key && <span className="menu-check">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Subagents pill */}
            <div className="selector-pill-wrapper">
              <button
                className="selector-pill"
                onClick={() => { setSubagentsMenuOpen(!subagentsMenuOpen); setWorkspaceMenuOpen(false); setModeMenuOpen(false) }}
                title="Manage subagents"
              >
                <Icon name="robot" size={14}/>
                <span className="selector-pill-label">{subagentsCount} subagent{subagentsCount !== 1 ? 's' : ''}</span>
                <Icon name="chevron" size={10}/>
              </button>
              {subagentsMenuOpen && (
                <>
                  <div className="menu-overlay" onClick={() => setSubagentsMenuOpen(false)}/>
                  <div className="menu-popup selector-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="menu-section">
                      <div className="subagents-empty">
                        <span className="subagents-count">{subagentsCount}</span>
                        <span>active subagent{subagentsCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="menu-divider"/>
                    <div className="menu-section">
                      <button className="menu-item" onClick={() => setSubagentsMenuOpen(false)}>
                        <span className="selector-item-icon"><Icon name="plus" size={14}/></span>
                        <span className="selector-item-label">Create subagent…</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="segmented">
          <button className={!trajectoryOpen ? 'active' : ''} onClick={() => setTrajectoryOpen(false)}>Chat</button>
          <button className={trajectoryOpen ? 'active' : ''} onClick={() => setTrajectoryOpen(true)}>Trajectory</button>
        </div>
      </div>
      {trajectoryOpen ? (
        <div className="timeline trajectory-view" ref={timeline} onScroll={trackScroll}>
          {trajectoryContent}
        </div>
      ) : isEmptyChat ? (
        <div className="empty-chat-container">
          <div className="empty-chat-header">
            <img src="./assets/narwhal-icon.png" alt="Narwhal" className="empty-chat-icon"/>
          </div>
          <Composer
            running={conversation.running}
            configuration={configuration}
            hasSession={!!conversation.selectedSessionId}
            selectModel={selectModel}
            selectPermission={selectPermission}
            send={send}
            cancel={cancel}
            centered
            onOpenSettings={onOpenSettings}
          />
        </div>
      ) : (
        <>
          <div className="timeline" ref={timeline} onScroll={trackScroll}>
            {chatContent}
          </div>
          <Composer
            running={conversation.running}
            configuration={configuration}
            hasSession={!!conversation.selectedSessionId}
            selectModel={selectModel}
            selectPermission={selectPermission}
            send={send}
            cancel={cancel}
            onOpenSettings={onOpenSettings}
          />
        </>
      )}
    </div>
  )
}
function normalizeTrajectory(item: ChatItem) {
  const descriptor = classifyTrajectory(
    item.kind === 'error' ? 'error' : 'trajectory',
    item.label,
    item.text,
    item.kind,
  )
  return {
    label: descriptor.label,
    text: descriptor.text,
    type: descriptor.type as IconName,
    hidden: descriptor.hidden,
  }
}
function trajectoryPhases(_items: readonly ChatItem[]) { return [] }
function AttachmentList({ attachments }: { attachments: readonly Attachment[] }) {
  if (!attachments.length) return null
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 * 1024).toFixed(1)} MB`
  }
  return (
    <div className="message-attachments">
      {attachments.map((att) => (
        <div key={att.id} className="attachment-item">
          {att.type.startsWith('image/') && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="attachment-item-thumb" />
          ) : (
            <span className="attachment-item-icon">
              <Icon name="file" size={16}/>
            </span>
          )}
          <div className="attachment-item-info">
            <span className="attachment-item-name" title={att.name}>{att.name}</span>
            <span className="attachment-item-size">{formatSize(att.size)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
function TimelineItem({ item, trajectory }: { item: ChatItem; trajectory: boolean }) {
  if (trajectory || item.kind === 'trajectory' || item.kind === 'error') {
    const event = normalizeTrajectory(item)
    return (
      <article className={`trajectory-row ${event.type}`}>
        <span className="trajectory-mark"><Icon name={event.type}/></span>
        <div><strong>{event.label}</strong><p>{event.text}</p></div>
      </article>
    )
  }
  return (
    <article className={`message ${item.kind}`}>
      <p className="message-label">
        {item.kind === 'user' ? 'You' : 'Narwhal Agent'}
        {item.streaming && <span className="streaming">Writing</span>}
      </p>
      {item.attachments && item.attachments.length > 0 && <AttachmentList attachments={item.attachments} />}
      <div className="message-body"><MarkdownMessage content={item.text}/></div>
    </article>
  )
}
function Composer({ running, configuration, hasSession, selectModel, selectPermission, send, cancel, centered, onOpenSettings }: { running: boolean; configuration: AgentConfiguration; hasSession: boolean; selectModel: (input: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>; selectPermission: (preset: string) => Promise<void>; send: (text: string, attachments?: readonly Attachment[]) => void; cancel: () => void; centered?: boolean; onOpenSettings?: () => void }) {
  const [text, setText] = useState('')
  const [permMenuOpen, setPermMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const [fallbackEffort, setFallbackEffort] = useState<string | undefined>(undefined)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [commands, setCommands] = useState<readonly Command[]>([])
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [keyBannerDismissed, setKeyBannerDismissed] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const permissionTrigger = useRef<HTMLButtonElement>(null)
  const modelTrigger = useRef<HTMLButtonElement>(null)
  const effortTrigger = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Determine if current provider has API key configured
  const currentProvider = useMemo(() => {
    const pid = configuration.selectedModel?.provider
    if (!pid) return configuration.providers.find((p) => p.active)
    return configuration.providers.find((p) => p.id === pid) ?? configuration.providers.find((p) => p.active)
  }, [configuration])
  const needsApiKey = !running && !!hasSession && !!currentProvider?.active && !currentProvider.apiKeyConfigured

  // Load command list whenever slash menu opens
  useEffect(() => {
    if (!commandOpen) return
    let cancelled = false
    void api.listCommands().then((list) => { if (!cancelled) setCommands(list) }).catch(() => { if (!cancelled) setCommands([]) })
    return () => { cancelled = true }
  }, [commandOpen])

  useEffect(() => {
    // Reset index when filter changes
    setCommandIndex(0)
  }, [commandOpen, text])

  useEffect(() => {
    if (running) { setText(''); setAttachments([]); setCommandOpen(false); input.current?.blur() }
  }, [running])

  useEffect(() => {
    if (!permMenuOpen && !modelMenuOpen && !effortMenuOpen) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (effortMenuOpen) { setEffortMenuOpen(false); requestAnimationFrame(() => effortTrigger.current?.focus()) }
      else if (modelMenuOpen) { setModelMenuOpen(false); requestAnimationFrame(() => modelTrigger.current?.focus()) }
      else { setPermMenuOpen(false); requestAnimationFrame(() => permissionTrigger.current?.focus()) }
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => document.removeEventListener('keydown', dismissOnEscape)
  }, [permMenuOpen, modelMenuOpen, effortMenuOpen])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const newAttachments: Attachment[] = []
    let remaining = files.length

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        newAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          dataUrl: e.target?.result as string | undefined,
        })
        remaining--
        if (remaining === 0) {
          setAttachments((prev) => [...prev, ...newAttachments])
        }
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 * 1024).toFixed(1)} MB`
  }

  // Slash command helpers: find the current "/" word before caret, or null
  const getSlashContext = (value: string, caret: number): { word: string; start: number } | null => {
    const beforeCaret = value.slice(0, caret)
    const match = beforeCaret.match(/(?:^|\s)(\/[A-Za-z0-9_-]{0,40})$/)
    if (!match) return null
    // match.index is position of leading (space or start); actual slash word starts right after
    const start = (match.index ?? 0) + (match[1].startsWith('/') ? 0 : match[0].length - match[1].length)
    return { word: match[1], start }
  }

  const slashContext = getSlashContext(text, input.current?.selectionStart ?? text.length)
  const filteredCommands = useMemo(() => {
    if (!slashContext) return []
    const filter = slashContext.word.slice(1).toLowerCase() // without leading "/"
    if (!filter) return commands
    return commands.filter((c) => c.name.toLowerCase().startsWith(filter) || c.description.toLowerCase().includes(filter)).slice(0, 12)
  }, [commands, slashContext])

  const acceptCommand = (cmd: Command) => {
    if (!slashContext) return
    const before = text.slice(0, slashContext.start)
    const after = text.slice(input.current?.selectionStart ?? text.length)
    const replacement = `/${cmd.name}`
    const newText = before + replacement + ' ' + after
    setText(newText)
    setCommandOpen(false)
    // Position caret right after the command name + space
    requestAnimationFrame(() => {
      const pos = slashContext.start + replacement.length + 1
      input.current?.setSelectionRange(pos, pos)
      input.current?.focus()
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message || running) return
    // If the message is a slash command, execute it directly
    if (message.startsWith('/')) {
      setText('')
      setCommandOpen(false)
      try { await api.executeCommand(message) } catch { /* error surfaced via event stream */ }
      return
    }
    // Preflight: block prompt if current provider has no API key configured
    if (needsApiKey) {
      setKeyBannerDismissed(false)
      return
    }
    setText('')
    send(message, attachments.length > 0 ? attachments : undefined)
    setAttachments([])
  }

  const permissionValue = configuration.permissionOptions.some((option) => option.id === configuration.defaultPermission)
    ? configuration.defaultPermission ?? ''
    : configuration.permissionOptions[0]?.id ?? ''
  const currentPermission = configuration.permissionOptions.find((o) => o.id === permissionValue)
  const modelPickerDisabled = !hasSession || running || !configuration.available

  // Get current model info
  const groups = configuration.models
  const selected = configuration.selectedModel
  const provider = groups.find((item) => item.id === selected?.provider) ?? groups.find((item) => item.models.length > 0)
  const model = provider?.models.find((item) => item.id === selected?.model) ?? provider?.models[0]
  const isFallbackEfforts = !!model && !model.effortsNative
  const effort = isFallbackEfforts
    ? (fallbackEffort ?? model?.defaultEffort ?? model?.efforts[0]?.id ?? '')
    : (model?.efforts.some((item) => item.id === selected?.reasoningEffort)
      ? selected?.reasoningEffort ?? ''
      : model?.defaultEffort ?? model?.efforts[0]?.id ?? '')
  const currentEffort = model?.efforts.find((e) => e.id === effort)

  const handleModelSelect = (providerId: string, modelId: string, modelEffort?: string) => {
    const selectedGroup = groups.find((g) => g.id === providerId)
    const selectedModelData = selectedGroup?.models.find((m) => m.id === modelId)
    const supportsNativeEfforts = !!selectedModelData?.effortsNative
    void selectModel({ provider: providerId, model: modelId, ...(supportsNativeEfforts && modelEffort ? { reasoningEffort: modelEffort } : {}) })
    // Reset fallback effort state when switching models
    setFallbackEffort(undefined)
    setModelMenuOpen(false)
  }
  

  const composerClass = `composer${centered ? ' composer-centered' : ''}`

  return (
    <>
    {needsApiKey && !keyBannerDismissed && (
      <div className="missing-key-banner">
        <div className="missing-key-banner-inner">
          <Icon name="settings"/>
          <span>
            <strong>API key required</strong>
            <small>{currentProvider?.name} doesn't have an API key configured yet.</small>
          </span>
        </div>
        <div className="missing-key-banner-actions">
          {onOpenSettings && <button type="button" className="btn-primary" onClick={onOpenSettings}>Configure</button>}
          <button type="button" className="btn-ghost" onClick={() => setKeyBannerDismissed(true)} aria-label="Dismiss">
            <Icon name="close"/>
          </button>
        </div>
      </div>
    )}
    <form className={composerClass} onSubmit={submit}>
      <input
        ref={fileInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((att) => (
            <div key={att.id} className="attachment-chip">
              {att.type.startsWith('image/') && att.dataUrl ? (
                <img src={att.dataUrl} alt={att.name} className="attachment-thumb" />
              ) : (
                <span className="attachment-icon">
                  <Icon name="file" size={14}/>
                </span>
              )}
              <div className="attachment-info">
                <span className="attachment-name" title={att.name}>{att.name}</span>
                <span className="attachment-size">{formatFileSize(att.size)}</span>
              </div>
              <button
                type="button"
                className="attachment-remove"
                onClick={() => removeAttachment(att.id)}
                aria-label={`Remove ${att.name}`}
              >
                <Icon name="close" size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        value={text}
        onChange={(event) => {
          const next = event.target.value
          const caret = event.target.selectionStart
          setText(next)
          // Toggle command menu based on whether caret is inside a "/" word
          const ctx = getSlashContext(next, caret)
          if (ctx) setCommandOpen(true)
          else setCommandOpen(false)
        }}
        placeholder={running ? 'The Agent is working…' : needsApiKey ? `Configure an API key for ${currentProvider?.name ?? 'this provider'} first →` : hasSession ? 'Describe what you want to build' : 'Select or create a conversation first'}
        disabled={running || needsApiKey}
        rows={centered ? 4 : 2}
        onKeyDown={(event) => {
          const open = commandOpen && filteredCommands.length > 0
          if (event.key === 'Escape') { if (open) { event.preventDefault(); setCommandOpen(false) }; return }
          if (open) {
            if (event.key === 'ArrowDown') { event.preventDefault(); setCommandIndex((i) => (i + 1) % Math.max(filteredCommands.length, 1)); return }
            if (event.key === 'ArrowUp') { event.preventDefault(); setCommandIndex((i) => (i - 1 + Math.max(filteredCommands.length, 1)) % Math.max(filteredCommands.length, 1)); return }
            if (event.key === 'Tab' || event.key === 'Enter') {
              event.preventDefault()
              const picked = filteredCommands[commandIndex]
              if (picked) acceptCommand(picked)
              return
            }
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      {commandOpen && filteredCommands.length > 0 && (
        <div className="command-popup" role="listbox" aria-label="Slash commands">
          <div className="command-popup-title">Commands</div>
          {filteredCommands.map((cmd, idx) => (
            <button
              type="button"
              key={cmd.name}
              role="option"
              aria-selected={idx === commandIndex}
              className={`command-item ${idx === commandIndex ? 'active' : ''}`}
              onMouseEnter={() => setCommandIndex(idx)}
              onClick={() => acceptCommand(cmd)}
            >
              <span className="command-item-name">/{cmd.name}</span>
              <span className="command-item-desc">{cmd.description}{cmd.input?.hint ? ` · ${cmd.input.hint}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-bottom-bar">
        <div className="composer-bar-left">
          <button
            type="button"
            className="composer-add-btn"
            title="Add attachment"
            aria-label="Add attachment"
            disabled={running}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="plus" size={16}/>
          </button>
          {/* Permission selector pill */}
          <div className="selector-pill-wrapper">
            <button
              ref={permissionTrigger}
              type="button"
              className="selector-pill composer-permission-pill"
              disabled={!configuration.available || running || !configuration.permissionOptions.length}
              onClick={() => { setPermMenuOpen(!permMenuOpen); setModelMenuOpen(false) }}
              title="Set default conversation permission"
              aria-haspopup="menu"
              aria-expanded={permMenuOpen}
              aria-controls="composer-permission-menu"
            >
              <Icon name="shield" size={13}/>
              <span className="selector-pill-label">{currentPermission?.label ?? 'Permission'}</span>
              <Icon name="chevron" size={10}/>
            </button>
            {permMenuOpen && configuration.available && configuration.permissionOptions.length > 0 && (
              <>
                <div className="menu-overlay" onClick={() => setPermMenuOpen(false)}/>
                <div id="composer-permission-menu" className="menu-popup selector-menu" role="menu" aria-label="Conversation permission" onClick={(e) => e.stopPropagation()}>
                  <div className="menu-section">
                    {configuration.permissionOptions.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        role="menuitemradio"
                        aria-checked={option.id === permissionValue}
                        className={`menu-item ${option.id === permissionValue ? 'active' : ''}`}
                        onClick={() => { void selectPermission(option.id); setPermMenuOpen(false) }}
                      >
                        <span className="selector-item-label">{option.label}</span>
                        {option.id === permissionValue && <span className="menu-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Model selector pill */}
          {configuration.available && provider && model ? (
            <div className="selector-pill-wrapper">
              <button
                ref={modelTrigger}
                type="button"
                className="selector-pill composer-model-pill"
                disabled={modelPickerDisabled}
                onClick={() => { setModelMenuOpen(!modelMenuOpen); setPermMenuOpen(false) }}
                title="Switch provider and model"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                aria-controls="composer-model-menu"
              >
                <span className="selector-pill-label">{model.name}</span>
                <Icon name="chevron" size={10}/>
              </button>
              {modelMenuOpen && (
                <>
                  <div className="menu-overlay" onClick={() => setModelMenuOpen(false)}/>
                  <div id="composer-model-menu" className="menu-popup selector-menu model-selector-menu" role="menu" aria-label="Model selection" onClick={(e) => e.stopPropagation()}>
                    <div className="menu-section">
                      {groups.map((group) => (
                        <div key={group.id} className="model-provider-group">
                          <div className="model-provider-title">{group.name}</div>
                          {group.models.map((m) => {
                            const isActive = group.id === provider?.id && m.id === model?.id
                            const defaultEffort = m.defaultEffort ?? m.efforts[0]?.id
                            return (
                              <div key={`${group.id}-${m.id}`} className="model-entry">
                                <button
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={isActive}
                                  className={`menu-item model-menu-item ${isActive ? 'active' : ''}`}
                                  onClick={() => handleModelSelect(group.id, m.id, defaultEffort)}
                                >
                                  <span className="selector-item-label">{m.name}</span>
                                  {isActive && <span className="menu-check">✓</span>}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : configuration.available ? (
            <span className="composer-model-empty">Model unavailable</span>
          ) : null}
          {/* Effort selector pill - shown when model has multiple efforts (native or fallback) */}
          {configuration.available && model && model.efforts.length > 1 && (
            <div className="selector-pill-wrapper">
              <button
                ref={effortTrigger}
                type="button"
                className="selector-pill composer-effort-pill"
                disabled={modelPickerDisabled}
                onClick={() => { setEffortMenuOpen(!effortMenuOpen); setModelMenuOpen(false); setPermMenuOpen(false) }}
                title="Adjust reasoning effort"
                aria-haspopup="menu"
                aria-expanded={effortMenuOpen}
                aria-controls="composer-effort-menu"
              >
                <span className="selector-pill-label">{currentEffort?.name ?? effort}</span>
                <Icon name="chevron" size={10}/>
              </button>
              {effortMenuOpen && (
                <>
                  <div className="menu-overlay" onClick={() => setEffortMenuOpen(false)}/>
                  <div id="composer-effort-menu" className="menu-popup selector-menu" role="menu" aria-label="Reasoning effort" onClick={(e) => e.stopPropagation()}>
                    <div className="menu-section">
                      {model.efforts.map((eff) => (
                        <button
                          type="button"
                          key={eff.id}
                          role="menuitemradio"
                          aria-checked={eff.id === effort}
                          className={`menu-item ${eff.id === effort ? 'active' : ''}`}
                          onClick={() => {
                            if (isFallbackEfforts) {
                              setFallbackEffort(eff.id)
                              setEffortMenuOpen(false)
                            } else {
                              void selectModel({ provider: provider?.id ?? '', model: model.id, reasoningEffort: eff.id })
                              setEffortMenuOpen(false)
                            }
                          }}
                        >
                          <span className="selector-item-label">{eff.name}</span>
                          {eff.id === effort && <span className="menu-check">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="composer-bar-right">
          {running ? (
            <button type="button" className="cancel-turn" onClick={cancel}>Stop</button>
          ) : (
            <button
              type="submit"
              className="send"
              disabled={(!text.trim() && attachments.length === 0) || !hasSession || needsApiKey}
              aria-label="Send message"
            >
              <Icon name="arrow"/>
            </button>
          )}
        </div>
      </div>
    </form>
    </>
  )
}
function EmptyWorkspace({ open }: { open: () => void }) { return <div className="empty-state"><img src="./assets/narwhal-icon.png"/><p className="eyebrow">Your local workspace</p><h1>Give your agent a place to work.</h1><p>Open a project folder. Narwhal keeps conversations and deliverables on this Mac, separate from your code.</p><button className="primary" onClick={open}><Icon name="folder-plus"/>Open workspace</button></div> }
function EmptyConversation({ create }: { create: () => void }) { return <div className="empty-state"><img src="./assets/narwhal-icon.png"/><p className="eyebrow">Ready when you are</p><h1>Start a local conversation.</h1><p>Narwhal will create an Agent session for this workspace. Your work context stays in this app.</p><button className="primary" onClick={create}><Icon name="plus"/>New conversation</button></div> }
function AgentLoading({ state, retry }: { state: AgentSnapshot['state']; retry: () => void }) { return <div className="empty-state loading"><div className="pulse-orb"/><p className="eyebrow">Local agent</p><h1>{state === 'needs-restart' ? 'The agent needs a restart.' : 'Preparing your local agent.'}</h1><p>{state === 'needs-restart' ? 'Your workspace is safe. Restart the local agent to continue.' : 'Starting the tools, skills, and session runtime on this Mac.'}</p>{state === 'needs-restart' && <button className="primary" onClick={retry}>Restart agent</button>}</div> }
function ConversationSection({ conversation, onSelect, onNew, onUpdate, onTodo, onAddTodo }: { conversation?: Conversation; onSelect: (id: string) => void; onNew: () => void; onUpdate: (input: { conversationId: string; title?: string; goal?: string; status?: 'active' | 'done' }) => void; onTodo: (conversationId: string, todoId: string, done: boolean) => void; onAddTodo: (conversationId: string, text: string) => void }) { const [editing, setEditing] = useState(false); const [step, setStep] = useState(''); const complete = conversation?.todos.filter((item) => item.done).length ?? 0; const total = conversation?.todos.length ?? 0; useEffect(() => setEditing(false), [conversation?.id]); if (!conversation) return <section className="panel-section"><div className="section-title"><span>Plan</span><button onClick={onNew}><Icon name="plus"/></button></div><button className="quiet-add" onClick={onNew}>Create the first conversation</button></section>; return <section className="panel-section"><div className="section-title"><span>Plan</span><span><button title="Edit conversation" onClick={() => setEditing(!editing)}><Icon name="settings"/></button><button onClick={onNew}><Icon name="plus"/></button></span></div>{editing ? <div className="task-edit"><input defaultValue={conversation.title} aria-label="Conversation title" onBlur={(event) => event.target.value.trim() && onUpdate({ conversationId: conversation.id, title: event.target.value })}/><textarea defaultValue={conversation.goal} aria-label="Conversation goal" onBlur={(event) => event.target.value.trim() && onUpdate({ conversationId: conversation.id, goal: event.target.value })}/><label><input type="checkbox" checked={conversation.status === 'done'} onChange={(event) => onUpdate({ conversationId: conversation.id, status: event.target.checked ? 'done' : 'active' })}/>Mark conversation complete</label></div> : <button className="task-choice" onClick={() => onSelect(conversation.id)}>{conversation.goal}</button>}<div className="progress"><span style={{ width: `${total ? complete / total * 100 : 0}%` }}/></div><small>{complete}/{total} steps complete</small><div className="todos">{conversation.todos.length ? conversation.todos.map((todo) => <label key={todo.id}><input type="checkbox" checked={todo.done} onChange={(event) => onTodo(conversation.id, todo.id, event.target.checked)}/><span>{todo.text}</span></label>) : <p className="muted">No steps yet.</p>}<form className="add-step" onSubmit={(event) => { event.preventDefault(); if (step.trim()) { onAddTodo(conversation.id, step); setStep('') } }}><input value={step} onChange={(event) => setStep(event.target.value)} placeholder="Add a step"/><button aria-label="Add step"><Icon name="plus"/></button></form></div></section> }
function ChangesSection({ changes }: { changes: readonly { path: string; kind: string }[] }) { return <section className="panel-section"><div className="section-title"><span>Changed files</span><small>{changes.length}</small></div>{changes.length ? <div className="file-list">{changes.slice(0, 7).map((change) => <div key={`${change.kind}-${change.path}`}><code>{change.kind}</code><span title={change.path}>{change.path}</span></div>)}</div> : <p className="muted">No local changes detected.</p>}</section> }
function DeliverablesSection({ entries, onNew, onReveal, onRemove }: { entries: WorkbenchSnapshot['deliverables']; onNew: () => void; onReveal: (path: string) => void; onRemove: (path: string) => void }) { return <section className="panel-section"><div className="section-title"><span>Deliverables</span><button onClick={onNew}><Icon name="plus"/></button></div>{entries.length ? <div className="deliverable-list">{entries.map((item) => <div key={item.relativePath}><button onClick={() => onReveal(item.relativePath)}><Icon name="file"/><span>{item.label}</span><small>{item.relativePath}</small></button><button className="remove" onClick={() => onRemove(item.relativePath)}><Icon name="close"/></button></div>)}</div> : <button className="quiet-add" onClick={onNew}>Pin an output file</button>}</section> }
function DeliverableDialog({ close, save }: { close: () => void; save: (path: string, label: string) => Promise<void> }) { const [path, setPath] = useState(''); const [label, setLabel] = useState(''); return <Dialog title="Pin deliverable" close={close}><label>Relative file path<input autoFocus value={path} onChange={(event) => setPath(event.target.value)} placeholder="release/Narwhal.dmg"/></label><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="macOS build"/></label><button className="primary" disabled={!path.trim() || !label.trim()} onClick={() => void save(path, label)}>Pin file</button></Dialog> }
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) { return <div className="modal" role="dialog" aria-modal="true"><form className="dialog" onSubmit={(event) => event.preventDefault()}><div><h2>{title}</h2><button className="close-dialog" onClick={close}><Icon name="close"/></button></div>{children}</form></div> }
function SettingsDialog({ settings, agent, theme, setTheme, close, restart }: { settings: DesktopSettings; agent: AgentSnapshot; theme: ThemeMode; setTheme: (t: ThemeMode) => void; close: () => void; restart: () => void }) {
  const [tab, setTab] = useState<'models' | 'providers' | 'permissions' | 'theme' | 'runtime' | 'mcp' | 'plugins' | 'skills'>('models')
  const [configuration, setConfiguration] = useState<AgentConfiguration>({ available: false, writable: false, providers: [], models: [], permissionOptions: [], customProvider: { available: false, protocols: [] } })
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const load = async () => { try { setMessage(null); setConfiguration(await api.getAgentConfiguration()) } catch { setMessage({ text: 'Unable to load local Agent settings.', kind: 'error' }) } }
  useEffect(() => { void load() }, [])
  const update = async (operation: () => Promise<AgentConfiguration>, notice = 'Saved locally.') => { try { setMessage(null); setConfiguration(await operation()); if (notice) setMessage({ text: notice, kind: 'success' }) } catch { setMessage({ text: 'The local Agent rejected that setting. Nothing was changed.', kind: 'error' }) } }
  const createProvider = async (input: { id: string; displayName?: string; baseUrl: string; protocol: string; modelIds: readonly string[]; apiKey?: string }) => { try { setMessage(null); const result = await api.createProvider(input); setConfiguration(result.configuration); setMessage({ text: result.keyStored ? 'Provider created locally.' : 'Provider was created, but the API key was rejected. Add the key from its provider row.', kind: 'success' }); return true } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'The local Agent rejected this provider. Nothing was created.', kind: 'error' }); return false } }
  const navigation: ReadonlyArray<{ readonly id: typeof tab; readonly label: string; readonly icon: IconName; readonly group: string }> = [
    { id: 'models', label: 'Models', icon: 'model', group: 'Agent' },
    { id: 'providers', label: 'Providers', icon: 'provider', group: 'Agent' },
    { id: 'permissions', label: 'Permissions', icon: 'shield', group: 'Agent' },
    { id: 'mcp', label: 'MCP Servers', icon: 'provider', group: 'Integrations' },
    { id: 'plugins', label: 'Runtime Extensions', icon: 'model', group: 'Integrations' },
    { id: 'skills', label: 'Skills', icon: 'file', group: 'Integrations' },
    { id: 'theme', label: 'Appearance', icon: 'sliders', group: 'System' },
    { id: 'runtime', label: 'Runtime', icon: 'runtime', group: 'System' },
  ]
  const groupedNavigation = navigation.reduce<Record<string, typeof navigation>>((acc, item) => {
    const g = item.group
    if (!acc[g]) acc[g] = []
    acc[g] = [...acc[g], item]
    return acc
  }, {})
  const groupOrder = ['Agent', 'Integrations', 'System']
  const selectTab = (next: typeof tab) => { setTab(next); document.getElementById(`settings-tab-${next}`)?.focus() }
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => { const index = navigation.findIndex((item) => item.id === tab); const key = event.key; const nextIndex = key === 'ArrowDown' || key === 'ArrowRight' ? (index + 1) % navigation.length : key === 'ArrowUp' || key === 'ArrowLeft' ? (index - 1 + navigation.length) % navigation.length : key === 'Home' ? 0 : key === 'End' ? navigation.length - 1 : undefined; if (nextIndex === undefined) return; event.preventDefault(); selectTab(navigation[nextIndex].id) }
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Settings"><section className="settings-dialog"><header className="settings-head"><div><p>Local workbench</p><h2>Settings</h2></div><button className="close-dialog" aria-label="Close settings" onClick={close}><Icon name="close"/></button></header><div className="settings-body"><nav className="settings-nav" aria-label="Settings sections" role="tablist" aria-orientation="vertical">{groupOrder.map((groupName) => <div key={groupName} className="settings-nav-group"><div className="settings-nav-group-title">{groupName}</div>{groupedNavigation[groupName]?.map((item) => <button id={`settings-tab-${item.id}`} key={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} onKeyDown={onTabKeyDown}><Icon name={item.icon}/><span>{item.label}</span></button>)}</div>)}</nav><div id={`settings-panel-${tab}`} className="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>{message && <p className={`settings-notice ${message.kind}`} role="status">{message.text}</p>}{!configuration.available && tab !== 'runtime' && tab !== 'theme' && tab !== 'mcp' && tab !== 'plugins' && tab !== 'skills' ? <p className="settings-empty">{configuration.error ?? 'This local Agent does not expose its settings plane.'}</p> : tab === 'models' ? <ModelSettings configuration={configuration} update={update}/> : tab === 'providers' ? <ProviderSettings configuration={configuration} update={update} create={createProvider} openModels={() => selectTab('models')}/> : tab === 'permissions' ? <PermissionSettings configuration={configuration} update={update}/> : tab === 'mcp' ? <McpServersTab/> : tab === 'plugins' ? <PluginsTab/> : tab === 'skills' ? <SkillsTab/> : tab === 'theme' ? <ThemeSettings theme={theme} setTheme={setTheme}/> : <RuntimeSettings settings={settings} agent={agent} restart={restart}/>}</div></div></section></div>
}
function ThemeSettings({ theme, setTheme }: { theme: ThemeMode; setTheme: (t: ThemeMode) => void }) {
  const options: ReadonlyArray<{ readonly id: ThemeMode; readonly label: string; readonly description: string }> = [
    { id: 'auto', label: 'Auto', description: 'Follow your system appearance' },
    { id: 'dark', label: 'Dark', description: 'Always use dark theme' },
    { id: 'light', label: 'Light', description: 'Always use light theme' },
  ]
  return <section className="settings-page theme-settings">
    <div className="settings-page-intro"><p>Appearance</p><small>Choose how Narwhal looks on your screen.</small></div>
    <div className="theme-options">
      {options.map((opt) => (
        <label key={opt.id} className={`theme-option${theme === opt.id ? ' active' : ''}`}>
          <input type="radio" name="theme" value={opt.id} checked={theme === opt.id} onChange={() => setTheme(opt.id)} />
          <span className="theme-option-radio"/><span className="theme-option-label">{opt.label}</span><span className="theme-option-desc">{opt.description}</span>
        </label>
      ))}
    </div>
  </section>
}
function ModelSettings({ configuration, update }: { configuration: AgentConfiguration; update: (operation: () => Promise<AgentConfiguration>, notice?: string) => void }) { const current = configuration.selectedModel; const provider = configuration.models.find((item) => item.id === current?.provider) ?? configuration.models[0]; const model = provider?.models.find((item) => item.id === current?.model) ?? provider?.models[0]; const currentMatches = current?.provider === provider?.id && current?.model === model?.id; const effort = currentMatches ? current?.reasoningEffort ?? model?.defaultEffort ?? '' : model?.defaultEffort ?? ''; const select = (nextProvider: AgentConfiguration['models'][number], nextModel: AgentConfiguration['models'][number]['models'][number], nextEffort?: string) => update(() => api.selectAgentModel({ provider: nextProvider.id, model: nextModel.id, ...(nextEffort && { reasoningEffort: nextEffort }) }), ''); return <section className="settings-page model-settings"><div className="active-model-heading"><p>Active model</p><small>This choice applies to the current conversation and becomes the default for new conversations.</small></div>{provider && model ? <div className="model-controls"><label>Provider<select value={provider.id} onChange={(event) => { const nextProvider = configuration.models.find((item) => item.id === event.target.value); const nextModel = nextProvider?.models[0]; if (nextProvider && nextModel) select(nextProvider, nextModel, nextModel.defaultEffort) }}>{configuration.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Model<select value={model.id} onChange={(event) => { const nextModel = provider.models.find((item) => item.id === event.target.value); if (nextModel) select(provider, nextModel, nextModel.defaultEffort) }}>{provider.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{model.efforts.length ? <label>Reasoning effort<select value={effort} onChange={(event) => select(provider, model, event.target.value || undefined)}>{model.efforts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}</div> : <p className="settings-empty">No models are currently available from the local Host.</p>}</section> }
function ProviderSettings({ configuration, update, create, openModels }: { configuration: AgentConfiguration; update: (operation: () => Promise<AgentConfiguration>) => void; create: (input: { id: string; displayName?: string; baseUrl: string; protocol: string; modelIds: readonly string[]; apiKey?: string }) => Promise<boolean>; openModels: () => void }) { const [adding, setAdding] = useState(false); const capability = configuration.customProvider; return <section className="settings-page providers-page"><div className="settings-page-intro"><p>Credentials remain write-only. Add a compatible route from the local Host schema.</p>{!adding && <button type="button" className="add-provider" title={capability.available ? 'Add provider' : capability.reason} disabled={!capability.available} onClick={() => setAdding(true)}><Icon name="plus"/>Add provider</button>}</div>{adding && <CreateProviderForm protocols={capability.protocols} close={() => setAdding(false)} submit={async (input) => { const created = await create(input); if (created) setAdding(false); return created }}/>} {configuration.providers.length ? <div className="provider-list">{configuration.providers.map((provider) => <ProviderRow key={provider.id} provider={provider} update={update} models={configuration.models.find((group) => group.id === provider.id)?.models ?? []} openModels={openModels} onDelete={() => update(() => api.deleteProvider(provider.id))}/>)}</div> : <p className="settings-empty">No configurable providers are available from the local Agent.</p>}{!capability.available && <p className="provider-hint"><Icon name="info"/>{capability.reason ?? 'Custom providers are not available from this local Host.'}</p>}</section> }
function CreateProviderForm({ protocols, close, submit }: { protocols: readonly string[]; close: () => void; submit: (input: { id: string; displayName?: string; baseUrl: string; protocol: string; modelIds: readonly string[]; apiKey?: string }) => Promise<boolean> }) {
  const [id, setId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [protocol, setProtocol] = useState(protocols[0] ?? '')
  const [modelIds, setModelIds] = useState<string[]>([''])
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const addModelId = () => setModelIds((prev) => [...prev, ''])
  const removeModelId = (index: number) => setModelIds((prev) => prev.filter((_, i) => i !== index))
  const updateModelId = (index: number, value: string) => setModelIds((prev) => prev.map((m, i) => (i === index ? value : m)))
  const validModelIds = modelIds.map((m) => m.trim()).filter(Boolean)
  const ready = id.trim() && baseUrl.trim() && protocol && validModelIds.length > 0
  return <form className="provider-create" onSubmit={(event) => { event.preventDefault(); if (!ready || saving) return; setSaving(true); void submit({ id: id.trim(), ...(displayName.trim() && { displayName: displayName.trim() }), baseUrl: baseUrl.trim(), protocol, modelIds: validModelIds, ...(apiKey.trim() && { apiKey: apiKey.trim() }) }).then((created) => { if (created) { setApiKey(''); setModelIds(['']) } setSaving(false) }) }}><header className="provider-create-title"><div><strong>New custom provider</strong><small>Profile and model are created together. API key is optional.</small></div><button type="button" className="close-provider-create" aria-label="Close provider form" title="Close provider form" onClick={close}><Icon name="close"/></button></header><div className="provider-fields"><label>Provider ID<input value={id} onChange={(event) => setId(event.target.value)} placeholder="my-provider" autoCapitalize="none" autoCorrect="off"/></label><label>Display name (optional)<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="My Provider"/></label><label className="provider-wide">Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" inputMode="url"/></label><label>API protocol<select value={protocol} onChange={(event) => setProtocol(event.target.value)}>{protocols.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="provider-wide">Model IDs (at least one required)<div className="model-ids-list">{modelIds.map((modelId, index) => <div key={index} className="model-id-row"><input value={modelId} onChange={(event) => updateModelId(index, event.target.value)} placeholder="e.g. my-model-v1" autoCapitalize="none" autoCorrect="off"/>{modelIds.length > 1 && <button type="button" className="remove-model" onClick={() => removeModelId(index)} aria-label={`Remove model ${index + 1}`}>×</button>}</div>)}</div><button type="button" className="add-model-btn" onClick={addModelId} disabled={modelIds.filter((m) => m.trim()).length === 0 && modelIds.length > 1}>+ Add another model</button></label><label className="provider-wide">API key (optional)<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Stored write-only after the profile is created"/></label></div><div className="provider-create-actions"><span>Provider ID cannot be changed after creation.</span><button type="submit" className="primary" disabled={!ready || saving}>{saving ? 'Creating…' : 'Create provider'}</button></div></form>
}
function ProviderRow({ provider, update, models, openModels, onDelete }: { provider: AgentConfiguration['providers'][number]; update: (operation: () => Promise<AgentConfiguration>) => void; models: readonly AgentConfiguration['models'][number]['models'][number][]; openModels: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [modelIds, setModelIds] = useState<string[]>(models.map((m) => m.id))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? '')
    setModelIds(models.map((m) => m.id))
  }, [provider.baseUrl, models])
  const capabilities = [
    provider.active ? 'Available' : 'Inactive',
    provider.apiKeyWritable ? 'Key managed' : 'No key editor',
    provider.baseUrl !== undefined ? 'Custom endpoint' : null,
  ].filter(Boolean)
  const hasConfig = true // Always allow configuration
  const modelCount = models.length
  const modelLabel = !modelCount ? 'No models' : modelCount === 1 ? '1 model' : `${modelCount} models`
  const addModelId = () => setModelIds((prev) => [...prev, ''])
  const removeModelId = (index: number) => setModelIds((prev) => prev.filter((_, i) => i !== index))
  const updateModelId = (index: number, value: string) => setModelIds((prev) => prev.map((m, i) => (i === index ? value : m)))
  const validModelIds = modelIds.map((m) => m.trim()).filter(Boolean)
  const handleSaveConfig = async () => {
    if (saving) return
    setSaving(true)
    try {
      await update(() => api.updateProvider({
        provider: provider.id,
        baseUrl: baseUrl.trim() || undefined,
        modelIds: validModelIds,
      }))
    } finally {
      setSaving(false)
    }
  }
  return <article className="provider-row" data-expanded={expanded}>
    <header className="provider-row-header">
      <div className="provider-row-title">
        <strong>{provider.name}</strong>
        <small>{capabilities.join(' · ')}</small>
      </div>
      <div className="provider-row-actions">
        <span className={provider.apiKeyConfigured ? 'credential ready' : 'credential'}>
          {provider.apiKeyConfigured ? 'Configured' : 'Needs key'}
        </span>
        <span className="provider-row-model-count">{modelLabel}</span>
        <button type="button" className="provider-row-btn" onClick={openModels} disabled={!modelCount}>Select model</button>
        {hasConfig && <button type="button" className="provider-row-btn configure" onClick={() => setExpanded(!expanded)}>{expanded ? 'Done' : 'Configure'}</button>}
        <button type="button" className="provider-row-btn delete" onClick={() => { if (window.confirm(`Delete provider "${provider.name}"? This action cannot be undone.`)) onDelete() }} title="Delete provider" aria-label={`Delete ${provider.name}`}>Delete</button>
      </div>
    </header>
    {expanded && <div className="provider-row-config">
      <label>Base URL
        <div className="field-action">
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com"/>
        </div>
      </label>
      <label>Models (at least one required)
        <div className="model-ids-list">
          {modelIds.map((modelId, index) => (
            <div key={index} className="model-id-row">
              <input value={modelId} onChange={(event) => updateModelId(index, event.target.value)} placeholder="e.g. my-model-v1" autoCapitalize="none" autoCorrect="off"/>
              {modelIds.length > 1 && <button type="button" className="remove-model" onClick={() => removeModelId(index)} aria-label={`Remove model ${index + 1}`}>×</button>}
            </div>
          ))}
        </div>
        <button type="button" className="add-model-btn" onClick={addModelId}>+ Add model</button>
      </label>
      {provider.apiKeyWritable && <label>API key
        <div className="field-action">
          <input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={provider.apiKeyConfigured ? 'Replace stored key' : 'Paste API key'}/>
          <button type="button" onClick={() => { update(() => api.setProviderApiKey({ provider: provider.id, value: key })); setKey('') }} disabled={!key.trim()}>Save key</button>
        </div>
      </label>}
      <div className="config-actions">
        <button type="button" className="primary" onClick={handleSaveConfig} disabled={saving || !validModelIds.length}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>}
  </article>
}
function PermissionSettings({ configuration, update }: { configuration: AgentConfiguration; update: (operation: () => Promise<AgentConfiguration>) => void }) { return <section className="settings-page"><p>This default is used by new conversations. It does not alter the current conversation.</p>{configuration.permissionOptions.length ? <label>New conversation permission<select value={configuration.defaultPermission ?? ''} onChange={(event) => { const next = event.target.value; if (next.toLowerCase().includes('full') && !window.confirm('Full access can allow unrestricted local tool operations. Continue?')) return; update(() => api.setDefaultPermission(next)) }}>{configuration.permissionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <p className="settings-empty">Permission presets are unavailable from this Host.</p>}</section> }
function RuntimeSettings({ settings, agent, restart }: { settings: DesktopSettings; agent: AgentSnapshot; restart: () => void }) { return <section className="settings-page"><div className="settings-status"><span className={`status-dot ${agent.state}`}/><div><strong>{statusText(agent.state)}</strong><small>Local Agent runtime</small></div></div><dl className="settings-list"><div><dt>App version</dt><dd>{settings.appVersion}</dd></div><div><dt>Runtime</dt><dd>{settings.runtimeVersion}</dd></div><div><dt>Workbench data</dt><dd title={settings.dataDirectory}>{settings.dataDirectory}</dd></div></dl><button className="primary" type="button" onClick={restart} disabled={agent.state === 'starting'}>{agent.state === 'starting' ? 'Starting Agent…' : 'Restart Agent'}</button></section> }
// Global error handling for renderer
window.addEventListener('error', (e) => {
  console.error('[narwhal] Renderer error:', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[narwhal] Unhandled promise rejection:', e.reason)
})

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
