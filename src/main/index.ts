import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell, Tray } from 'electron'
import type { AgentConfiguration, AgentConversation, AgentSnapshot, Conversation, ConversationStatus, CreateProviderResult, Deliverable, DesktopSettings, GitChange, TodoItem, WorkbenchSnapshot, Workspace } from '../shared/desktop-contract.js'
import { createHostSupervisor, type HostGeneration } from './host-supervisor.js'
import { HostBridge } from './host-bridge.js'
import { resolveRuntime, type DshRuntime } from './runtime.js'

// Keep reading the existing local workbench after renaming the package from
// narwhal-forge-macos to narwhal. A future data-directory migration can move
// this deliberately, rather than making current sessions appear to vanish.
// An explicit user-data directory remains available for tests and diagnostics.
const hasCustomUserDataDirectory = process.argv.some((argument) => argument === '--user-data-dir' || argument.startsWith('--user-data-dir='))
if (!hasCustomUserDataDirectory) app.setPath('userData', join(app.getPath('appData'), 'narwhal-forge-macos'))
protocol.registerSchemesAsPrivileged([{ scheme: 'narwhal', privileges: { secure: true, standard: true, supportFetchAPI: true } }])
const recoveryUrl = new URL('../recovery/index.html', import.meta.url).toString()
const appPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
// Running an unpackaged Electron binary is not the same as running a Vite
// dev server. The normal `pnpm dev` script builds the renderer first, so use
// the local bundle unless a dev-server URL is explicitly supplied.
const configuredDevUrl = process.env.NARWHAL_DEV_SERVER_URL
const appUrl = configuredDevUrl ? new URL(configuredDevUrl).toString() : pathToFileURL(appPath).toString()
const isPrimaryInstance = app.requestSingleInstanceLock()
let windowRef: BrowserWindow | undefined
let tray: Tray | undefined
let isQuitting = false
let selectedRuntime: DshRuntime | undefined
let activeSupervisor: ReturnType<typeof createHostSupervisor> | undefined
let agent: AgentSnapshot = { state: 'starting' }
const hostBridge = new HostBridge()

interface StoredWorkspace { id: string; path: string; name: string; lastOpenedAt: string; conversations: Conversation[]; selectedConversationId?: string; selectedSessionId?: string; deliverables: Deliverable[]; panelOpen: boolean }
interface Store { version: 1; selectedWorkspaceId?: string; panelOpen?: boolean; workspaces: StoredWorkspace[] }
let store: Store = { version: 1, workspaces: [] }
let storePath = ''
let workbenchRefreshTimer: NodeJS.Timeout | undefined

function registerNarwhalProtocol(): void {
  const root = join(app.getAppPath(), 'dist', 'renderer')
  const mediaTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }
  protocol.handle('narwhal', async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = resolve(root, safePath)
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return new Response('Not found', { status: 404 })
    try {
      const headers = {
        'Content-Type': mediaTypes[extname(filePath)] ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      }
      return new Response(await readFile(filePath), { headers })
    } catch { return new Response('Not found', { status: 404 }) }
  })
}

const currentWindow = () => windowRef
const getSupervisor = () => { if (!activeSupervisor) throw new Error('Agent supervisor is unavailable'); return activeSupervisor }
const isAppSender = (event: Electron.IpcMainInvokeEvent) => event.senderFrame?.url === appUrl
const isRecoverySender = (event: Electron.IpcMainInvokeEvent) => event.senderFrame?.url === recoveryUrl
const sender = (event: Electron.IpcMainInvokeEvent, allowRecovery = false) => { if (!isAppSender(event) && !(allowRecovery && isRecoverySender(event))) throw new Error('Operation rejected for an untrusted renderer') }
const asRecord = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request'); return value as Record<string, unknown> }
const asString = (value: unknown, field: string, max = 500): string => { if (typeof value !== 'string') throw new Error(`Invalid ${field}`); const text = value.trim(); if (!text || text.length > max) throw new Error(`Invalid ${field}`); return text }
const emitAgent = () => windowRef?.webContents.send('narwhal:agent-state', agent)
const emitConversation = (conversation: AgentConversation) => windowRef?.webContents.send('narwhal:conversation', conversation)
const emitWorkbench = (workbench: WorkbenchSnapshot) => windowRef?.webContents.send('narwhal:workbench', workbench)
function scheduleWorkbenchRefresh(): void {
  if (workbenchRefreshTimer !== undefined) return
  workbenchRefreshTimer = setTimeout(() => {
    workbenchRefreshTimer = undefined
    void snapshot().then(emitWorkbench).catch(() => undefined)
  }, 350)
}

