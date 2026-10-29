import type { PermissionMode } from '../../shared/settings';
import { confirmDialog } from '../state/confirmStore';
import * as settingsStore from '../state/settingsStore';

export const FULL_ACCESS_SCOPE = [
  '文件：工作区内读写、删除不再逐次询问',
  '命令：终端命令直接执行',
  '网络：工具发起的网络请求直接放行',
].join('\n');

/** Whether moving between two modes widens what the agent may do without asking. */
export function widensPermission(from: PermissionMode, to: PermissionMode): boolean {
  return to === 'full' && from !== 'full';
}

/** Change the global permission mode; widening to full first lists exactly what gets unlocked. */
export async function requestPermissionMode(current: PermissionMode, next: PermissionMode): Promise<boolean> {
  if (next === current) return false;
  if (widensPermission(current, next)) {
    const ok = await confirmDialog({
      title: '切换到完全权限？',
      description: `之后智能体将不再询问：\n${FULL_ACCESS_SCOPE}\n\n电脑操作仍需单独确认。`,
      confirmLabel: '允许',
      destructive: true,
    });
    if (!ok) return false;
  }
  await settingsStore.patchSettings({ permissionMode: next });
  return true;
}
