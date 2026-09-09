// 中文字符串 — 与 en.ts 一一对应，同一个 key。

export const zh: Record<string, string> = {
  // ── 工作台 ──────────────────────────────────────
  'workspace.title': '工作区',
  'workspace.new': '新建工作区',
  'workspace.newFolder': '新建文件夹',
  'workspace.delete': '删除工作区',
  'workspace.deleteConfirm': '确定删除工作区 "{name}"？该工作区下的所有会话也会被删除，且无法恢复。',
  'workspace.empty': '未打开工作区',
  'workspace.emptyHint': '创建或打开本地文件夹，开始与 Agent 对话。',

  // ── 会话 ────────────────────────────────────────
  'session.new': '新建会话',
  'session.delete': '删除会话',
  'session.deleteConfirm': '确定删除会话 "{name}"？',
  'session.rename': '重命名会话',
  'session.empty': '未选中会话',
  'session.emptyHint': '新建会话或从侧边栏选择一个。',

  // ── 聊天 / 输入 ────────────────────────────────
  'chat.send': '发送',
  'chat.inputPlaceholder': '告诉 Narwhal 你想做什么…',
  'chat.stop': '停止',
  'chat.attach': '添加附件',
  'chat.empty': '开始对话',
  'chat.emptyHint': '选择工作区和会话，然后描述你的需求。',
  'chat.generating': 'Narwhal 正在思考…',

  // ── 错误 ─────────────────────────────────────────
  'agent.needsAttention': 'Agent 需要关注',
  'agent.connectionError': '连接错误。请检查 provider 的 Base URL 是否可达，API Key 是否有效。',
  'agent.error': '错误',
  'agent.retry': '重试',

  // ── 设置 ───────────────────────────────────────
  'settings.title': '设置',
  'settings.close': '关闭设置',
  'settings.language': '语言',
  'settings.language.auto': '跟随系统',
  'settings.language.en': 'English',
  'settings.language.zh': '简体中文',
  'settings.theme': '外观',
  'settings.theme.title': '主题',
  'settings.theme.auto': '跟随系统',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.tab.models': '模型',
  'settings.tab.providers': 'Provider',
  'settings.tab.permissions': '权限',
  'settings.tab.runtime': '运行时',
  'settings.tab.mcp': 'MCP Servers',
  'settings.tab.plugins': '运行时扩展',
  'settings.tab.skills': 'Skills',

  // ── Provider ───────────────────────────────────────
  'providers.title': 'Provider',
  'providers.add': '添加 Provider',
  'providers.name': '显示名称',
  'providers.id': 'Provider ID',
  'providers.baseUrl': 'Base URL',
  'providers.apiKey': 'API Key',
  'providers.apiKeyMissing': '未设置 API Key',
  'providers.apiKeySet': 'API Key 已配置',
  'providers.apiKeyPlaceholder': '粘贴 API Key…',
  'providers.save': '保存更改',
  'providers.deleting': '删除中…',
  'providers.delete': '删除',
  'providers.deleteConfirm': '确定删除 Provider "{name}"？此操作无法撤销。',
  'providers.active': '已启用',
  'providers.inactive': '未启用',
  'providers.models': '模型',
  'providers.protocol': '协议',

  // ── 集成市场 ───────────────────────────────────
  'integrations.searchPlaceholder': '搜索…',
  'integrations.install': '安装',
  'integrations.installed': '已安装',
  'integrations.uninstall': '卸载',
  'integrations.addCustom': '自定义添加',
  'integrations.refresh': '刷新',
  'integrations.empty': '没有结果',

  // ── 状态栏 ──────────────────────────────────────
  'status.ready': '就绪',
  'status.starting': '启动中…',
  'status.error': '错误',
  'status.stopped': '已停止',

  // ── 通用 ──────────────────────────
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.save': '保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.rename': '重命名',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.search': '搜索',
  'common.filter': '筛选 / 排序',
  'common.loading': '加载中…',
}
