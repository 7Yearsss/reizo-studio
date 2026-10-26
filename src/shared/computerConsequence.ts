import type { ComputerInput } from './computerUse';

/** Things that are hard or impossible to take back; each one needs the user's go-ahead every time. */
export const CONSEQUENCE_CATEGORIES = ['send', 'publish', 'delete', 'overwrite', 'install', 'purchase', 'credential', 'security'] as const;
export type ConsequenceCategory = (typeof CONSEQUENCE_CATEGORIES)[number];

export const CONSEQUENCE_LABELS: Record<ConsequenceCategory, string> = {
  send: '发送消息/邮件', publish: '发布内容', delete: '删除数据', overwrite: '覆盖已有内容', install: '安装软件',
  purchase: '付款/下单/转账', credential: '修改账号或密码', security: '修改安全或系统设置',
};

/** Backstop for a model that forgets to declare: wording in what it says it is doing. Chinese and English. */
const PATTERNS: Array<[ConsequenceCategory, RegExp]> = [
  ['purchase', /付款|支付|下单|购买|结算|转账|汇款|充值|checkout|purchase|buy now|place order|pay(ment)?\b|transfer funds|wire/i],
  ['delete', /删除|清空|移除|永久删除|格式化|\bdelete\b|\berase\b|\bwipe\b|empty (the )?trash/i],
  ['send', /发送|寄出|回复邮件|群发|提交申请|\bsend\b|reply all|submit (the )?(form|application)/i],
  ['publish', /发布|发表|上传到|公开|推送上线|\bpublish\b|\bpost (it|this|to)\b|go live|deploy/i],
  ['install', /安装|卸载|下载并运行|\binstall\b|uninstall|run the installer/i],
  ['credential', /修改密码|重置密码|更换邮箱|绑定手机|change (the )?password|reset password|change email/i],
  ['security', /关闭防火墙|关闭杀毒|修改权限|安全设置|disable (the )?(firewall|antivirus)|security settings/i],
  ['overwrite', /覆盖|替换原文件|\boverwrite\b|replace existing/i],
];

export type DeclaredIntent = { consequence?: ConsequenceCategory | 'none'; summary?: string };

/**
 * Does this action need an explicit confirmation? A declared category wins; otherwise the wording of the
 * summary the model gave (and, for typing, the text it types) is checked. Looking never needs confirmation.
 */
export function classifyConsequence(input: ComputerInput & DeclaredIntent): ConsequenceCategory | null {
  if (input.action === 'screenshot' || input.action === 'cursor_position' || input.action === 'wait' || input.action === 'move' || input.action === 'scroll') return null;
  if (input.consequence && input.consequence !== 'none') return input.consequence;
  if (input.consequence === 'none') return null;
  const text = input.summary ?? '';
  for (const [category, pattern] of PATTERNS) if (pattern.test(text)) return category;
  return null;
}
