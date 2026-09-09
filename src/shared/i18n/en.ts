// English strings — semantic keys, English value as the actual string.
// Keys use lowercase.dotted.path (e.g. "settings.title").
// Values may use {param} placeholders for dynamic values.

export const en: Record<string, string> = {
  // ── Brand / Product ─────────────────────────────────
  'brand.subtitle': 'Based on DeepSeek Harness',
  'brand.name': 'Narwhal',

  // ── Workbench / Sidebar ──────────────────────────────
  'workspace.title': 'Workspaces',
  'workspace.new': 'New workspace',
  'workspace.newFolder': 'New folder',
  'workspace.delete': 'Delete workspace',
  'workspace.deleteConfirm': 'Delete workspace "{name}"? This action also removes all its saved sessions and cannot be undone.',
  'workspace.empty': 'No workspace open',
  'workspace.emptyHint': 'Create or open a local folder to start chatting with your Agent.',
  'workspace.open': 'Open workspace',
  'workspace.addDots': 'Add workspace…',
  'workspace.options': 'Workspace options',
  'workspace.groupBy': 'Group by',
  'workspace.orderBy': 'Order by',
  'workspace.folderEmpty': 'Open a local folder to begin.',
  'workspace.subagentManage': 'Manage subagents',
  'workspace.subagentCreateDots': 'Create subagent…',

  // ── Session ────────────────────────────────────────
  'session.new': 'New session',
  'session.newCap': 'New Session',
  'session.delete': 'Delete session',
  'session.deleteConfirm': 'Delete session "{name}"?',
  'session.rename': 'Rename session',
  'session.empty': 'No sessions yet.',
  'session.loadMore': 'Load more',

  // ── Chat / Composer ────────────────────────────────
  'chat.send': 'Send',
  'chat.sendAria': 'Send message',
  'chat.inputPlaceholder': 'Message Narwhal…',
  'chat.stop': 'Stop',
  'chat.stopAria': 'Stop generation',
  'chat.attach': 'Add attachment',
  'chat.attachTitle': 'Add attachment',
  'chat.empty': 'Start chatting',
  'chat.emptyHint': 'Pick a workspace and a session, then describe what you need.',
  'chat.generating': 'Narwhal is thinking…',
  'chat.writing': 'Writing',
  'chat.commands': 'Commands',
  'chat.commandsAria': 'Slash commands',
  'chat.apiKeyRequired': 'API key required',
  'chat.apiKeyConfigure': 'Configure',

  // ── Chat controls ────────────────────────────────────
  'chat.convTitleAria': 'Conversation title',
  'chat.convGoalAria': 'Conversation goal',
  'chat.addStepAria': 'Add step',
  'chat.addStepPlaceholder': 'Add a step',
  'chat.plan': 'Plan',
  'chat.markComplete': 'Mark conversation complete',
  'chat.noSteps': 'No steps yet.',
  'chat.createFirst': 'Create the first conversation',

  // ── Chat controls (dropdowns / popovers) ─────────────
  'chat.permissionTitle': 'Set default conversation permission',
  'chat.permissionAria': 'Conversation permission',
  'chat.switchProviderTitle': 'Switch provider and model',
  'chat.modelSelectionAria': 'Model selection',
  'chat.modelUnavailable': 'Model unavailable',
  'chat.reasoningEffortTitle': 'Adjust reasoning effort',
  'chat.reasoningEffortAria': 'Reasoning effort',

  // ── Empty states / Welcome ───────────────────────────
  'welcome.localWorkspace': 'Your local workspace',
  'welcome.localWorkspaceSub': 'Give your agent a place to work.',
  'welcome.localWorkspaceHint': 'Open a project folder. Narwhal keeps conversations and deliverables on this Mac, separate from your code.',
  'welcome.readyWhenYouAre': 'Ready when you are',
  'welcome.startLocal': 'Start a local conversation.',
  'welcome.startLocalHint': 'Narwhal will create an Agent session for this workspace. Your work context stays in this app.',
  'welcome.newConversation': 'New conversation',
  'welcome.localAgent': 'Local agent',
  'welcome.restartAgent': 'Restart agent',

  // ── Changed files / Deliverables ────────────────────
  'chat.changedFiles': 'Changed files',
  'chat.noLocalChanges': 'No local changes detected.',
  'chat.deliverables': 'Deliverables',
  'chat.pinOutputFile': 'Pin an output file',
  'chat.pinPath': 'Relative file path',
  'chat.pinPathPlaceholder': 'release/Narwhal.dmg',
  'chat.pinLabel': 'Label',
  'chat.pinLabelPlaceholder': 'macOS build',
  'chat.pinFile': 'Pin file',
  'chat.pinDeliverableTitle': 'Pin deliverable',

  // ── Trajectory ──────────────────────────────────────
  'trajectory.tabChat': 'Chat',
  'trajectory.tabTrajectory': 'Trajectory',
  'trajectory.empty': 'Trajectory will appear here.',
  'trajectory.emptyHint': 'Agent execution events — turns, tool calls, context updates — appear here as they happen.',

  // ── Work context panel ───────────────────────────────
  'context.title': 'Work context',
  'context.hint': 'Choose a workspace to keep its plan, changed files and deliverables together.',
  'context.closePanel': 'Close panel',
  'context.closeAria': 'Close work context',
  'context.toggleAria': 'Toggle work context',

  // ── Status bar / Metrics ──────────────────────────────
  'status.metricsAria': 'Run metrics',
  'status.turns': 'turns',
  'status.llm': 'LLM',
  'status.ttftAvg': 'TTFT avg',
  'status.tokPerSec': 'tok/s',
  'status.cacheHit': 'Cache hit',
  'status.input': 'Input',
  'status.output': 'Output',
  'status.ready': 'Ready',
  'status.starting': 'Starting…',
  'status.error': 'Error',
  'status.stopped': 'Stopped',

  // ── Errors ─────────────────────────────────────────
  'agent.needsAttention': 'Agent needs attention',
  'agent.connectionError': 'Connection error. Check that the provider base URL is reachable and the API key is valid.',
  'agent.error': 'Error',
  'agent.retry': 'Retry',
  'agent.providersNeedKey': 'One or more providers need an API key',

  // ── Resize / Misc ─────────────────────────────────────
  'misc.dragToResize': 'Drag to resize · Double-click to reset',
  'misc.dismiss': 'Dismiss',
  'misc.searchAria': 'Search',
  'misc.filterAria': 'Filter',
  'misc.filterSortTitle': 'Filter / Sort',

  // ── Settings (top level) ──────────────────────────────
  'settings.title': 'Settings',
  'settings.localWorkbench': 'Local workbench',
  'settings.close': 'Close settings',
  'settings.closeAria': 'Close settings',
  'settings.sectionsAria': 'Settings sections',
  'settings.language': 'Language',
  'settings.language.auto': 'System default',
  'settings.language.en': 'English',
  'settings.language.zh': '简体中文',

  // Appearance / Theme
  'settings.theme': 'Appearance',
  'settings.theme.intro': 'Choose how Narwhal looks on your screen.',
  'settings.theme.title': 'Theme',
  'settings.theme.sub': 'Pick a color scheme that works for you.',
  'settings.theme.auto': 'Auto',
  'settings.theme.autoDesc': 'Follow your system appearance',
  'settings.theme.dark': 'Dark',
  'settings.theme.darkDesc': 'Always use dark theme',
  'settings.theme.light': 'Light',
  'settings.theme.lightDesc': 'Always use light theme',

  // Settings nav tabs (per-tab labels shown in settings sidebar)
  'settings.tab.models': 'Models',
  'settings.tab.providers': 'Providers',
  'settings.tab.permissions': 'Permissions',
  'settings.tab.mcp': 'MCP Servers',
  'settings.tab.plugins': 'Runtime Extensions',
  'settings.tab.skills': 'Skills',
  'settings.tab.runtime': 'Runtime',

  // Settings nav tabs (group titles)
  'settings.group.agent': 'AGENT',
  'settings.group.integrations': 'INTEGRATIONS',
  'settings.group.system': 'SYSTEM',

  // ── Settings → Models ────────────────────────────────
  'settings.models.activeModel': 'Active model',
  'settings.models.activeModelSub': 'This choice applies to the current conversation and becomes the default for new conversations.',
  'settings.models.provider': 'Provider',
  'settings.models.model': 'Model',
  'settings.models.reasoningEffort': 'Reasoning effort',
  'settings.models.noneAvailable': 'No models are currently available from the local Host.',

  // Create provider form extras
  'providers.createButton': 'Create provider',
  'providers.creating': 'Creating…',
  'providers.removeModel': 'Remove model',
  'providers.notAvailable': 'Custom providers are not available from this local Host.',

  // Row actions / other misc settings
  'common.customize': 'Customize',

  // ── Settings → Providers ─────────────────────────────
  'settings.providers.title': 'Providers',
  'settings.providers.wroteOnly': 'Credentials remain write-only. Add a compatible route from the local Host schema.',
  'settings.providers.add': 'Add provider',
  'settings.providers.noneAvailable': 'No configurable providers are available from the local Agent.',
  'settings.providers.newCustom': 'New custom provider',
  'settings.providers.closeFormAria': 'Close provider form',
  'settings.providers.newCustomHint': 'Profile and model are created together. API key is optional.',
  'settings.providers.providerId': 'Provider ID',
  'settings.providers.providerIdPlaceholder': 'my-provider',
  'settings.providers.providerIdImmutable': 'Provider ID cannot be changed after creation.',
  'settings.providers.displayName': 'Display name (optional)',
  'settings.providers.displayNamePlaceholder': 'My Provider',
  'settings.providers.baseUrl': 'Base URL',
  'settings.providers.baseUrlPlaceholder': 'https://api.example.com/v1',
  'settings.providers.baseUrlFallbackPlaceholder': 'https://api.example.com',
  'settings.providers.apiProtocol': 'API protocol',
  'settings.providers.modelIds': 'Model IDs (at least one required)',
  'settings.providers.modelPlaceholder': 'e.g. my-model-v1',
  'settings.providers.addAnotherModel': '+ Add another model',
  'settings.providers.addModel': '+ Add model',
  'settings.providers.apiKeyOptional': 'API key (optional)',
  'settings.providers.apiKeyPlaceholder': 'Stored write-only after the profile is created',
  'settings.providers.selectModel': 'Select model',
  'settings.providers.delete': 'Delete',
  'settings.providers.deleteTitle': 'Delete provider',
  'settings.providers.saveKey': 'Save key',
  'settings.providers.saveChanges': 'Save changes',

  // ── Settings → Permissions ───────────────────────────
  'settings.permissions.newConvPerm': 'New conversation permission',
  'settings.permissions.newConvPermSub': 'This default is used by new conversations. It does not alter the current conversation.',
  'settings.permissions.unavailable': 'Permission presets are unavailable from this Host.',
  'settings.permissions.fullConfirm': 'Full access can allow unrestricted local tool operations. Continue?',

  // ── Settings → Runtime ───────────────────────────────
  'settings.runtime.localAgent': 'Local Agent runtime',
  'settings.runtime.appVersion': 'App version',
  'settings.runtime.runtime': 'Runtime',
  'settings.runtime.workbenchData': 'Workbench data',
  'settings.runtime.restartAgent': 'Restart Agent',
  'settings.runtime.startingAgent': 'Starting Agent…',
  'settings.runtime.agentReady': 'Agent ready',
  'settings.runtime.agentStarting': 'Starting agent',
  'settings.runtime.agentNeedsRestart': 'Agent needs restart',

  // Provider row status labels
  'settings.providers.statusAvailable': 'Available',
  'settings.providers.statusInactive': 'Inactive',
  'settings.providers.statusKeyManaged': 'Key managed',
  'settings.providers.statusNoKeyEditor': 'No key editor',
  'settings.providers.statusCustomEndpoint': 'Custom endpoint',
  'settings.providers.modelCountNone': 'No models',
  'settings.providers.modelCountOne': '1 model',
  'settings.providers.modelCountMany': '{count} models',
  'settings.providers.creating': 'Creating…',
  'settings.providers.createProvider': 'Create provider',
  'settings.providers.removeModelAria': 'Remove model {index}',
  'settings.providers.notAvailable': 'Custom providers are not available from this local Host.',
  'settings.providers.configured': 'Configured',
  'settings.providers.needsKey': 'Needs key',
  'settings.providers.configure': 'Configure',
  'settings.providers.done': 'Done',
  'settings.providers.deleteConfirm': 'Delete provider "{name}"? This action cannot be undone.',
  'settings.providers.replaceKey': 'Replace stored key',
  'settings.providers.pasteKey': 'Paste API key',
  'settings.providers.baseUrlLabel': 'Base URL',
  'settings.providers.apiKeyLabel': 'API key',
  'settings.providers.saving': 'Saving…',

  // ── Integrations (MCP / Plugins / Skills) ────────────
  'integrations.searchPlaceholder': 'Search…',
  'integrations.install': 'Install',
  'integrations.installed': 'Installed',
  'integrations.uninstall': 'Uninstall',
  'integrations.addCustom': 'Add custom',
  'integrations.refresh': 'Refresh',
  'integrations.empty': 'No results',

  // ── Common ────────────────────────────────────────
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
