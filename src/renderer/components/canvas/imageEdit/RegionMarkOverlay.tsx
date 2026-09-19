import { useRef, useState } from 'react';
import type { CanvasNode } from '../../../../shared/canvas';
import * as chatStore from '../../../state/chatStore';
import EditOverlayShell from './EditOverlayShell';
import { cropImageBlob } from './pixelOps';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取裁剪结果失败'));
    reader.readAsDataURL(blob);
  });
}

export default function RegionMarkOverlay({
  sessionId,
  node,
  imageUrl,
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ startX: number; startY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!wrapRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const box = wrapRef.current.getBoundingClientRect();
    drag.current = {
      startX: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      startY: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
    setRect({ x: drag.current.startX, y: drag.current.startY, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !wrapRef.current) return;
    const box = wrapRef.current.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    setRect({
      x: Math.min(drag.current.startX, cx),
      y: Math.min(drag.current.startY, cy),
      w: Math.abs(cx - drag.current.startX),
      h: Math.abs(cy - drag.current.startY),
    });
  };

  const onPointerUp = () => {
    drag.current = null;
    setRect((r) => (r && (r.w < 0.02 || r.h < 0.02) ? null : r));
  };

  const confirm = async () => {
    if (!rect) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropImageBlob(imageUrl, rect);
      const thumbnail = await blobToDataUrl(blob);
      const params = node.params as Record<string, unknown>;
      const label = (node.title || params.prompt || '图片').toString().slice(0, 24);
      chatStore.addNodeRef(sessionId, {
        id: node.id,
        label,
        type: node.type,
        thumbnail,
        region: { ...rect },
      });
      onClose();
    } catch {
      setError('区域裁剪失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="框选区域 → 引用到对话"
      confirmLabel="加入对话"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      confirmDisabled={!rect}
      confirmHint="在图片上按住拖动，框出要引用的区域"
      footer={
        error ? (
          <p className="text-[11px] text-danger">{error}</p>
        ) : (
          <p className="text-[11px] text-ink-muted">框选后该区域会以 chip 形式加入输入框，随消息一起发给 Agent</p>
        )
      }
    >
      <div
        ref={wrapRef}
        className="relative inline-block max-h-full max-w-full cursor-crosshair select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="block max-h-[70vh] max-w-full rounded-lg object-contain"
        />
        {rect ? (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-accent bg-accent/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
          />
        ) : null}
      </div>
    </EditOverlayShell>
  );
}
