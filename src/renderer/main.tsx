import { StrictMode, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import 'highlight.js/styles/github-dark.css'
import type { AgentConfiguration, AgentConversation, AgentSnapshot, ChatItem, Conversation, DesktopSettings, WorkbenchSnapshot } from '../shared/desktop-contract'
import { classifyTrajectory } from '../shared/trajectory-classifier'
import { buildTrajectoryData } from './trajectory/builder'
import { TrajectoryToolbar } from './trajectory/TrajectoryToolbar'
import { TrajectoryTimeline } from './trajectory/TrajectoryTimeline'
import { TrajectoryTable } from './trajectory/TrajectoryTable'
import { TrajectoryInspector } from './trajectory/TrajectoryInspector'
import './styles.css'

// Detect Electron vs. browser (dev preview) environment and load the appropriate bridge
import './mock-bridge.js'
const _api = window.narwhal
if (!_api) throw new Error('Narwhal Forge desktop bridge is unavailable')
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
function sessionTitle(item: AgentConversation['sessions'][number]) { return item.title === 'Untitled conversation' ? `Conversation · ${new Date(item.updatedAt).toLocaleDateString()}` : item.title }
const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/u.exec(className ?? '')?.[1]
    const text = String(children).replace(/\n$/u, '')
    if (!language) return <code className={className} {...props}>{children}</code>
    return <div className="code-block"><div><span>{language}</span><button type="button" aria-label="Copy code" onClick={() => void navigator.clipboard.writeText(text).catch(() => undefined)}>Copy</button></div><pre><code className={className} {...props}>{children}</code></pre></div>
  },
}
export function MarkdownMessage({ content }: { content: string }) { return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>{content}</ReactMarkdown> }

