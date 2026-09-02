// Registry client: MCP Registry + npm plugin catalog + skill discovery
// All network calls happen in the main process so Electron can bypass renderer CORS.

import https from 'node:https'
import http from 'node:http'
import type { BundlePluginCard, McpServerCard, SkillCard } from '../shared/desktop-contract.js'

const MCP_REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1'
const NPM_SEARCH_BASE = 'https://registry.npmjs.org/-/v1/search'

const FETCH_TIMEOUT_MS = 15000

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const transport = parsed.protocol === 'https:' ? https : http
    const req = transport.get(url, { timeout: FETCH_TIMEOUT_MS, headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timed out: ${url}`)) })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// MCP Registry
// ---------------------------------------------------------------------------

export async function searchMcpServers(query: string, limit = 24): Promise<McpServerCard[]> {
  const q = query.trim()
  const url = q
    ? `${MCP_REGISTRY_BASE}/servers?search=${encodeURIComponent(q)}&limit=${limit}`
    : `${MCP_REGISTRY_BASE}/servers?limit=${limit}`
  try {
    const raw = await httpGetJson<any>(url)
    const entries = Array.isArray(raw?.servers) ? raw.servers : Array.isArray(raw) ? raw : []
    const mapped: (McpServerCard | null)[] = entries.map(mapMcpCard)
    return mapped.filter((c: McpServerCard | null): c is McpServerCard => !!c && !!c.displayName).slice(0, limit)
  } catch (err) {
    console.warn('[registry-client] MCP registry search failed:', err instanceof Error ? err.message : err)
    return []
  }
}

function mapMcpCard(raw: any): McpServerCard | null {
  const inner = raw && typeof raw === 'object' && 'server' in raw ? raw.server : raw
  if (!inner || typeof inner !== 'object') return null
  const name: string = inner.name ?? ''
  const title: string = inner.title ?? ''
  const description: string = inner.description ?? ''
  const version: string | undefined = inner.version
  const remotes: any[] = Array.isArray(inner.remotes) ? inner.remotes : []
  const remoteTypes = remotes.map((r: any) => r?.type ?? 'unknown')
  const firstHttp = remotes.find((r: any) => r?.type === 'streamable-http' && typeof r?.url === 'string')
  const firstStdio = remotes.find((r: any) => r?.type === 'stdio')

  // Use name as both identifier and derive a possible package name from it
  const lastSegment = name.includes('/') ? name.split('/').pop()! : name
  const displayName = title || lastSegment || name
  const packageType: 'npm' | 'python' | 'docker' | 'http' | 'unknown' = firstHttp
    ? 'http'
    : firstStdio
      ? firstStdio.packageType ?? 'unknown'
      : 'unknown'

  return {
    name,
    displayName,
    description,
    packageName: firstStdio?.packageName ?? `registry:${name}`,
    packageType: packageType as any,
    version,
    stars: undefined,
    repositoryUrl: undefined,
    tags: remoteTypes,
  }
}

// ---------------------------------------------------------------------------
// npm search for DSH bundle plugins (packages with keyword "dsh-plugin" or "deepseek-harness")
// ---------------------------------------------------------------------------

interface RawNpmSearchItem {
  package: { name: string; description?: string; version?: string; links?: { repository?: string; homepage?: string } }
  score?: { detail?: { popularity?: number } }
  keywords?: string[]
  date?: string
}

export async function searchPlugins(query: string): Promise<BundlePluginCard[]> {
  const q = query.trim() ? `${query} dsh-plugin` : 'dsh-plugin deepseek-harness'
  const url = `${NPM_SEARCH_BASE}?text=${encodeURIComponent(q)}&size=20`
  try {
    const data = await httpGetJson<{ objects?: RawNpmSearchItem[] }>(url)
    const items = Array.isArray(data?.objects) ? data.objects : []
    const deduped = new Map<string, BundlePluginCard>()
    for (const item of items) {
      const pkg = item.package
      if (!pkg || !pkg.name) continue
      // Skip Narwhal-internal packages
      if (pkg.name.startsWith('@narwhal/')) continue
      const keywords = Array.isArray(item.keywords) ? item.keywords : []
      const stars = Math.round((item.score?.detail?.popularity ?? 0) * 1000)
      const card: BundlePluginCard = {
        packageName: pkg.name,
        displayName: pkg.name.replace(/^dsh-/, '').replace(/plugin$/i, '').trim() || pkg.name,
        description: pkg.description ?? '',
        version: pkg.version,
        stars,
        repositoryUrl: pkg.links?.repository,
        bundleIds: extractBundleIds(pkg.name),
        tags: keywords,
      }
      deduped.set(pkg.name, card)
    }
    return Array.from(deduped.values()).filter((c) => c.bundleIds.length > 0 || c.description.includes('dsh') || c.description.includes('plugin'))
  } catch (err) {
    console.warn('[registry-client] npm search failed:', err instanceof Error ? err.message : err)
    return []
  }
}

function extractBundleIds(packageName: string): string[] {
  // Heuristic: bundle IDs are usually derived from the package name
  // e.g. "dshmarket" -> ["dshmarket"], "@deepseek-ai/dsh-web-app" -> ["dsh-web-app"]
  const base = packageName.split('/').pop() ?? packageName
  return [base]
}

// ---------------------------------------------------------------------------
// Skill discovery: scan filesystem for SKILL.md files
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_SKILL_ROOTS = [
  '.agents/skills',
  '.dsh/skills',
  '.trae/skills',
]

export function discoverSkills(customRoots: string[] = [], workspaceRoot?: string): SkillCard[] {
  const cards: SkillCard[] = []
  const roots: { dir: string; source: SkillCard['source'] }[] = []

  // Project-local skills (scan workspace)
  if (workspaceRoot) {
    for (const rel of DEFAULT_SKILL_ROOTS) {
      const dir = path.join(workspaceRoot, rel)
      roots.push({ dir, source: 'builtin' })
    }
  }
  // Custom roots from config
  for (const dir of customRoots) {
    roots.push({ dir, source: 'custom' })
  }

  for (const { dir, source } of roots) {
    if (!fs.existsSync(dir)) continue
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skillDir = path.join(dir, entry.name)
        const skillFile = path.join(skillDir, 'SKILL.md')
        if (!fs.existsSync(skillFile)) continue
        const content = fs.readFileSync(skillFile, 'utf8')
        const parsed = parseSkillMd(content)
        cards.push({
          id: `${source}:${entry.name}`,
          name: parsed.name ?? entry.name,
          description: parsed.description ?? '',
          source,
          location: skillFile,
          installed: true,
          tags: parsed.tags,
        })
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return cards
}

function parseSkillMd(content: string): { name?: string; description?: string; tags: string[] } {
  const result: { name?: string; description?: string; tags: string[] } = { tags: [] }
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (frontmatter) {
    const block = frontmatter[1]
    const nameMatch = block.match(/^name:\s*(.+)$/m)
    const descMatch = block.match(/^description:\s*(.+)$/m)
    if (nameMatch) result.name = nameMatch[1].trim().replace(/['"]/g, '')
    if (descMatch) result.description = descMatch[1].trim().replace(/['"]/g, '')
  }
  return result
}
