import { useRef, useState } from 'react';
import type { CanvasNode } from '../../../../shared/canvas';
import * as chatStore from '../../../state/chatStore';
import EditOverlayShell from './EditOverlayShell';
import { cropImageBlob, cropImageBlobWithStrokes } from './pixelOps';
import { extendStroke, pointFromClient, strokesBounds, strokesInRect, type Stroke } from '../../../../shared/strokes';

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
  const [pen, setPen] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!wrapRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const box = wrapRef.current.getBoundingClientRect();
    if (pen) {
      drawing.current = true;
      setStrokes((all) => [...all, [pointFromClient(box, e.clientX, e.clientY)]]);
      return;
    }
    drag.current = {
      startX: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      startY: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
    setRect({ x: drag.current.startX, y: drag.current.startY, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pen) {
      if (!drawing.current || !wrapRef.current) return;
      const p = pointFromClient(wrapRef.current.getBoundingClientRect(), e.clientX, e.clientY);
      setStrokes((all) => (all.length === 0 ? all : [...all.slice(0, -1), extendStroke(all[all.length - 1], p)]));
      return;
    }
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
    drawing.current = false;
    drag.current = null;
    if (pen) return;
    setRect((r) => (r && (r.w < 0.02 || r.h < 0.02) ? null : r));
  };

  const confirm = async () => {
    const region = pen ? strokesBounds(strokes) : rect;
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      const blob = pen
        ? await cropImageBlobWithStrokes(imageUrl, region, strokesInRect(strokes, region))
        : await cropImageBlob(imageUrl, region);
      const thumbnail = await blobToDataUrl(blob);
      const params = node.params as Record<string, unknown>;
      const label = (node.title || params.prompt || '图片').toString().slice(0, 24);
      chatStore.addNodeRef(sessionId, {
        id: node.id,
        label,
        type: node.type,
        thumbnail,
        region: { ...region },
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
      confirmDisabled={pen ? strokes.length === 0 : !rect}
      confirmHint={pen ? '在图片上按住拖动，圈出要说明的地方' : '在图片上按住拖动，框出要引用的区域'}
      footer={
        error ? (
          <p className="text-[11px] text-danger">{error}</p>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-ink-muted">
            <div role="group" aria-label="标注方式" className="flex rounded-md bg-paper-inset p-0.5">
              {([['框选', false], ['画笔', true]] as const).map(([label, isPen]) => (
                <button key={label} type="button" aria-pressed={pen === isPen} onClick={() => setPen(isPen)} className={pen === isPen ? 'rounded px-2 py-0.5 text-ink bg-paper-raised' : 'rounded px-2 py-0.5 hover:text-ink'}>{label}</button>
              ))}
            </div>
            {strokes.length > 0 && pen ? <button type="button" onClick={() => setStrokes((all) => all.slice(0, -1))} className="hover:text-ink">撤销一笔</button> : null}
            <span>{pen ? '画出的笔迹会画进发给 Agent 的截图' : '框选后该区域会以 chip 形式加入输入框，随消息一起发给 Agent'}</span>
          </div>
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
        {pen ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
            {strokes.map((s, i) => (
              <polyline key={i} points={s.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ff3b30" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        ) : rect ? (
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
