// English strings — semantic keys, English value as the actual string.
// Keys use lowercase.dotted.path (e.g. "settings.title").
// Values may use {param} placeholders for dynamic values.

export const en: Record<string, string> = {
  // ── Workbench ──────────────────────────────────────
  'workspace.title': 'Workspaces',
  'workspace.new': 'New workspace',
  'workspace.newFolder': 'New folder',
  'workspace.delete': 'Delete workspace',
  'workspace.deleteConfirm': 'Delete workspace "{name}"? This action also removes all its saved sessions and cannot be undone.',
  'workspace.empty': 'No workspace open',
  'workspace.emptyHint': 'Create or open a local folder to start chatting with your Agent.',

  // ── Session ────────────────────────────────────────
  'session.new': 'New session',
  'session.delete': 'Delete session',
  'session.deleteConfirm': 'Delete session "{name}"?',
  'session.rename': 'Rename session',
  'session.empty': 'No session selected',
  'session.emptyHint': 'Start a new session or pick one from the sidebar.',

  // ── Chat / Composer ────────────────────────────────
  'chat.send': 'Send',
  'chat.inputPlaceholder': 'Message Narwhal…',
  'chat.stop': 'Stop',
  'chat.attach': 'Add attachment',
  'chat.empty': 'Start chatting',
  'chat.emptyHint': 'Pick a workspace and a session, then describe what you need.',
  'chat.generating': 'Narwhal is thinking…',

  // ── Errors ─────────────────────────────────────────
  'agent.needsAttention': 'Agent needs attention',
  'agent.connectionError': 'Connection error. Check that the provider base URL is reachable and the API key is valid.',
  'agent.error': 'Error',
  'agent.retry': 'Retry',

  // ── Settings ───────────────────────────────────────
  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.language': 'Language',
  'settings.language.auto': 'System default',
  'settings.language.en': 'English',
  'settings.language.zh': '简体中文',
  'settings.theme': 'Appearance',
  'settings.theme.title': 'Theme',
  'settings.theme.auto': 'Auto',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.tab.models': 'Models',
  'settings.tab.providers': 'Providers',
  'settings.tab.permissions': 'Permissions',
  'settings.tab.runtime': 'Runtime',
  'settings.tab.mcp': 'MCP Servers',
  'settings.tab.plugins': 'Runtime Extensions',
  'settings.tab.skills': 'Skills',

  // ── Providers ───────────────────────────────────────
  'providers.title': 'Providers',
  'providers.add': 'Add provider',
  'providers.name': 'Display name',
  'providers.id': 'Provider ID',
  'providers.baseUrl': 'Base URL',
  'providers.apiKey': 'API key',
  'providers.apiKeyMissing': 'API key not set',
  'providers.apiKeySet': 'API key configured',
  'providers.apiKeyPlaceholder': 'Paste API key here…',
  'providers.save': 'Save changes',
  'providers.deleting': 'Deleting…',
  'providers.delete': 'Delete',
  'providers.deleteConfirm': 'Delete provider "{name}"? This action cannot be undone.',
  'providers.active': 'Active',
  'providers.inactive': 'Not active',
  'providers.models': 'Models',
  'providers.protocol': 'Protocol',

  // ── Integrations ───────────────────────────────────
  'integrations.searchPlaceholder': 'Search…',
  'integrations.install': 'Install',
  'integrations.installed': 'Installed',
  'integrations.uninstall': 'Uninstall',
  'integrations.addCustom': 'Add custom',
  'integrations.refresh': 'Refresh',
  'integrations.empty': 'No results',

  // ── Status bar ──────────────────────────────────────
  'status.ready': 'Ready',
  'status.starting': 'Starting…',
  'status.error': 'Error',
  'status.stopped': 'Stopped',

  // ── Context menu / common ──────────────────────────
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.rename': 'Rename',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.search': 'Search',
  'common.filter': 'Filter / Sort',
  'common.loading': 'Loading…',
}
