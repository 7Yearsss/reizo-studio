export type ShortcutScope = '全局' | '对话' | '输入框' | '标签页' | '面板';

export interface ShortcutEntry {
  id: string;
  /** `Mod` is Ctrl on Windows/Linux and ⌘ on macOS. */
  keys: string;
  label: string;
  scope: ShortcutScope;
}

/** Every keyboard shortcut the app handles, in one place — the help dialog renders this, tests keep it honest. */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  { id: 'palette', keys: 'Mod+K', label: '打开命令面板', scope: '全局' },
  { id: 'sidebar', keys: 'Mod+B', label: '显示 / 隐藏侧栏', scope: '全局' },
  { id: 'shortcuts', keys: 'Mod+/', label: '查看快捷键', scope: '全局' },
  { id: 'regions', keys: 'F6', label: '在侧栏、对话、输入框、面板间切换焦点（Shift+F6 反向）', scope: '全局' },
  { id: 'history-back', keys: 'Alt+Left', label: '后退', scope: '全局' },
  { id: 'history-forward', keys: 'Alt+Right', label: '前进', scope: '全局' },
  { id: 'tab-digit', keys: 'Mod+1…9', label: '跳到第 N 个标签（9 为最后一个）', scope: '标签页' },
  { id: 'tab-reopen', keys: 'Mod+Shift+T', label: '重新打开刚关闭的标签', scope: '标签页' },
  { id: 'tab-move', keys: 'Alt+Shift+Left/Right', label: '标签获得焦点时左右移动', scope: '标签页' },
  { id: 'tab-close', keys: 'Delete', label: '标签获得焦点时关闭（也可中键点击）', scope: '标签页' },
  { id: 'send', keys: 'Enter', label: '发送；回复进行中则排队', scope: '输入框' },
  { id: 'steer', keys: 'Mod+Enter', label: '回复进行中：打断并立即发送（引导）；按住 Ctrl/⌘ 时发送键图标随之切换', scope: '输入框' },
  { id: 'history', keys: 'Up / Down', label: '输入框为空时翻查已发送的消息', scope: '输入框' },
  { id: 'recall-queue', keys: 'Up', label: '光标在开头时取回排队中的消息', scope: '输入框' },
  { id: 'stash', keys: 'Mod+Shift+S', label: '暂存当前草稿（从输入框上方的「暂存」取回）', scope: '输入框' },
  { id: 'stop', keys: 'Esc Esc', label: '回复进行中：连按两次停止', scope: '输入框' },
  { id: 'ask-ai', keys: 'Mod+L', label: '文档：把选区交给 AI', scope: '面板' },
  { id: 'inline-edit', keys: 'Mod+J', label: '文档：对选区直接提出修改', scope: '面板' },
  { id: 'splitter', keys: 'Left/Right', label: '分隔条获得焦点时调整右侧面板宽度（Shift 加大步长，Home/End 到极值）', scope: '面板' },
  { id: 'lightbox-zoom', keys: '+ / - / 0', label: '图片预览：缩放 / 复位（也可滚轮、双击）', scope: '面板' },
  { id: 'approve', keys: 'Enter', label: '审批卡：允许一次（Ctrl/⌘+Enter：本会话都允许；Esc：拒绝）', scope: '对话' },
];

/** Render a registry key string for the platform: Mod → ⌘ / Ctrl, and macOS symbols for the rest. */
export function formatShortcut(keys: string, mac: boolean): string {
  const map: Record<string, string> = mac
    ? { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', Delete: '⌫', Left: '←', Right: '→' }
    : { Mod: 'Ctrl' };
  return keys.split('+').map((part) => part.split('/').map((p) => map[p] ?? p).join('/')).join(mac ? '' : '+');
}

export function groupShortcuts(entries: readonly ShortcutEntry[] = SHORTCUTS): [ShortcutScope, ShortcutEntry[]][] {
  const order: ShortcutScope[] = ['全局', '标签页', '输入框', '对话', '面板'];
  return order
    .map((scope) => [scope, entries.filter((e) => e.scope === scope)] as [ShortcutScope, ShortcutEntry[]])
    .filter(([, list]) => list.length > 0);
}
