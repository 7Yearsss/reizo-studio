import type { CanvasNode } from '../../shared/canvas';
import type { ReuseCanvasAssetInput } from '../api';
import { getCanvas, getSession, importEditorMedia, listEditorMedia, prepareEditorArtifact, reuseCanvasAsset } from '../api';
import { openChatTab } from '../state/tabStore';
import { setMode, setRightPanelTab } from '../state/uiStore';
import { dismissToast, toast } from './toast';

export function editorVersionInput(node: CanvasNode, assetIndex: number): ReuseCanvasAssetInput {
  const path = node.output?.assets?.[assetIndex];
  if (!path) throw new Error('所选版本不可用');
  const assetId = node.output?.resultSet?.find((item) => item.asset === path)?.assetId;
  return { ...(assetId ? { assetId } : { sourceCanvasId: node.canvasId, sourceNodeId: node.id, assetIndex, expectedPath: path }), title: node.title };
}

const pending = new Set<string>();
async function transfer(sessionId: string, key: string, prepare: () => Promise<string>) {
  const scopedKey = `${sessionId}:${key}`;
  if (pending.has(scopedKey)) return;
  pending.add(scopedKey);
  const notice = toast.loading('正在准备剪辑素材…');
  try {
    const assetId = await prepare();
    // Open before importing: the iframe must be mounted to receive the queued bytes.
    const session = await getSession(sessionId);
    openChatTab(sessionId, session.title); setMode('chat'); setRightPanelTab('video');
    await importEditorMedia(sessionId, assetId);
    toast.success('所选版本已加入剪辑素材池');
  } catch (error) { toast.error('送到剪辑失败', error instanceof Error ? error.message : String(error)); }
  finally { pending.delete(scopedKey); dismissToast(notice); }
}

export function sendAssetToVideoEditor(sessionId: string, input: ReuseCanvasAssetInput) {
  // Snapshot the input before navigation/unmounting or a new canvas generation.
  const selected = { ...input };
  return transfer(sessionId, JSON.stringify(selected), async () => {
    const { assets } = await listEditorMedia(sessionId);
    const existing = assets.find((asset) => selected.assetId ? asset.id === selected.assetId : asset.path === selected.expectedPath);
    if (existing) return existing.id;
    const { canvas } = await getCanvas(sessionId);
    const result = await reuseCanvasAsset(canvas.id, selected, crypto.randomUUID());
    return result.asset.id;
  });
}

export function sendArtifactToVideoEditor(sessionId: string, artifactId: string, version: number) {
  return transfer(sessionId, `${artifactId}:${version}`, async () => (await prepareEditorArtifact(sessionId, artifactId, version)).asset.id);
}
