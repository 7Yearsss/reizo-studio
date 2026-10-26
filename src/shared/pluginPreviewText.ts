import type { PluginPreview } from './plugins';

/**
 * What the user reads before a pack is copied in: everything it carries, with the commands and addresses spelled out.
 * Nothing has been started at this point; installing still leaves the pack switched off.
 */
export function previewConfirmText(preview: PluginPreview): string {
  const { summary, existing } = preview;
  const lines: string[] = [];
  if (existing?.sameContent) lines.push(`「${summary.name}」已经安装，且内容与这个文件夹完全一致，无需重复导入。`);
  else if (existing) lines.push(`「${summary.name}」已安装${existing.version ? `（v${existing.version}）` : ''}，导入会用这个文件夹${summary.version ? `（v${summary.version}）` : ''}的内容替换它，启用状态保持不变。`);
  else lines.push(`导入扩展包「${summary.name}」${summary.version ? `（v${summary.version}）` : ''}。导入后默认不启用。`);
  lines.push('', `来源：${preview.sourceDir}`, '', '它包含：');
  lines.push(summary.skills.length ? `• ${summary.skills.length} 个技能：${summary.skills.slice(0, 8).join('、')}${summary.skills.length > 8 ? '…' : ''}` : '• 没有技能');
  for (const server of summary.mcpServers) lines.push(`• ${server.kind === 'stdio' ? '启动本地程序' : '连接外部服务'}：${server.target}`);
  for (const hook of summary.hooks) lines.push(`• 在工具调用${hook.event === 'PreToolUse' ? '前' : '后'}运行命令${hook.matcher ? `（${hook.matcher}）` : ''}：${hook.command}`);
  for (const warning of summary.warnings) lines.push(`• 注意：${warning}`);
  lines.push('', '以上程序和命令要等你启用后才会运行。只导入你信任的来源。继续导入吗？');
  return lines.join('\n');
}
