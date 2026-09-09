// Lightweight i18n — no heavy deps, works in renderer (React) and main process (Node).
// Usage:
//   import { t, setLang, getLang } from './i18n'
//   t('chat.send')                  // "Send" / "发送"
//   t('workspace.deleteConfirm', { name: 'Demo' })  // "Delete workspace "Demo"?"
//   setLang('zh')                   // switch language
//   const { lang, subscribe } = useI18n()  // React hook for reactive switching

import { en } from './en.js'
import { zh } from './zh.js'

export type Lang = 'en' | 'zh'

const dicts: Record<Lang, Record<string, string>> = { en, zh }
let currentLang: Lang = 'en'

/** Simple event emitter for language-change subscribers (React hooks use this). */
type Listener = (lang: Lang) => void
const listeners = new Set<Listener>()

function emit() {
  for (const fn of listeners) fn(currentLang)
}

/** Get current language code. */
export function getLang(): Lang { return currentLang }

/** Set language. Also writes to localStorage in renderer context. */
export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem('narwhal:lang', lang) } catch { /* ignore */ }
  }
  emit()
}

/**
 * Resolve language from environment. Order:
 * 1. Explicit stored preference (localStorage.getItem('narwhal:lang'))
 * 2. config.json `language` field (passed as arg by main process)
 * 3. System locale (navigator.language / app.getLocale())
 * 4. Fallback: 'en'
 */
export function detectLang(configLang?: string | undefined): Lang {
  // Stored user preference (highest — explicit override)
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('narwhal:lang') as Lang | null
    if (stored && dicts[stored]) return stored
  }
  // Config.json value (from main process)
  if (configLang && dicts[configLang as Lang]) return configLang as Lang
  // System locale
  let sys = ''
  if (typeof navigator !== 'undefined' && navigator.language) sys = navigator.language
  else if (typeof process !== 'undefined' && process.env.LANG) sys = process.env.LANG
  if (sys.toLowerCase().startsWith('zh')) return 'zh'
  return 'en'
}

/**
 * Translate a key, with optional {param} interpolation.
 * Falls back to the key itself when no translation found (never crashes).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dicts[currentLang] ?? dicts.en
  let str = dict[key] ?? dicts.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v))
    }
  }
  return str
}

/** Subscribe to language changes. Returns unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * React hook — returns current language and a setter.
 * Components that call t() should also re-render on lang change.
 *
 * Usage:
 *   function useLang() {
 *     const [lang, setLang] = useState(getLang())
 *     useEffect(() => subscribe(l => setLang(l)), [])
 *     return { lang, setLang: (l: Lang) => { setLang(l); saveConfig({ language: l }) } }
 *   }
 */
export function useLang(): { lang: Lang } {
  // Lazy import — this file must work in main process too
  const React = require('react') as typeof import('react')
  const [lang, set] = React.useState<Lang>(() => getLang())
  React.useEffect(() => subscribe((l) => set(l)), [])
  return { lang }
}