function safeEnvironment(dshHome: string): NodeJS.ProcessEnv {
  const inherited = process.env
  return { HOME: inherited.HOME, PATH: inherited.PATH, TMPDIR: inherited.TMPDIR, LANG: inherited.LANG, LC_ALL: inherited.LC_ALL, DEEPSEEK_API_KEY: inherited.DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL: inherited.DEEPSEEK_BASE_URL, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1', ...(app.isPackaged && { ELECTRON_RUN_AS_NODE: '1' }) }
}

async function persist(): Promise<void> {
  const temporary = `${storePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(join(app.getPath('userData'), 'narwhal-forge'), { recursive: true, mode: 0o700 })
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, storePath)
}
async function loadStore(): Promise<void> {
  storePath = join(app.getPath('userData'), 'narwhal-forge', 'workbench.json')
  try { const parsed = JSON.parse(await readFile(storePath, 'utf8')) as Store; if (parsed.version === 1 && Array.isArray(parsed.workspaces)) store = parsed } catch { /* Fresh local workbench. */ }
}
const selected = (): StoredWorkspace | undefined => store.workspaces.find((item) => item.id === store.selectedWorkspaceId)
const workspaceSummary = (item: StoredWorkspace): Workspace => ({ id: item.id, name: item.name, displayPath: item.path, lastOpenedAt: item.lastOpenedAt })
const desktopSettings = (): DesktopSettings => ({ appVersion: app.getVersion(), runtimeVersion: selectedRuntime?.manifest.dshVersion ?? 'Unavailable', dataDirectory: join(app.getPath('userData'), 'narwhal-forge') })

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''; const timer = setTimeout(() => child.kill('SIGTERM'), 2500)
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => { output = `${output}${chunk}`.slice(0, 200_000) })
    child.once('close', (code) => { clearTimeout(timer); resolveOutput(code === 0 ? output : '') })
    child.once('error', () => { clearTimeout(timer); resolveOutput('') })
  })
}
async function inspectGit(workspace?: StoredWorkspace): Promise<{ branch?: string; changes: GitChange[] }> {
  if (!workspace) return { changes: [] }
  const [branchRaw, statusRaw] = await Promise.all([git(workspace.path, ['branch', '--show-current']), git(workspace.path, ['status', '--porcelain=v1', '-z'])])
  const changes: GitChange[] = []
  for (const part of statusRaw.split('\0')) { if (part.length >= 4) changes.push({ kind: part.slice(0, 2).trim() || 'modified', path: part.slice(3) }) }
  return { branch: branchRaw.trim() || undefined, changes: changes.slice(0, 100) }
}
async function snapshot(): Promise<WorkbenchSnapshot> {
  const workspace = selected()
  return { workspaces: store.workspaces.map(workspaceSummary), selectedWorkspaceId: store.selectedWorkspaceId, conversations: workspace?.conversations ?? [], selectedConversationId: workspace?.selectedConversationId, deliverables: workspace?.deliverables ?? [], panelOpen: workspace?.panelOpen ?? store.panelOpen ?? false, git: await inspectGit(workspace), conversation: hostBridge.snapshot() }
}
function requireWorkspace(id?: string): StoredWorkspace {
  const result = (id ? store.workspaces.find((item) => item.id === id) : selected())
  if (!result) throw new Error('Choose a workspace first')
  return result
}
async function chooseWorkspace(): Promise<WorkbenchSnapshot> {
  const result = await dialog.showOpenDialog({ title: 'Open workspace', properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || !result.filePaths[0]) return snapshot()
  const path = await realpath(result.filePaths[0]); const now = new Date().toISOString()
  let workspace = store.workspaces.find((item) => item.path === path)
  if (!workspace) { workspace = { id: randomUUID(), path, name: basename(path), lastOpenedAt: now, conversations: [], deliverables: [], panelOpen: false }; store.workspaces.unshift(workspace) }
  workspace.lastOpenedAt = now; store.selectedWorkspaceId = workspace.id; store.workspaces = store.workspaces.slice(0, 12); await persist()
  if (agent.state === 'ready') { await hostBridge.listSessions(); if (workspace.selectedSessionId) await hostBridge.selectSession(workspace.selectedSessionId, workspace.path); else hostBridge.clearSelection() }
  return snapshot()
}
function pathWithin(workspace: StoredWorkspace, candidate: string): string {
  const absolute = resolve(workspace.path, candidate); const rel = relative(workspace.path, absolute)
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || resolve(workspace.path, rel) !== absolute) throw new Error('Path must stay inside the selected workspace')
  return rel
}
async function verifiedPathWithin(workspace: StoredWorkspace, candidate: string): Promise<string> {
  const rel = pathWithin(workspace, candidate)
  const absolute = resolve(workspace.path, rel)
  const workspaceReal = await realpath(workspace.path)
  let targetReal: string
  try {
    targetReal = await realpath(absolute)
  } catch {
    // Deliverables may be pinned before the Agent creates them. In that case,
    // validate the real path of the existing parent directory instead.
    targetReal = join(await realpath(dirname(absolute)), basename(absolute))
  }
  const targetRelative = relative(workspaceReal, targetReal)
  if (!targetRelative || targetRelative === '..' || targetRelative.startsWith(`..${sep}`) || resolve(workspaceReal, targetRelative) !== targetReal) throw new Error('Path must stay inside the selected workspace')
  return rel
}
function makeWindow(): BrowserWindow {
  const dockIconPath = join(app.getAppPath(), 'dist', 'renderer', 'assets', 'narwhal-dock.png')
  const browserWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 640, show: false, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 }, backgroundColor: '#121416', icon: nativeImage.createFromPath(dockIconPath), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)) } })
  if (process.platform === 'darwin') { try { app.dock?.setIcon(nativeImage.createFromPath(dockIconPath)) } catch { /* best-effort */ } }
  browserWindow.webContents.session.setPermissionRequestHandler((_w, _permission, callback) => callback(false)); browserWindow.webContents.session.setPermissionCheckHandler(() => false)
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  browserWindow.webContents.on('will-navigate', (event, url) => { if (url !== appUrl && url !== recoveryUrl) event.preventDefault() })
  browserWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); browserWindow.hide() } }); browserWindow.once('ready-to-show', () => { browserWindow.show(); if (process.env.NARWHAL_DEBUG) browserWindow.webContents.openDevTools() })
  return browserWindow
}
async function loadApp(): Promise<void> { if (!windowRef) windowRef = makeWindow(); await windowRef.loadURL(appUrl) }
async function showRecovery(reason?: Error): Promise<void> {
  agent = { state: 'needs-restart' }; emitAgent(); if (!windowRef) windowRef = makeWindow(); await windowRef.loadURL(recoveryUrl)
  if (reason) { await mkdir(app.getPath('logs'), { recursive: true, mode: 0o700 }); await appendFile(join(app.getPath('logs'), 'startup.log'), `${new Date().toISOString()} ${reason.message}\n`, { encoding: 'utf8', mode: 0o600 }) }
}
async function startHost(): Promise<void> {
  agent = { state: 'starting' }; emitAgent()
  const generation = await getSupervisor().start()
  await hostBridge.start(generation.origin)
  agent = { state: 'ready', origin: generation.origin }; emitAgent()
  const workspace = selected()
  if (workspace) { await hostBridge.listSessions(); if (workspace.selectedSessionId) await hostBridge.selectSession(workspace.selectedSessionId, workspace.path); else hostBridge.clearSelection() }
}

function registerIpc(): void {
  ipcMain.handle('narwhal:bootstrap', async (event) => { sender(event); return { agent, workbench: await snapshot(), settings: desktopSettings() } })
  ipcMain.handle('narwhal:choose-workspace', async (event) => { sender(event); return chooseWorkspace() })
  ipcMain.handle('narwhal:select-workspace', async (event, raw) => { sender(event); const id = asString(asRecord(raw).workspaceId, 'workspaceId', 100); const workspace = requireWorkspace(id); store.selectedWorkspaceId = id; await persist(); if (agent.state === 'ready') { await hostBridge.listSessions(); if (workspace.selectedSessionId) await hostBridge.selectSession(workspace.selectedSessionId, workspace.path); else hostBridge.clearSelection() }; return snapshot() })
  ipcMain.handle('narwhal:rename-workspace', async (event, raw) => { sender(event); const value = asRecord(raw); const id = asString(value.workspaceId, 'workspaceId', 100); const workspace = requireWorkspace(id); const name = asString(value.name, 'workspace name', 120); if (!name) throw new Error('Workspace name is required'); workspace.name = name; await persist(); return snapshot() })
  ipcMain.handle('narwhal:delete-workspace', async (event, raw) => { sender(event); const id = asString(asRecord(raw).workspaceId, 'workspaceId', 100); const workspace = requireWorkspace(id); store.workspaces = store.workspaces.filter((item) => item.id !== id); if (store.selectedWorkspaceId === id) { store.selectedWorkspaceId = store.workspaces[0]?.id } if (workspace.conversations.length && store.workspaces.length === 0) { /* no-op */ } await persist(); return snapshot() })
  ipcMain.handle('narwhal:create-conversation', async (event, raw) => { sender(event); const value = asRecord(raw); const workspace = requireWorkspace(); const now = new Date().toISOString(); const conversation: Conversation = { id: randomUUID(), workspaceId: workspace.id, title: asString(value.title, 'title', 120), goal: asString(value.goal, 'goal', 1200), status: 'active', todos: [], createdAt: now, updatedAt: now }; workspace.conversations.unshift(conversation); workspace.selectedConversationId = conversation.id; await persist(); return snapshot() })
  ipcMain.handle('narwhal:update-conversation', async (event, raw) => { sender(event); const value = asRecord(raw); const workspace = requireWorkspace(); const conversationId = asString(value.conversationId, 'conversationId', 100); const conversation = workspace.conversations.find((item) => item.id === conversationId); if (!conversation) throw new Error('Conversation not found'); const status = value.status; if (status !== undefined && status !== 'active' && status !== 'done') throw new Error('Invalid conversation status'); workspace.conversations = workspace.conversations.map((item) => item.id === conversationId ? { ...item, ...(value.title !== undefined && { title: asString(value.title, 'title', 120) }), ...(value.goal !== undefined && { goal: asString(value.goal, 'goal', 1200) }), ...(status !== undefined && { status: status as ConversationStatus }), updatedAt: new Date().toISOString() } : item); await persist(); return snapshot() })
  ipcMain.handle('narwhal:add-todo', async (event, raw) => { sender(event); const value = asRecord(raw); const workspace = requireWorkspace(); const conversationId = asString(value.conversationId, 'conversationId', 100); const conversation = workspace.conversations.find((item) => item.id === conversationId); if (!conversation) throw new Error('Conversation not found'); const todo: TodoItem = { id: randomUUID(), text: asString(value.text, 'todo text', 240), done: false }; workspace.conversations = workspace.conversations.map((item) => item.id === conversationId ? { ...item, todos: [...item.todos, todo], updatedAt: new Date().toISOString() } : item); await persist(); return snapshot() })
  ipcMain.handle('narwhal:toggle-todo', async (event, raw) => { sender(event); const value = asRecord(raw); const done = value.done; const workspace = requireWorkspace(); const conversationId = asString(value.conversationId, 'conversationId', 100); const conversation = workspace.conversations.find((item) => item.id === conversationId); if (!conversation || typeof done !== 'boolean') throw new Error('Todo not found'); const todoId = asString(value.todoId, 'todoId', 100); if (!conversation.todos.some((item) => item.id === todoId)) throw new Error('Todo not found'); workspace.conversations = workspace.conversations.map((item) => item.id === conversationId ? { ...item, todos: item.todos.map((item) => item.id === todoId ? { ...item, done } : item), updatedAt: new Date().toISOString() } : item); await persist(); return snapshot() })
  ipcMain.handle('narwhal:select-conversation', async (event, raw) => { sender(event); const value = asRecord(raw); const workspace = requireWorkspace(); const id = value.conversationId === undefined ? undefined : asString(value.conversationId, 'conversationId', 100); if (id && !workspace.conversations.some((conversation) => conversation.id === id)) throw new Error('Conversation not found'); workspace.selectedConversationId = id; await persist(); return snapshot() })
  ipcMain.handle('narwhal:set-panel-open', async (event, raw) => { sender(event); const open = asRecord(raw).open; if (typeof open !== 'boolean') throw new Error('Invalid panel state'); const workspace = selected(); if (workspace) workspace.panelOpen = open; else store.panelOpen = open; await persist(); return snapshot() })
  ipcMain.handle('narwhal:pin-deliverable', async (event, raw) => { sender(event); const value = asRecord(raw); const workspace = requireWorkspace(); const relativePath = await verifiedPathWithin(workspace, asString(value.relativePath, 'relative path', 500)); const label = asString(value.label, 'label', 120); workspace.deliverables = [{ relativePath, label, pinnedAt: new Date().toISOString() }, ...workspace.deliverables.filter((item) => item.relativePath !== relativePath)]; await persist(); return snapshot() })
  ipcMain.handle('narwhal:unpin-deliverable', async (event, raw) => { sender(event); const workspace = requireWorkspace(); const relativePath = await verifiedPathWithin(workspace, asString(asRecord(raw).relativePath, 'relative path', 500)); workspace.deliverables = workspace.deliverables.filter((item) => item.relativePath !== relativePath); await persist(); return snapshot() })
  ipcMain.handle('narwhal:reveal-deliverable', async (event, raw) => { sender(event); const workspace = requireWorkspace(); const relativePath = await verifiedPathWithin(workspace, asString(asRecord(raw).relativePath, 'relative path', 500)); if (!workspace.deliverables.some((item) => item.relativePath === relativePath)) throw new Error('Deliverable is not pinned'); shell.showItemInFolder(join(workspace.path, relativePath)) })
  ipcMain.handle('narwhal:list-sessions', async (event) => { sender(event); requireWorkspace(); return hostBridge.listSessions() })
  ipcMain.handle('narwhal:create-session', async (event) => { sender(event); const workspace = requireWorkspace(); const conversation = await hostBridge.createSession(workspace.path); workspace.selectedSessionId = conversation.selectedSessionId; await persist(); return conversation })
  ipcMain.handle('narwhal:select-session', async (event, raw) => { sender(event); const workspace = requireWorkspace(); const sessionId = asString(asRecord(raw).sessionId, 'sessionId', 140); const conversation = await hostBridge.selectSession(sessionId, workspace.path); workspace.selectedSessionId = sessionId; await persist(); return conversation })
  ipcMain.handle('narwhal:send-prompt', async (event, raw) => { sender(event); const workspace = requireWorkspace(); const value = asRecord(raw); const rawText = typeof value.text === 'string' ? value.text.trim() : ''; const rawAttachments = Array.isArray(value.attachments) ? value.attachments : undefined; const attachments: { id: string; name: string; size: number; type: string }[] = []; if (rawAttachments) { for (const att of rawAttachments) { if (!att || typeof att !== 'object') continue; const obj = att as Record<string, unknown>; if (typeof obj.id !== 'string' || typeof obj.name !== 'string') continue; attachments.push({ id: obj.id, name: obj.name, size: typeof obj.size === 'number' ? obj.size : 0, type: typeof obj.type === 'string' ? obj.type : '' }) } } const hasText = rawText.length > 0; const hasAttachments = attachments.length > 0; if (!hasText && !hasAttachments) throw new Error('Message or attachment required'); if (rawText.length > 12_000) throw new Error('Message too long'); const conversation = await hostBridge.prompt(rawText, hasAttachments ? attachments : undefined); workspace.selectedSessionId = conversation.selectedSessionId; await persist(); return conversation })
  ipcMain.handle('narwhal:cancel-prompt', async (event) => { sender(event); await hostBridge.cancel() })
  ipcMain.handle('narwhal:get-agent-configuration', async (event): Promise<AgentConfiguration> => { sender(event); return hostBridge.getConfiguration() })
  ipcMain.handle('narwhal:select-agent-model', async (event, raw): Promise<AgentConfiguration> => { sender(event); const value = asRecord(raw); return hostBridge.selectModel(asString(value.provider, 'provider', 120), asString(value.model, 'model', 160), value.reasoningEffort === undefined ? undefined : asString(value.reasoningEffort, 'reasoning effort', 100)) })
  ipcMain.handle('narwhal:set-default-permission', async (event, raw): Promise<AgentConfiguration> => { sender(event); return hostBridge.setDefaultPermission(asString(asRecord(raw).preset, 'permission preset', 100)) })
  ipcMain.handle('narwhal:set-provider-api-key', async (event, raw): Promise<AgentConfiguration> => { sender(event); const value = asRecord(raw); return hostBridge.setProviderApiKey(asString(value.provider, 'provider', 120), asString(value.value, 'API key', 500)) })
  ipcMain.handle('narwhal:set-provider-base-url', async (event, raw): Promise<AgentConfiguration> => { sender(event); const value = asRecord(raw); return hostBridge.setProviderBaseUrl(asString(value.provider, 'provider', 120), asString(value.value, 'base URL', 600)) })
  ipcMain.handle('narwhal:update-provider', async (event, raw): Promise<AgentConfiguration> => {
    sender(event)
    const value = asRecord(raw)
    const baseUrl = value.baseUrl === undefined ? undefined : asString(value.baseUrl, 'base URL', 600)
    const modelIds = Array.isArray(value.modelIds)
      ? value.modelIds.map((m) => asString(m, 'model ID', 160)).filter(Boolean)
      : undefined
    return hostBridge.updateProvider({
      provider: asString(value.provider, 'provider', 120),
      ...(baseUrl !== undefined && { baseUrl }),
      ...(modelIds !== undefined && { modelIds }),
    })
  })
  ipcMain.handle('narwhal:delete-provider', async (event, raw): Promise<AgentConfiguration> => { sender(event); const value = asRecord(raw); return hostBridge.deleteProvider(asString(value.providerId, 'provider ID', 120)) })
  ipcMain.handle('narwhal:create-provider', async (event, raw): Promise<CreateProviderResult> => {
    sender(event)
    const value = asRecord(raw)
    const modelIds = Array.isArray(value.modelIds)
      ? value.modelIds.map((m) => asString(m, 'model ID', 160)).filter(Boolean)
      : []
    return hostBridge.createProvider({
      id: asString(value.id, 'provider ID', 80),
      displayName: value.displayName === undefined ? undefined : asString(value.displayName, 'display name', 120),
      baseUrl: asString(value.baseUrl, 'base URL', 600),
      protocol: asString(value.protocol, 'API protocol', 80),
      modelIds,
      apiKey: value.apiKey === undefined ? undefined : asString(value.apiKey, 'API key', 500),
    })
  })
  ipcMain.handle('narwhal:retry-agent', async (event) => {
    sender(event, true)
    try { await startHost() } catch (error) {
      const diag = activeSupervisor?.diagnostics() ?? ''
      const msg = `${new Date().toISOString()} retry-agent failed: ${error instanceof Error ? error.message : String(error)}${diag ? '\nSupervisor output:\n' + diag : ''}\n`
      try { await appendFile(join(app.getPath('logs'), 'startup.log'), msg, { encoding: 'utf8', mode: 0o600 }) } catch { /* best-effort */ }
      throw error
    }
  })
}
async function bootstrap(): Promise<void> {
  console.log('[narwhal] bootstrap: registering protocol...')
  registerNarwhalProtocol(); await loadStore(); const dshHome = join(app.getPath('userData'), 'dsh-home'); await mkdir(dshHome, { recursive: true, mode: 0o700 }); selectedRuntime = resolveRuntime()
  console.log('[narwhal] bootstrap: DSH runtime at', selectedRuntime!.root, 'cli:', selectedRuntime!.cliEntry)
  activeSupervisor = createHostSupervisor(() => spawn(app.isPackaged ? process.execPath : (process.env.DSH_NODE_EXECUTABLE ?? 'node'), [...selectedRuntime!.launchArguments, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: selectedRuntime!.root, env: safeEnvironment(dshHome), stdio: 'pipe', windowsHide: true }), () => { void hostBridge.stop(); void showRecovery(new Error('Local Agent stopped unexpectedly')) })
  hostBridge.subscribe((conversation) => { emitConversation(conversation); scheduleWorkbenchRefresh() })
  registerIpc(); tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'dist', 'renderer', 'assets', 'narwhal-tray.png')).resize({ width: 18, height: 18 })); tray.setToolTip('Narwhal'); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show Narwhal', click: () => windowRef?.show() }, { label: 'Quit', click: () => app.quit() }])); tray.on('click', () => windowRef?.show())
  console.log('[narwhal] bootstrap: loading app URL:', appUrl)
  await loadApp();
  console.log('[narwhal] bootstrap: app loaded, starting host...')
  try {
    await startHost()
    console.log('[narwhal] bootstrap: host started successfully')
  } catch (error) {
    console.error('[narwhal] bootstrap: startHost FAILED:', error instanceof Error ? error.message : String(error))
    agent = { state: 'needs-restart' }; emitAgent()
    try {
      const diag = activeSupervisor?.diagnostics() ?? ''
      const msg = `${new Date().toISOString()} startHost failed: ${error instanceof Error ? error.message : String(error)}${diag ? '\nSupervisor output:\n' + diag : ''}\n`
      await appendFile(join(app.getPath('logs'), 'startup.log'), msg, { encoding: 'utf8', mode: 0o600 })
    } catch { /* best-effort logging */ }
  }
}
if (!isPrimaryInstance) app.quit()
  else { app.on('second-instance', () => windowRef?.show()); app.on('window-all-closed', () => undefined); app.on('activate', () => windowRef?.show()); app.on('before-quit', (event) => { if (isQuitting) return; event.preventDefault(); isQuitting = true; const supervisor = activeSupervisor; void hostBridge.stop().finally(() => supervisor?.stop().finally(() => app.quit()) ?? app.quit()) }); void app.whenReady().then(bootstrap).catch(async (error) => showRecovery(error instanceof Error ? error : new Error(String(error)))) }