const DEFAULT_SIDEBAR_WIDTH = 236
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 400
const SIDEBAR_WIDTH_KEY = 'narwhal:sidebar-width'
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
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    return stored ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parseInt(stored, 10))) : DEFAULT_SIDEBAR_WIDTH
  })
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY)
    return stored ? Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, parseInt(stored, 10))) : DEFAULT_PANEL_WIDTH
  })
  const selectedConversation = useMemo(() => workbench.conversations.find((conv) => conv.id === workbench.selectedConversationId) ?? workbench.conversations[0], [workbench])
  const workspace = workbench.workspaces.find((item) => item.id === workbench.selectedWorkspaceId)
  const mutate = async (operation: () => Promise<WorkbenchSnapshot>) => { try { setError(''); const next = await operation(); setWorkbench(next); setConversation(next.conversation) } catch { setError('We couldn’t complete that action. Your local files were not changed.') } }
  const agentCall = async (operation: () => Promise<AgentConversation>) => { try { setError(''); setConversation(await operation()) } catch { setError('The local Agent could not complete that request. Check its status and try again.') } }
  useEffect(() => {
    void api.bootstrap().then(({ agent, workbench, settings }) => { setAgent(agent); setSettings(settings); setWorkbench(workbench); setConversation(workbench.conversation) }).catch(() => setError('Narwhal Forge could not load its local workspace data.'))
    const unAgent = api.onAgentState(setAgent); const unConversation = api.onConversation(setConversation)
    const unWorkbench = api.onWorkbench((next) => { setWorkbench(next); setConversation(next.conversation) })
    return () => { unAgent(); unConversation(); unWorkbench() }
  }, [])
  useEffect(() => { if (agent.state === 'ready') void api.getAgentConfiguration().then(setConfiguration).catch(() => undefined) }, [agent.state, conversation.selectedSessionId])
  const selectModel = async (input: { provider: string; model: string; reasoningEffort?: string }) => { try { setConfiguration(await api.selectAgentModel(input)) } catch { setError('The selected model could not be applied. Nothing was changed.') } }
  const selectPermission = async (preset: string) => { if (preset.toLowerCase().includes('full') && !window.confirm('Full access can allow unrestricted local tool operations. Continue?')) return; try { setConfiguration(await api.setDefaultPermission(preset)) } catch { setError('The selected permission could not be applied. Nothing was changed.') } }
  useEffect(() => { if (workspace && agent.state === 'ready') void agentCall(api.listSessions) }, [workspace?.id, agent.state])
  useEffect(() => { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)) }, [sidebarWidth])
  useEffect(() => { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)) }, [panelWidth])
  const layoutStyle = workbench.panelOpen
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
  return <main className="app-shell">
    <header className="titlebar"><div className="drag-space"/><div className="brand no-drag"><img src="./assets/narwhal-icon.png"/><div className="brand-name-block"><span className="brand-name">Narwhal Forge</span><span className="brand-sub">based on DeepSeek Harness</span></div></div><div className="crumb no-drag" style={{ marginLeft: `${sidebarWidth + 5}px` }}>{workspace ? <><span className="crumb-name">{workspace.name}</span><span className="crumb-path" title={workspace.displayPath}>{workspace.displayPath}</span></> : <span>Choose a workspace</span>}</div><button className={`agent-status ${agent.state} no-drag`} onClick={() => agent.state !== 'ready' && void api.retryAgent()}><i/>{statusText(agent.state)}</button></header>
    <section className={`layout${workbench.panelOpen ? ' panel-open' : ''}`} style={layoutStyle}>
      <aside className="sidebar">
        <button className="new-task" disabled={!workspace} onClick={() => void mutate(() => api.createConversation({ title: 'New conversation', goal: '' }))}><Icon name="plus"/>New conversation</button>
        <SideBar workbench={workbench} conversation={conversation} workspace={workspace} agent={agent} selectedConversation={selectedConversation} choose={() => void mutate(api.chooseWorkspace)} selectWorkspace={(id) => void mutate(() => api.selectWorkspace(id))} createSession={() => void agentCall(api.createSession)} selectSession={(id) => void agentCall(() => api.selectSession(id))} selectConversation={(id) => void mutate(() => api.selectConversation(id))}/>
        <div className="side-foot"><button onClick={() => setSettingsOpen(true)}><Icon name="settings"/>Settings</button></div>
      </aside>
      <div className="sidebar-resizer" onMouseDown={onSidebarResizeStart} onDoubleClick={onSidebarDoubleClick} title="Drag to resize · Double-click to reset"/>
      <section className="agent-area">
        {error && <div className="notice"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
        {!workspace ? <EmptyWorkspace open={() => void mutate(api.chooseWorkspace)}/> : agent.state !== 'ready' ? <AgentLoading state={agent.state} retry={() => void api.retryAgent()}/> : !conversation.selectedSessionId ? <EmptyConversation create={() => void agentCall(api.createSession)}/> : <NativeConversation conversation={conversation} configuration={configuration} selectModel={selectModel} selectPermission={selectPermission} trajectoryOpen={trajectoryOpen} setTrajectoryOpen={setTrajectoryOpen} send={(text) => agentCall(() => api.sendPrompt(text))} cancel={() => void api.cancelPrompt().catch(() => setError('The Agent could not stop this turn.'))}/>} 
        <footer className="statusbar">{conversation.usage ? <span className="usage-metrics"><strong>{conversation.usage.turns}</strong> turns<em/>{conversation.usage.steps} steps<em/>LLM <strong>{formatLatency(conversation.usage.llmLatency)}</strong><em/>TTFT avg <strong>{formatLatency(conversation.usage.ttftAvg)}</strong><em/><strong>{conversation.usage.tokenThroughput}</strong> tok/s<em/>Cache hit <strong>{conversation.usage.cacheHitRate}%</strong><em/>Input <strong>{formatTokens(conversation.usage.inputTokens)} tok</strong><em/>Output <strong>{conversation.usage.outputTokens} tok</strong></span> : null}<span className="statusbar-right"><span><Icon name="branch"/>{workbench.git.branch ?? 'No Git repository'}</span></span></footer>
      </section>
      {workbench.panelOpen && <div className="panel-resizer" onMouseDown={onPanelResizeStart} onDoubleClick={onPanelDoubleClick} title="Drag to resize · Double-click to reset"/>} 
      {workbench.panelOpen && <aside className="context-panel open" style={{ width: panelWidth }}><div className="panel-head"><div><p>Work context</p><h2>{selectedConversation?.title ?? 'No conversation selected'}</h2></div><button title="Close panel" onClick={() => void mutate(() => api.setPanelOpen(false))}><Icon name="close"/></button></div>{!workspace ? <p className="panel-empty">Choose a workspace to keep its plan, changed files and deliverables together.</p> : <><ConversationSection conversation={selectedConversation} onSelect={(conversationId) => void mutate(() => api.selectConversation(conversationId))} onNew={() => void mutate(() => api.createConversation({ title: 'New conversation', goal: '' }))} onUpdate={(input) => void mutate(() => api.updateConversation(input))} onTodo={(conversationId, todoId, done) => void mutate(() => api.toggleTodo({ conversationId, todoId, done }))} onAddTodo={(conversationId, text) => void mutate(() => api.addTodo({ conversationId, text }))}/><ChangesSection changes={workbench.git.changes}/><DeliverablesSection entries={workbench.deliverables} onNew={() => setDeliverableDraft(true)} onReveal={(path) => void api.revealDeliverable(path)} onRemove={(path) => void mutate(() => api.unpinDeliverable(path))}/></>}</aside>}
    </section>
    {workbench.panelOpen && <button className="drawer-backdrop" aria-label="Close work context" onClick={() => void mutate(() => api.setPanelOpen(false))}/>} 
    <button className={`panel-trigger${workbench.panelOpen ? ' open' : ''}`} style={workbench.panelOpen ? { right: panelWidth + 11 } : undefined} onClick={() => void mutate(() => api.setPanelOpen(!workbench.panelOpen))} aria-label="Toggle work context"><Icon name="panel"/></button>
    {deliverableDraft && <DeliverableDialog close={() => setDeliverableDraft(false)} save={(relativePath, label) => mutate(() => api.pinDeliverable({ relativePath, label })).then(() => setDeliverableDraft(false))}/>} 
    {settingsOpen && <SettingsDialog settings={settings} agent={agent} close={() => setSettingsOpen(false)} restart={() => void api.retryAgent()}/>} 
  </main>
}

