import { useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Trash2 } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import { createMaskCanvas, loadHtmlImage, mosaicImageBlob } from './pixelOps';
import EditOverlayShell from './EditOverlayShell';
import EditPanelCard from './EditPanelCard';
import EditSlider from './EditSlider';
import { cn } from '../../../lib/cn';

export default function MosaicOverlay({
  sessionId,
  node,
  imageUrl,
  commitMode = 'derive',
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  commitMode?: EditCommitMode;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const tintRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<'brush' | 'erase'>('brush');
  const [brush, setBrush] = useState(36);
  const [block, setBlock] = useState(24);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadHtmlImage(imageUrl).then((img) => {
      if (cancelled) return;
      maskRef.current = createMaskCanvas(img.naturalWidth, img.naturalHeight);
      const preview = previewRef.current;
      const tint = tintRef.current;
      if (preview) {
        preview.width = img.naturalWidth;
        preview.height = img.naturalHeight;
      }
      if (tint) {
        tint.width = img.naturalWidth;
        tint.height = img.naturalHeight;
      }
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const repaintPreview = async () => {
    const preview = previewRef.current;
    const mask = maskRef.current;
    if (!preview || !mask) return;
    const blob = await mosaicImageBlob(imageUrl, mask, Math.max(4, block) / Math.min(imgSize.w, imgSize.h));
    const bmp = await createImageBitmap(blob);
    const ctx = preview.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  };

  const toNatural = (e: React.PointerEvent) => {
    const tint = tintRef.current;
    if (!tint) return { x: 0, y: 0 };
    const r = tint.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * tint.width,
      y: ((e.clientY - r.top) / r.height) * tint.height,
    };
  };

  const stamp = (x: number, y: number, from?: { x: number; y: number }) => {
    const mask = maskRef.current;
    const tint = tintRef.current;
    if (!mask || !tint) return;
    for (const [canvas, mode] of [
      [mask, tool === 'erase' ? 'destination-out' : 'source-over'],
      [tint, tool === 'erase' ? 'destination-out' : 'source-over'],
    ] as const) {
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.save();
      ctx.globalCompositeOperation = mode;
      ctx.strokeStyle = canvas === tint ? 'rgba(255,255,255,0.55)' : '#ffffff';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = brush;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (from) {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!hasInk && tool === 'brush') setHasInk(true);
    const p = toNatural(e);
    drawing.current = p;
    stamp(p.x, p.y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const from = drawing.current;
    if (!from) return;
    const p = toNatural(e);
    stamp(p.x, p.y, from);
    drawing.current = p;
  };
  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = null;
    void repaintPreview();
  };

  const clearMask = () => {
    for (const c of [maskRef.current, tintRef.current, previewRef.current]) {
      const ctx = c?.getContext('2d');
      ctx?.clearRect(0, 0, c?.width ?? 0, c?.height ?? 0);
    }
    setHasInk(false);
  };

  const confirm = async () => {
    const mask = maskRef.current;
    if (!mask || !hasInk) return;
    setBusy(true);
    try {
      const blob = await mosaicImageBlob(imageUrl, mask, Math.max(4, block) / Math.min(imgSize.w, imgSize.h));
      await commitImageEdit(
        commitMode,
        sessionId,
        node,
        { kind: 'mosaic', params: { mosaicSize: Math.max(4, block) / Math.min(imgSize.w, imgSize.h) } },
        { localResultBlob: blob },
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="马赛克"
      confirmLabel="应用马赛克"
      confirmDisabled={!hasInk}
      confirmHint="先在图上涂抹要打码的区域"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      extraActions={
        <>
          <ToolBtn active={tool === 'brush'} title="涂抹" onClick={() => setTool('brush')}><Brush size={14} /></ToolBtn>
          <ToolBtn active={tool === 'erase'} title="擦除涂抹" onClick={() => setTool('erase')}><Eraser size={14} /></ToolBtn>
          <ToolBtn title="清空" onClick={clearMask}><Trash2 size={14} /></ToolBtn>
        </>
      }
    >
      <EditPanelCard className="max-w-[86vw] items-start">
        <div ref={wrapRef} className="relative max-h-[56vh] overflow-hidden rounded-lg bg-canvas-inset select-none">
          <img src={imageUrl} alt="" draggable={false} className="block max-h-[56vh] max-w-[46vw] object-contain" />
          <canvas ref={previewRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
          <canvas
            ref={tintRef}
            className="absolute inset-0 h-full w-full cursor-crosshair object-contain"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <div className="flex w-60 flex-col gap-3.5">
          <EditSlider label="笔刷" value={brush} display={`${brush}px`} min={8} max={160} onChange={setBrush} />
          <EditSlider
            label="颗粒"
            value={block}
            display={`${block}px`}
            min={6}
            max={120}
            onChange={(v) => {
              setBlock(v);
              if (hasInk) void repaintPreview();
            }}
          />
          <p className="text-[11px] leading-relaxed text-ink-muted">在图上涂抹需要打码的区域，松开即可预览效果。</p>
        </div>
      </EditPanelCard>
    </EditOverlayShell>
  );
}

function ToolBtn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors active:scale-95',
        active ? 'bg-accent/20 text-accent' : 'bg-paper-inset hover:bg-line',
      )}
    >
      {children}
    </button>
  );
}
