export type SettingsSectionId = 'general' | 'providers' | 'memory' | 'knowledge' | 'experts' | 'extensions' | 'usage' | 'network' | 'storage' | 'about';

export interface SettingsEntry {
  /** Stable id used by deep links; never reuse a retired one — keep it as an alias instead. */
  id: string;
  section: SettingsSectionId;
  /** The `data-setting-id` of the group to scroll to inside the section; omit to land on the section itself. */
  anchor?: string;
  title: string;
  keywords?: string[];
  aliases?: string[];
}

/** One searchable entry per settings group. The test next to this file keeps ids, aliases and anchors honest. */
export const SETTINGS_CATALOG: readonly SettingsEntry[] = [
  { id: 'general.appearance', section: 'general', anchor: 'appearance', title: '外观', keywords: ['主题', '深色', '浅色', '字号', '暗色', 'theme', 'dark', 'light'] },
  { id: 'general.custom-css', section: 'general', anchor: 'custom-css', title: '自定义 CSS', keywords: ['样式', '皮肤', 'css'] },
  { id: 'general.personal-rules', section: 'general', anchor: 'personal-rules', title: '个人偏好', keywords: ['语气', '称呼', '回复风格', '规则'] },
  { id: 'general.web-search', section: 'general', anchor: 'web-search', title: '联网搜索', keywords: ['搜索', '网页', 'search'] },
  { id: 'general.permissions', section: 'general', anchor: 'permissions', title: '权限', keywords: ['询问', '写文件', '命令', '批准', 'permission'], aliases: ['permissions'] },
  { id: 'general.computer-use', section: 'general', anchor: 'computer-use', title: '电脑操作 (Computer Use)', keywords: ['鼠标', '键盘', '截屏', '控制电脑'] },
  { id: 'general.step-limit', section: 'general', anchor: 'step-limit', title: '单次回复步数上限', keywords: ['步数', '工具调用次数'] },
  { id: 'general.busy-enter', section: 'general', anchor: 'busy-enter', title: '对话', keywords: ['Enter', '回车', '排队', '引导', '打断'] },
  { id: 'general.reasoning', section: 'general', anchor: 'reasoning', title: '思考力度', keywords: ['推理', '思考', 'reasoning', 'effort'] },
  { id: 'general.workspace', section: 'general', anchor: 'workspace', title: '工作区', keywords: ['文件夹', '目录', 'workspace'] },
  { id: 'providers', section: 'providers', title: '模型与服务商', keywords: ['密钥', 'API Key', '模型', 'openai', 'deepseek', 'ollama', '账号'], aliases: ['admin', 'models'] },
  { id: 'memory', section: 'memory', title: '记忆', keywords: ['记住', '偏好', 'memory'] },
  { id: 'knowledge', section: 'knowledge', title: '资料库', keywords: ['知识库', '文档检索', '索引'] },
  { id: 'experts', section: 'experts', title: '专家', keywords: ['子智能体', 'sub-agent', '角色'] },
  { id: 'extensions', section: 'extensions', title: '扩展', keywords: ['MCP', '插件', 'plugin', 'hook', '钩子'], aliases: ['mcp', 'plugins'] },
  { id: 'usage', section: 'usage', title: '用量与费用', keywords: ['账单', '花费', '价格', '额度', 'usage', 'cost'] },
  { id: 'network', section: 'network', title: '网络', keywords: ['代理', 'proxy', '出站', '白名单'] },
  { id: 'storage.backup', section: 'storage', anchor: 'backup', title: '备份与迁移', keywords: ['导出', '导入', '迁移', 'backup'] },
  { id: 'storage.maintenance', section: 'storage', anchor: 'maintenance', title: '存储空间', keywords: ['清理', '磁盘', '空间'] },
  { id: 'storage.diagnostics', section: 'storage', anchor: 'diagnostics', title: '诊断与日志', keywords: ['日志', '支持', '反馈', 'diagnostics'] },
  { id: 'about', section: 'about', title: '关于', keywords: ['版本', '更新', '检查更新', 'about', 'version'] },
];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');

/** A deep link target by id or retired alias; undefined when nothing matches (callers fall back to the section list). */
export function resolveSettingsTarget(idOrAlias: string): SettingsEntry | undefined {
  const key = norm(idOrAlias);
  return SETTINGS_CATALOG.find((e) => norm(e.id) === key) ?? SETTINGS_CATALOG.find((e) => (e.aliases ?? []).some((a) => norm(a) === key));
}

function score(entry: SettingsEntry, q: string): number {
  const title = norm(entry.title);
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (title.includes(q)) return 60;
  if ((entry.aliases ?? []).some((a) => norm(a) === q)) return 55;
  if ((entry.keywords ?? []).some((k) => norm(k).startsWith(q))) return 40;
  if ((entry.keywords ?? []).some((k) => norm(k).includes(q))) return 25;
  return 0;
}

/** Ranked matches: exact title, title prefix, title substring, alias, keyword prefix, keyword substring. */
export function searchSettings(query: string, limit = 8): SettingsEntry[] {
  const q = norm(query);
  if (!q) return [];
  return SETTINGS_CATALOG.map((entry) => ({ entry, s: score(entry, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.entry);
}
