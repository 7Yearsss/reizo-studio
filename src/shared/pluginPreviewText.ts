import type { PluginPreview, PluginSummary } from './plugins';

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
  if (summary.config?.length) lines.push(`• 需要你填写凭据：${summary.config.map((c) => c.name).join('、')}（导入后在卡片里填写，加密保存在本机，不会写进扩展包或任何配置文件）`);
  for (const warning of summary.warnings) lines.push(`• 注意：${warning}`);
  lines.push('', '以上程序和命令要等你启用后才会运行。只导入你信任的来源。继续导入吗？');
  return lines.join('\n');
}

/** What goes away when a pack is removed — spelled out so the user is not agreeing to "its files" in the abstract. */
export function uninstallImpactText(pack: Pick<PluginSummary, 'name' | 'skills' | 'mcpServers' | 'hooks' | 'config' | 'enabled'>): string {
  const lines: string[] = [`卸载「${pack.name}」会删除它的文件，并带走：`];
  lines.push(pack.skills.length ? `• ${pack.skills.length} 个技能：${pack.skills.slice(0, 8).join('、')}${pack.skills.length > 8 ? '…' : ''}` : '• 没有技能');
  if (pack.mcpServers.length) lines.push(`• ${pack.mcpServers.length} 个外部工具服务${pack.enabled ? '（正在运行的会被停掉）' : ''}`);
  if (pack.hooks.length) lines.push(`• ${pack.hooks.length} 条工具调用前后的命令`);
  if (pack.config?.some((c) => c.set)) lines.push('• 你为它保存的凭据');
  lines.push('', '你的对话、画布和其他文件不受影响。');
  return lines.join('\n');
}
