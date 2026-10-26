/**
 * Which apps the agent may drive. Judged from the app that is in front at the moment of an action,
 * because the model chooses the coordinates and a click can land anywhere.
 */
export type AppVerdict = { verdict: 'allow' } | { verdict: 'deny'; reason: string };

export interface ForegroundApp {
  /** Executable / process name, any case, with or without `.exe`. */
  process: string;
  title?: string;
  pid?: number;
}

const normalize = (name: string) => name.trim().toLowerCase().replace(/\.(exe|app)$/, '').replace(/\s+/g, ' ');

/** Never driven: consoles and terminals, IDEs, password managers and keychains, system-management tools. */
const HARD_DENY: Record<string, string> = {};
function deny(reason: string, names: string[]) { for (const n of names) HARD_DENY[normalize(n)] = reason; }
deny('终端/命令行：可以执行任意命令，请改用 run_command（会逐次请求确认）', [
  'cmd', 'powershell', 'pwsh', 'windowsterminal', 'wt', 'conhost', 'openconsole', 'terminal', 'iterm2', 'iterm', 'gnome-terminal',
  'gnome-terminal-', 'konsole', 'xterm', 'alacritty', 'kitty', 'wezterm', 'wezterm-gui', 'hyper', 'tabby', 'warp',
]);
deny('代码编辑器/IDE：可以修改和运行代码，请改用文件工具', [
  'code', 'code - insiders', 'cursor', 'devenv', 'idea', 'idea64', 'pycharm', 'pycharm64', 'webstorm', 'webstorm64', 'goland64',
  'clion64', 'rider64', 'androidstudio', 'android studio', 'xcode', 'sublime_text', 'zed',
]);
deny('密码管理器/钥匙串：包含凭据，Agent 不得操作', [
  '1password', 'bitwarden', 'keepass', 'keepassxc', 'lastpass', 'dashlane', 'enpass', 'keychain access', 'seahorse', 'credwiz',
]);
deny('系统管理工具：可能改变系统或安全设置', [
  'taskmgr', 'regedit', 'mmc', 'secpol', 'gpedit', 'control', 'systemsettings', 'system settings', 'system preferences',
  'activity monitor', 'gnome-control-center', 'msconfig', 'services', 'compmgmt', 'eventvwr', 'wf', 'lusrmgr',
]);

/** Verdict for the app currently in front. `ownPid` is this app's process id (Reizo must never drive itself). */
export function judgeForegroundApp(app: ForegroundApp | null, ownPid: number = process.pid): AppVerdict {
  if (!app) return { verdict: 'allow' };
  if (app.pid !== undefined && app.pid === ownPid) return { verdict: 'deny', reason: 'Reizo 自身：不能操作自己的界面' };
  const key = normalize(app.process);
  if (key === 'reizo' || key === 'reizo studio') return { verdict: 'deny', reason: 'Reizo 自身：不能操作自己的界面' };
  const reason = HARD_DENY[key];
  return reason ? { verdict: 'deny', reason } : { verdict: 'allow' };
}

export function describeDenial(app: ForegroundApp, reason: string): string {
  return `当前最前面的窗口是「${app.title || app.process}」（${app.process}），${reason}。已拒绝这次操作。请换用其他方式完成，或请用户亲自操作。`;
}