function SideBar({ workbench, conversation, workspace, agent, selectedConversation, choose, selectWorkspace, createSession, selectSession, selectConversation }: { workbench: WorkbenchSnapshot; conversation: AgentConversation; workspace: WorkbenchSnapshot['workspaces'][number] | undefined; agent: AgentSnapshot; selectedConversation: Conversation | undefined; choose: () => void; selectWorkspace: (id: string) => void; createSession: () => void; selectSession: (id: string) => void; selectConversation: (id: string) => void }) { return <><div className="side-section"><div className="section-heading"><span>Workspaces</span><button className="workspace-add" aria-label="Open workspace" title="Open workspace" onClick={choose}><Icon name="folder-plus"/></button></div><div className="workspace-list">{workbench.workspaces.length ? workbench.workspaces.map((item) => <button key={item.id} className={item.id === workbench.selectedWorkspaceId ? 'workspace active' : 'workspace'} onClick={() => selectWorkspace(item.id)}><Icon name="folder"/><span>{item.name}</span></button>) : <p className="empty-side">Open a local folder to begin.</p>}</div></div><div className="side-section"><div className="section-heading"><span>Sessions</span><button disabled={!workspace || agent.state !== 'ready'} title="New session" onClick={createSession}><Icon name="plus"/></button></div><div className="sessions">{workspace ? conversation.sessions.length ? conversation.sessions.map((item) => <button className={item.id === conversation.selectedSessionId ? 'session active' : 'session'} key={item.id} onClick={() => selectSession(item.id)}><span>{sessionTitle(item)}</span>{item.running && <i className="session-live"/>}</button>) : <p className="empty-side">Create a session to begin.</p> : <p className="empty-side">Choose a workspace first.</p>}</div></div><div className="side-section task-list"><div className="section-heading"><span>Conversations</span><span className="count">{workbench.conversations.length}</span></div>{workbench.conversations.slice(0, 4).map((conv) => <button className={conv.id === selectedConversation?.id ? 'session active' : 'session'} key={conv.id} onClick={() => selectConversation(conv.id)}><span>{conv.title}</span><small>{conv.status === 'done' ? 'Done' : 'Active'}</small></button>)}</div></> }
function NativeConversation({ conversation, configuration, selectModel, selectPermission, trajectoryOpen, setTrajectoryOpen, send, cancel }: { conversation: AgentConversation; configuration: AgentConfiguration; selectModel: (input: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>; selectPermission: (preset: string) => Promise<void>; trajectoryOpen: boolean; setTrajectoryOpen: (value: boolean) => void; send: (text: string) => void; cancel: () => void }) {
  const trajectoryData = useMemo(() => buildTrajectoryData(conversation.trajectory), [conversation.trajectory])
  const [duration, setDuration] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<number | null>(null)
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
  const chatContent = conversation.messages.length
    ? conversation.messages.map((item) => <TimelineItem key={item.id} item={item} trajectory={false}/>)
    : <div className="conversation-empty"><img src="./assets/narwhal-icon.png"/><h2>Start with a clear task.</h2><p>Ask the local Agent to explore, build, fix or explain something in this workspace.</p></div>
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
  return (
    <div className="native-conversation">
      <div className="conversation-head">
        <div><p>Local Agent</p><h1>{trajectoryOpen ? 'Trajectory' : 'Chat'}</h1></div>
        <div className="segmented">
          <button className={!trajectoryOpen ? 'active' : ''} onClick={() => setTrajectoryOpen(false)}>Chat</button>
          <button className={trajectoryOpen ? 'active' : ''} onClick={() => setTrajectoryOpen(true)}>Trajectory</button>
        </div>
      </div>
      <div className={`timeline ${trajectoryOpen ? 'trajectory-view' : ''}`} ref={timeline} onScroll={trackScroll}>
        {trajectoryOpen ? trajectoryContent : chatContent}
      </div>
      {!trajectoryOpen && <Composer running={conversation.running} configuration={configuration} hasSession={!!conversation.selectedSessionId} selectModel={selectModel} selectPermission={selectPermission} send={send} cancel={cancel}/>}
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
function TimelineItem({ item, trajectory }: { item: ChatItem; trajectory: boolean }) { if (trajectory || item.kind === 'trajectory' || item.kind === 'error') { const event = normalizeTrajectory(item); return <article className={`trajectory-row ${event.type}`}><span className="trajectory-mark"><Icon name={event.type}/></span><div><strong>{event.label}</strong><p>{event.text}</p></div></article> } return <article className={`message ${item.kind}`}><p className="message-label">{item.kind === 'user' ? 'You' : 'Narwhal Agent'}{item.streaming && <span className="streaming">Writing</span>}</p><div className="message-body"><MarkdownMessage content={item.text}/></div></article> }
function Composer({ running, configuration, hasSession, selectModel, selectPermission, send, cancel }: { running: boolean; configuration: AgentConfiguration; hasSession: boolean; selectModel: (input: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>; selectPermission: (preset: string) => Promise<void>; send: (text: string) => void; cancel: () => void }) { const [text, setText] = useState(''); const input = useRef<HTMLTextAreaElement>(null); useEffect(() => { if (running) { setText(''); input.current?.blur() } }, [running]); const submit = (event: FormEvent) => { event.preventDefault(); const message = text.trim(); if (!message || running) return; setText(''); send(message) }; const permissionValue = configuration.permissionOptions.some((option) => option.id === configuration.defaultPermission) ? configuration.defaultPermission ?? '' : configuration.permissionOptions[0]?.id ?? ''; const modelPickerDisabled = !hasSession || running || !configuration.available; return <form className="composer" onSubmit={submit}><div className="composer-input-row"><textarea ref={input} value={text} onChange={(event) => setText(event.target.value)} placeholder={running ? 'The Agent is working…' : hasSession ? 'Message the local Agent' : 'Select or create a conversation first'} disabled={running} rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}/>{running ? <button type="button" className="cancel-turn" onClick={cancel}>Stop</button> : <button className="send" disabled={!text.trim() || !hasSession} aria-label="Send message"><Icon name="arrow"/></button>}</div><div className="composer-controls"><ModelPicker configuration={configuration} disabled={modelPickerDisabled} running={running} selectModel={selectModel}/>{configuration.available && configuration.permissionOptions.length ? <label className="composer-permission"><select aria-label="Permission" title="Set default conversation permission" value={permissionValue} disabled={running} onChange={(event) => void selectPermission(event.target.value)}>{configuration.permissionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : configuration.available ? <span className="composer-permission-empty">Permission presets unavailable</span> : <span className="composer-permission-empty">Agent not connected</span>}</div></form> }
function modelSelectionValue(provider: string, model: string) { return JSON.stringify([provider, model]) }
function parseModelSelection(value: string): { provider: string; model: string } | undefined { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' ? { provider: parsed[0], model: parsed[1] } : undefined } catch { return undefined } }
function ModelPicker({ configuration, disabled, running, selectModel }: { configuration: AgentConfiguration; disabled: boolean; running: boolean; selectModel: (input: { provider: string; model: string; reasoningEffort?: string }) => Promise<void> }) { const groups = configuration.models; const selected = configuration.selectedModel; const provider = groups.find((item) => item.id === selected?.provider) ?? groups.find((item) => item.models.length > 0); const model = provider?.models.find((item) => item.id === selected?.model) ?? provider?.models[0]; if (!configuration.available || !provider || !model) return <span className="composer-model-empty">Model unavailable</span>; const value = modelSelectionValue(provider.id, model.id); const effort = model.efforts.some((item) => item.id === selected?.reasoningEffort) ? selected?.reasoningEffort ?? '' : model.defaultEffort ?? model.efforts[0]?.id ?? ''; const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => { const next = parseModelSelection(event.target.value); if (!next) return; const nextProvider = groups.find((item) => item.id === next.provider); const nextModel = nextProvider?.models.find((item) => item.id === next.model); if (nextProvider && nextModel) void selectModel({ provider: nextProvider.id, model: nextModel.id, ...(nextModel.defaultEffort && { reasoningEffort: nextModel.defaultEffort }) }) }; const handleEffortChange = (event: React.ChangeEvent<HTMLSelectElement>) => { void selectModel({ provider: provider.id, model: model.id, reasoningEffort: event.target.value || undefined }) }; return <><label className="composer-model-picker"><select aria-label="Provider and model" title="Switch provider and model" value={value} disabled={disabled || running} onChange={handleModelChange}>{groups.map((group) => <optgroup key={group.id} label={group.name}>{group.models.map((item) => <option key={item.id} value={modelSelectionValue(group.id, item.id)}>{item.name}</option>)}</optgroup>)}</select></label>{model.efforts.length ? <label className="composer-effort-picker"><select aria-label="Reasoning effort" title="Switch reasoning effort" value={effort} disabled={disabled || running} onChange={handleEffortChange}>{model.efforts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}</> }
function EmptyWorkspace({ open }: { open: () => void }) { return <div className="empty-state"><img src="./assets/narwhal-icon.png"/><p className="eyebrow">Your local forge</p><h1>Give your agent a place to work.</h1><p>Open a project folder. Narwhal Forge keeps conversations and deliverables on this Mac, separate from your code.</p><button className="primary" onClick={open}><Icon name="folder-plus"/>Open workspace</button></div> }
function EmptyConversation({ create }: { create: () => void }) { return <div className="empty-state"><img src="./assets/narwhal-icon.png"/><p className="eyebrow">Ready when you are</p><h1>Start a local conversation.</h1><p>Narwhal Forge will create an Agent session for this workspace. Your work context stays in this app.</p><button className="primary" onClick={create}><Icon name="plus"/>New conversation</button></div> }
function AgentLoading({ state, retry }: { state: AgentSnapshot['state']; retry: () => void }) { return <div className="empty-state loading"><div className="pulse-orb"/><p className="eyebrow">Local agent</p><h1>{state === 'needs-restart' ? 'The agent needs a restart.' : 'Preparing your local agent.'}</h1><p>{state === 'needs-restart' ? 'Your workspace is safe. Restart the local agent to continue.' : 'Starting the tools, skills, and session runtime on this Mac.'}</p>{state === 'needs-restart' && <button className="primary" onClick={retry}>Restart agent</button>}</div> }
function ConversationSection({ conversation, onSelect, onNew, onUpdate, onTodo, onAddTodo }: { conversation?: Conversation; onSelect: (id: string) => void; onNew: () => void; onUpdate: (input: { conversationId: string; title?: string; goal?: string; status?: 'active' | 'done' }) => void; onTodo: (conversationId: string, todoId: string, done: boolean) => void; onAddTodo: (conversationId: string, text: string) => void }) { const [editing, setEditing] = useState(false); const [step, setStep] = useState(''); const complete = conversation?.todos.filter((item) => item.done).length ?? 0; const total = conversation?.todos.length ?? 0; useEffect(() => setEditing(false), [conversation?.id]); if (!conversation) return <section className="panel-section"><div className="section-title"><span>Plan</span><button onClick={onNew}><Icon name="plus"/></button></div><button className="quiet-add" onClick={onNew}>Create the first conversation</button></section>; return <section className="panel-section"><div className="section-title"><span>Plan</span><span><button title="Edit conversation" onClick={() => setEditing(!editing)}><Icon name="settings"/></button><button onClick={onNew}><Icon name="plus"/></button></span></div>{editing ? <div className="task-edit"><input defaultValue={conversation.title} aria-label="Conversation title" onBlur={(event) => event.target.value.trim() && onUpdate({ conversationId: conversation.id, title: event.target.value })}/><textarea defaultValue={conversation.goal} aria-label="Conversation goal" onBlur={(event) => event.target.value.trim() && onUpdate({ conversationId: conversation.id, goal: event.target.value })}/><label><input type="checkbox" checked={conversation.status === 'done'} onChange={(event) => onUpdate({ conversationId: conversation.id, status: event.target.checked ? 'done' : 'active' })}/>Mark conversation complete</label></div> : <button className="task-choice" onClick={() => onSelect(conversation.id)}>{conversation.goal}</button>}<div className="progress"><span style={{ width: `${total ? complete / total * 100 : 0}%` }}/></div><small>{complete}/{total} steps complete</small><div className="todos">{conversation.todos.length ? conversation.todos.map((todo) => <label key={todo.id}><input type="checkbox" checked={todo.done} onChange={(event) => onTodo(conversation.id, todo.id, event.target.checked)}/><span>{todo.text}</span></label>) : <p className="muted">No steps yet.</p>}<form className="add-step" onSubmit={(event) => { event.preventDefault(); if (step.trim()) { onAddTodo(conversation.id, step); setStep('') } }}><input value={step} onChange={(event) => setStep(event.target.value)} placeholder="Add a step"/><button aria-label="Add step"><Icon name="plus"/></button></form></div></section> }
function ChangesSection({ changes }: { changes: readonly { path: string; kind: string }[] }) { return <section className="panel-section"><div className="section-title"><span>Changed files</span><small>{changes.length}</small></div>{changes.length ? <div className="file-list">{changes.slice(0, 7).map((change) => <div key={`${change.kind}-${change.path}`}><code>{change.kind}</code><span title={change.path}>{change.path}</span></div>)}</div> : <p className="muted">No local changes detected.</p>}</section> }
function DeliverablesSection({ entries, onNew, onReveal, onRemove }: { entries: WorkbenchSnapshot['deliverables']; onNew: () => void; onReveal: (path: string) => void; onRemove: (path: string) => void }) { return <section className="panel-section"><div className="section-title"><span>Deliverables</span><button onClick={onNew}><Icon name="plus"/></button></div>{entries.length ? <div className="deliverable-list">{entries.map((item) => <div key={item.relativePath}><button onClick={() => onReveal(item.relativePath)}><Icon name="file"/><span>{item.label}</span><small>{item.relativePath}</small></button><button className="remove" onClick={() => onRemove(item.relativePath)}><Icon name="close"/></button></div>)}</div> : <button className="quiet-add" onClick={onNew}>Pin an output file</button>}</section> }
function DeliverableDialog({ close, save }: { close: () => void; save: (path: string, label: string) => Promise<void> }) { const [path, setPath] = useState(''); const [label, setLabel] = useState(''); return <Dialog title="Pin deliverable" close={close}><label>Relative file path<input autoFocus value={path} onChange={(event) => setPath(event.target.value)} placeholder="release/Narwhal Forge.dmg"/></label><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="macOS build"/></label><button className="primary" disabled={!path.trim() || !label.trim()} onClick={() => void save(path, label)}>Pin file</button></Dialog> }
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) { return <div className="modal" role="dialog" aria-modal="true"><form className="dialog" onSubmit={(event) => event.preventDefault()}><div><h2>{title}</h2><button className="close-dialog" onClick={close}><Icon name="close"/></button></div>{children}</form></div> }
function SettingsDialog({ settings, agent, close, restart }: { settings: DesktopSettings; agent: AgentSnapshot; close: () => void; restart: () => void }) {
  const [tab, setTab] = useState<'models' | 'providers' | 'permissions' | 'runtime'>('models')
  const [configuration, setConfiguration] = useState<AgentConfiguration>({ available: false, writable: false, providers: [], models: [], permissionOptions: [], customProvider: { available: false, protocols: [] } })
  const [message, setMessage] = useState('')
  const load = async () => { try { setMessage(''); setConfiguration(await api.getAgentConfiguration()) } catch { setMessage('Unable to load local Agent settings.') } }
  useEffect(() => { void load() }, [])
  const update = async (operation: () => Promise<AgentConfiguration>, notice = 'Saved locally.') => { try { setMessage(''); setConfiguration(await operation()); if (notice) setMessage(notice) } catch { setMessage('The local Agent rejected that setting. Nothing was changed.') } }
  const createProvider = async (input: { id: string; displayName?: string; baseUrl: string; protocol: string; modelIds: readonly string[]; apiKey?: string }) => { try { setMessage(''); const result = await api.createProvider(input); setConfiguration(result.configuration); setMessage(result.keyStored ? 'Provider created locally.' : 'Provider was created, but the API key was rejected. Add the key from its provider row.'); return true } catch (error) { setMessage(error instanceof Error ? error.message : 'The local Agent rejected this provider. Nothing was created.'); return false } }
  const navigation: ReadonlyArray<{ readonly id: typeof tab; readonly label: string; readonly icon: IconName; readonly group: string }> = [
    { id: 'models', label: 'Models', icon: 'model', group: 'Agent' },
    { id: 'providers', label: 'Providers', icon: 'provider', group: 'Agent' },
    { id: 'permissions', label: 'Permissions', icon: 'shield', group: 'Security' },
    { id: 'runtime', label: 'Runtime', icon: 'runtime', group: 'System' },
  ]
  const groupedNavigation = navigation.reduce<Record<string, typeof navigation>>((acc, item) => {
    const g = item.group
    if (!acc[g]) acc[g] = []
    acc[g] = [...acc[g], item]
    return acc
  }, {})
  const groupOrder = ['Agent', 'Security', 'System']
  const selectTab = (next: typeof tab) => { setTab(next); document.getElementById(`settings-tab-${next}`)?.focus() }
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => { const index = navigation.findIndex((item) => item.id === tab); const key = event.key; const nextIndex = key === 'ArrowDown' || key === 'ArrowRight' ? (index + 1) % navigation.length : key === 'ArrowUp' || key === 'ArrowLeft' ? (index - 1 + navigation.length) % navigation.length : key === 'Home' ? 0 : key === 'End' ? navigation.length - 1 : undefined; if (nextIndex === undefined) return; event.preventDefault(); selectTab(navigation[nextIndex].id) }
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Settings"><section className="dialog settings-dialog"><header className="settings-head"><div><p>Local workbench</p><h2>Settings</h2></div><button className="close-dialog" aria-label="Close settings" onClick={close}><Icon name="close"/></button></header><div className="settings-body"><nav className="settings-nav" aria-label="Settings sections" role="tablist" aria-orientation="vertical">{groupOrder.map((groupName) => <div key={groupName} className="settings-nav-group"><div className="settings-nav-group-title">{groupName}</div>{groupedNavigation[groupName]?.map((item) => <button id={`settings-tab-${item.id}`} key={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} onKeyDown={onTabKeyDown}><Icon name={item.icon}/><span>{item.label}</span></button>)}</div>)}</nav><div id={`settings-panel-${tab}`} className="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>{message && <p className="settings-notice" role="status">{message}</p>}{!configuration.available && tab !== 'runtime' ? <p className="settings-empty">{configuration.error ?? 'This local Agent does not expose its settings plane.'}</p> : tab === 'models' ? <ModelSettings configuration={configuration} update={update}/> : tab === 'providers' ? <ProviderSettings configuration={configuration} update={update} create={createProvider} openModels={() => selectTab('models')}/> : tab === 'permissions' ? <PermissionSettings configuration={configuration} update={update}/> : <RuntimeSettings settings={settings} agent={agent} restart={restart}/>}</div></div></section></div>
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
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
