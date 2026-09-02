// Integrations settings panels: MCP Servers, Runtime Extensions, Skills
import { useEffect, useState, useMemo } from 'react'
import type { BundlePluginCard, InstalledPlugin, McpServer, McpServerCard, NarwhalBridge, SkillCard } from '../shared/desktop-contract'

// Delay window.narwhal resolution until call time — avoids module-init ordering races
// where integrations.tsx loads before mock-bridge.js has set window.narwhal.
const getApi = (): NarwhalBridge => {
  const bridge = (typeof window !== 'undefined' ? (window as any).narwhal : undefined) as NarwhalBridge | undefined
  if (!bridge) throw new Error('Narwhal bridge is not ready')
  return bridge
}

// --- MCP Servers Tab ---

type TransportKind = 'stdio' | 'streamable-http'

export function McpServersTab() {
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<McpServerCard[]>([])
  const [installed, setInstalled] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  // Custom MCP form state
  const [customOpen, setCustomOpen] = useState(false)
  const [customTransport, setCustomTransport] = useState<TransportKind>('stdio')
  const [customName, setCustomName] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customArgs, setCustomArgs] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [customCwd, setCustomCwd] = useState('')
  const [customEnv, setCustomEnv] = useState('')
  const [customHeaders, setCustomHeaders] = useState('')
  const [customSubmitting, setCustomSubmitting] = useState(false)

  const refreshInstalled = async () => {
    try { setInstalled((await getApi().listInstalledMcpServers()) as McpServer[]) } catch { /* ignore */ }
  }

  useEffect(() => { void refreshInstalled() }, [])

  const runSearch = async () => {
    setLoading(true); setNotice('')
    try {
      const results = await getApi().searchMcpServers(query, 30)
      setCards(results as McpServerCard[])
      if (!results.length) setNotice(query ? `No public MCP servers match "${query}".` : 'Could not reach the MCP registry.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Search failed')
    } finally { setLoading(false) }
  }

  useEffect(() => { void runSearch() }, [])

  const handleInstall = async (card: McpServerCard) => {
    setInstalling(card.packageName); setNotice('')
    // Derive serverName from the registry name (e.g. "io.github.xxx/github-server" → "github")
    const derivedName = card.name.split('/').pop()?.replace(/^server-/, '') ?? card.displayName.toLowerCase().replace(/\s+/g, '-')
    const server: McpServer = {
      serverName: derivedName.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '_'),
      transport: 'stdio',
      command: card.packageType === 'npm' ? 'npx' : card.packageType === 'python' ? 'uvx' : 'docker',
      args: card.packageType === 'npm'
        ? ['-y', card.packageName]
        : card.packageType === 'python'
          ? [card.packageName]
          : ['run', '-i', '--rm', card.packageName],
    }
    try {
      const result = await getApi().installMcpServer(server)
      setNotice(result.ok ? `✓ ${result.message}` : `✗ ${result.message ?? 'Install failed'}`)
      if (result.ok) {
        setQuery('')
        void refreshInstalled()
      }
    } finally { setInstalling(null) }
  }

  // Parse "k=v\nk2=v2" or JSON "{...}" → Record<string,string>
  const parseKeyValue = (raw: string): Record<string, string> | undefined => {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed)
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') out[k] = v
        }
        return out
      } catch { /* fall through */ }
    }
    const out: Record<string, string> = {}
    for (const line of trimmed.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/)
      if (m) out[m[1]] = m[2].trim()
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  const handleCustomInstall = async () => {
    const name = customName.trim().slice(0, 32)
    if (!name) { setNotice('Server name is required'); return }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) { setNotice('Server name: letters, digits, - _ only'); return }

    setCustomSubmitting(true); setNotice('')
    try {
      let server: McpServer
      if (customTransport === 'stdio') {
        const cmd = customCommand.trim()
        if (!cmd) { setNotice('Command is required for stdio MCP'); return }
        server = {
          serverName: name,
          transport: 'stdio',
          command: cmd,
          args: customArgs.trim() ? customArgs.trim().split(/\s+/) : [],
          ...(customCwd.trim() && { cwd: customCwd.trim() }),
          ...(parseKeyValue(customEnv) && { env: parseKeyValue(customEnv)! }),
        }
      } else {
        const url = customUrl.trim()
        if (!url) { setNotice('URL is required for HTTP MCP'); return }
        server = {
          serverName: name,
          transport: 'streamable-http',
          url,
          ...(parseKeyValue(customHeaders) && { headers: parseKeyValue(customHeaders)! }),
        }
      }

      const result = await getApi().installMcpServer(server)
      setNotice(result.ok ? `✓ ${result.message}` : `✗ ${result.message ?? 'Install failed'}`)
      if (result.ok) {
        // Reset form
        setCustomOpen(false)
        setCustomName(''); setCustomCommand(''); setCustomArgs('')
        setCustomUrl(''); setCustomCwd('')
        setCustomEnv(''); setCustomHeaders('')
        void refreshInstalled()
      }
    } finally { setCustomSubmitting(false) }
  }

  const handleUninstall = async (serverName: string) => {
    if (!window.confirm(`Remove MCP server "${serverName}"?`)) return
    const result = await getApi().uninstallMcpServer(serverName)
    setNotice(result.ok ? `✓ ${result.message}` : `✗ ${result.message ?? 'Remove failed'}`)
    if (result.ok) void refreshInstalled()
  }

  const installedNames = useMemo(() => new Set(installed.map((s) => s.serverName)), [installed])

  return <section className="settings-page integrations-page">
    <div className="settings-page-intro">
      <p>MCP Servers</p>
      <small>Model Context Protocol servers extend the Agent with external tools. Search the public registry and install with one click.</small>
    </div>

    {/* Installed section */}
    {installed.length > 0 && (
      <div className="integrations-section">
        <h3>Installed</h3>
        <div className="mcp-list">
          {installed.map((s) => (
            <article key={s.serverName} className="mcp-row">
              <div className="mcp-row-info">
                <strong>{s.serverName}</strong>
                <small>{s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}` : `${s.url}`}</small>
              </div>
              <button className="primary danger" onClick={() => handleUninstall(s.serverName)}>Remove</button>
            </article>
          ))}
        </div>
      </div>
    )}

    {/* Add Custom MCP section */}
    <div className="integrations-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3>Add Custom MCP Server</h3>
        <button className="primary" onClick={() => setCustomOpen((v) => !v)}>
          {customOpen ? 'Close' : '+ Add Custom'}
        </button>
      </div>
      {customOpen && (
        <div className="custom-mcp-form" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--settings-card-bg, #1a1a2e)', borderRadius: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Transport:</span>
            <select value={customTransport} onChange={(e) => setCustomTransport(e.target.value as TransportKind)}
              style={{ padding: '4px 8px', borderRadius: 4 }}>
              <option value="stdio">stdio (local process)</option>
              <option value="streamable-http">streamable-http (remote URL)</option>
            </select>
          </label>
          <label>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Server Name</span>
            <input className="search-input" style={{ width: '100%' }}
              placeholder="my-mcp (letters, digits, - _ only)"
              value={customName} onChange={(e) => setCustomName(e.target.value)}
              maxLength={32} />
          </label>
          {customTransport === 'stdio' ? (
            <>
              <label>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Command</span>
                <input className="search-input" style={{ width: '100%' }}
                  placeholder="npx / node / python3 / /path/to/binary"
                  value={customCommand} onChange={(e) => setCustomCommand(e.target.value)} />
              </label>
              <label>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Args (space-separated)</span>
                <input className="search-input" style={{ width: '100%' }}
                  placeholder="-y @modelcontextprotocol/server-filesystem"
                  value={customArgs} onChange={(e) => setCustomArgs(e.target.value)} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label>
                  <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>CWD (optional)</span>
                  <input className="search-input" style={{ width: '100%' }}
                    placeholder="/path/to/working/dir"
                    value={customCwd} onChange={(e) => setCustomCwd(e.target.value)} />
                </label>
                <label>
                  <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Env Vars (k=v lines or JSON)</span>
                  <textarea className="search-input" style={{ width: '100%', minHeight: 60 }}
                    placeholder={`API_KEY={env:MY_API_KEY}\nDEBUG=true`}
                    value={customEnv} onChange={(e) => setCustomEnv(e.target.value)} />
                </label>
              </div>
            </>
          ) : (
            <>
              <label>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>URL</span>
                <input className="search-input" style={{ width: '100%' }}
                  placeholder="https://api.example.com/mcp"
                  value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
              </label>
              <label>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Headers (k=v lines or JSON, optional)</span>
                <textarea className="search-input" style={{ width: '100%', minHeight: 60 }}
                  placeholder={`Authorization=Bearer {env:MY_TOKEN}\nContent-Type=application/json`}
                  value={customHeaders} onChange={(e) => setCustomHeaders(e.target.value)} />
              </label>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button className="primary danger" onClick={() => {
              setCustomOpen(false); setCustomName(''); setCustomCommand(''); setCustomArgs('')
              setCustomUrl(''); setCustomCwd(''); setCustomEnv(''); setCustomHeaders('')
            }}>Reset</button>
            <button className="primary" onClick={() => void handleCustomInstall()} disabled={customSubmitting}>
              {customSubmitting ? 'Adding…' : 'Add MCP Server'}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Search section */}
    <div className="integrations-section">
      <h3>Browse</h3>
      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Search MCP servers (e.g. github, filesystem, google drive)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
        />
        <button className="primary" onClick={() => void runSearch()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {notice && <p className="settings-notice" role="status">{notice}</p>}
      {loading ? (
        <p className="settings-empty">Loading from MCP registry…</p>
      ) : (
        <div className="card-grid">
          {cards.map((card) => {
            const installedThis = installedNames.has(card.name.split('/').pop()?.replace(/^server-/, '')?.toLowerCase() ?? '') || installedNames.has(card.name)
            return (
              <article key={card.name} className="card">
                <header className="card-head">
                  <div>
                    <strong>{card.displayName}</strong>
                    <small>{card.name}</small>
                  </div>
                  {card.stars !== undefined && <span className="card-stars">★ {card.stars}</span>}
                </header>
                <p className="card-desc">{card.description || 'No description available.'}</p>
                <footer className="card-foot">
                  <span className={`tag tag-${card.packageType}`}>{card.packageType}</span>
                  {card.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
                  <div className="card-actions">
                    {card.repositoryUrl && <a className="card-link" href={card.repositoryUrl} target="_blank" rel="noreferrer">Source</a>}
                    <button
                      className="primary"
                      onClick={() => void handleInstall(card)}
                      disabled={installing === card.packageName || installedThis}
                    >
                      {installedThis ? 'Installed' : installing === card.packageName ? 'Installing…' : 'Install'}
                    </button>
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      )}
    </div>
  </section>
}

// --- Runtime Extensions Tab ---

export function PluginsTab() {
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<BundlePluginCard[]>([])
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const refreshInstalled = async () => {
    try { setInstalled((await getApi().listInstalledPlugins()) as InstalledPlugin[]) } catch { /* ignore */ }
  }

  useEffect(() => { void refreshInstalled() }, [])

  const runSearch = async () => {
    setLoading(true); setNotice('')
    try {
      const results = await getApi().searchPlugins(query)
      setCards(results as BundlePluginCard[])
      if (!results.length) setNotice(query ? `No DSH bundle plugins match "${query}".` : 'npm registry unreachable — showing no results.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Search failed')
    } finally { setLoading(false) }
  }

  useEffect(() => { void runSearch() }, [])

  const handleInstall = async (pkg: string) => {
    setInstalling(pkg); setNotice('')
    const result = await getApi().installPlugin(pkg)
    if (result.ok) {
      setNotice(result.logs ? `✓ Installed ${pkg}\n${result.logs.join('\n')}` : `✓ Installed ${pkg}`)
      void refreshInstalled()
    } else {
      setNotice(`✗ ${result.message ?? 'Install failed'}\n${result.logs?.join('\n') ?? ''}`)
    }
    setInstalling(null)
  }

  const handleUninstall = async (pkg: string) => {
    if (!window.confirm(`Uninstall "${pkg}"? This removes its bundle from the DSH profile.`)) return
    const result = await getApi().uninstallPlugin(pkg)
    setNotice(result.ok ? `✓ ${result.message}` : `✗ ${result.message ?? 'Remove failed'}`)
    if (result.ok) void refreshInstalled()
  }

  const installedNames = useMemo(() => new Set(installed.map((p) => p.packageName)), [installed])

  return <section className="settings-page integrations-page">
    <div className="settings-page-intro">
      <p>Runtime Extensions</p>
      <small>DSH framework-level extensions. These are Cordis plugin bundles that add new capabilities to the Agent runtime itself — e.g. sandbox shells, credential management, session tracking. Not skill/mcp collections; they are the framework that loads skills and MCPs.</small>
    </div>

    {installed.length > 0 && (
      <div className="integrations-section">
        <h3>Installed</h3>
        <div className="mcp-list">
          {installed.map((p) => (
            <article key={p.packageName} className="mcp-row">
              <div className="mcp-row-info" title={p.location}>
                <strong>{p.packageName}</strong>
                <small>v{p.version}</small>
              </div>
              <button className="primary danger" onClick={() => handleUninstall(p.packageName)}>Uninstall</button>
            </article>
          ))}
        </div>
      </div>
    )}

    <div className="integrations-section">
      <h3>Browse npm</h3>
      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Search DSH plugins on npm…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
        />
        <button className="primary" onClick={() => void runSearch()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {notice && <pre className="settings-notice pre-wrap" role="status">{notice}</pre>}
      {loading ? (
        <p className="settings-empty">Searching npm…</p>
      ) : (
        <div className="card-grid">
          {cards.map((card) => {
            const isInstalled = installedNames.has(card.packageName)
            return (
              <article key={card.packageName} className="card">
                <header className="card-head">
                  <div>
                    <strong>{card.displayName}</strong>
                    <small>{card.packageName}</small>
                  </div>
                  {card.stars !== undefined && <span className="card-stars">★ {card.stars}</span>}
                </header>
                <p className="card-desc">{card.description || 'No description available.'}</p>
                <footer className="card-foot">
                  {card.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
                  <div className="card-actions">
                    {card.repositoryUrl && <a className="card-link" href={card.repositoryUrl} target="_blank" rel="noreferrer">Source</a>}
                    <button
                      className="primary"
                      onClick={() => void handleInstall(card.packageName)}
                      disabled={installing === card.packageName || isInstalled}
                    >
                      {isInstalled ? 'Installed' : installing === card.packageName ? 'Installing…' : 'Install'}
                    </button>
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      )}
    </div>
  </section>
}

// --- Skills Tab ---

export function SkillsTab() {
  const [skills, setSkills] = useState<SkillCard[]>([])
  const [loading, setLoading] = useState(false)
  const [newSkillUrl, setNewSkillUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try { setSkills((await getApi().listSkills()) as SkillCard[]) } catch (err) { setNotice(err instanceof Error ? err.message : 'Failed to load skills') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  const handleAddFromUrl = async () => {
    if (!newSkillUrl.trim()) return
    const result = await getApi().installSkillFromUrl(newSkillUrl.trim())
    setNotice(result.ok ? `✓ ${result.message}` : `✗ ${result.message ?? 'Install failed'}`)
    if (result.ok) { setNewSkillUrl(''); void refresh() }
  }

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remove this skill?')) return
    setRemoving(id)
    const result = await getApi().removeSkill(id)
    setNotice(result.ok ? `✓ ${result.message}` : `✗ ${result.message ?? 'Remove failed'}`)
    if (result.ok) void refresh()
    setRemoving(null)
  }

  const sourceLabel: Record<SkillCard['source'], string> = {
    builtin: 'Built-in',
    custom: 'Custom',
    market: 'Market',
  }

  return <section className="settings-page integrations-page">
    <div className="settings-page-intro">
      <p>Skills</p>
      <small>Skills are Markdown instruction files that extend the Agent's behavior. Add them from URLs or Git repositories.</small>
    </div>

    <div className="integrations-section">
      <h3>Add skill</h3>
      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Paste a SKILL.md raw URL or GitHub repo URL…"
          value={newSkillUrl}
          onChange={(e) => setNewSkillUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleAddFromUrl()}
        />
        <button className="primary" onClick={() => void handleAddFromUrl()} disabled={!newSkillUrl.trim()}>Add</button>
      </div>
      {notice && <p className="settings-notice" role="status">{notice}</p>}
    </div>

    <div className="integrations-section">
      <h3>Installed ({skills.length})</h3>
      {loading ? (
        <p className="settings-empty">Scanning skill directories…</p>
      ) : skills.length === 0 ? (
        <p className="settings-empty">No skills found. Add one from a URL above, or create a SKILL.md in ~/.config/narwhal/skills/.</p>
      ) : (
        <div className="card-grid">
          {skills.map((skill) => (
            <article key={skill.id} className="card skill-card">
              <header className="card-head">
                <div>
                  <strong>{skill.name}</strong>
                  <small>{skill.id}</small>
                </div>
                <span className={`tag tag-${skill.source}`}>{sourceLabel[skill.source]}</span>
              </header>
              {skill.description && <p className="card-desc">{skill.description}</p>}
              <footer className="card-foot">
                {skill.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                <div className="card-actions">
                  <button
                    className="primary danger"
                    onClick={() => void handleRemove(skill.id)}
                    disabled={removing === skill.id || skill.source === 'builtin'}
                    title={skill.source === 'builtin' ? 'Built-in skills cannot be removed' : ''}
                  >
                    {skill.source === 'builtin' ? 'Built-in' : removing === skill.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  </section>
}
