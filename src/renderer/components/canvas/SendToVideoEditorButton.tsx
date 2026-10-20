import { Film } from 'lucide-react';
import type { CanvasNode } from '../../../shared/canvas';
import { editorVersionInput, sendAssetToVideoEditor } from '../../lib/sendToVideoEditor';

export default function SendToVideoEditorButton({ sessionId, node, assetIndex }: { sessionId: string; node: CanvasNode; assetIndex: number }) {
  return <button type="button" aria-label="送到剪辑" title="将当前显示的版本送到剪辑" className="nodrag rounded bg-paper-raised/90 p-1 text-ink-muted hover:text-ink" disabled={!node.output?.assets?.[assetIndex]} onClick={(event) => {
    event.stopPropagation(); void sendAssetToVideoEditor(sessionId, editorVersionInput(node, assetIndex));
  }}><Film size={12} /></button>;
}
