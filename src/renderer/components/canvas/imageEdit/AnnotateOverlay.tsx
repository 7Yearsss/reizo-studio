import { useEffect, useRef, useState } from 'react';
import { Minus, Square, Type } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { compositeOverlayBlob, loadHtmlImage } from './pixelOps';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import EditOverlayShell from './EditOverlayShell';

type Tool = 'brush' | 'rect' | 'arrow' | 'text';

export default function AnnotateOverlay({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#ff4d4f');
  const [width, setWidth] = useState(4);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drawing = useRef<{ x: number; y: number; snapshot: ImageData | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHtmlImage(imageUrl).then((img) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      setSize({ w: img.naturalWidth, h: img.naturalHeight });
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const pos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * canvas.width,
      y: ((e.clientY - box.top) / box.height) * canvas.height,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === 'text') {
      const text = window.prompt('标注文字');
      if (text) {
        ctx.fillStyle = color;
        ctx.font = `${Math.max(18, width * 6)}px sans-serif`;
        ctx.fillText(text, p.x, p.y);
      }
      return;
    }
    drawing.current = { ...p, snapshot: ctx.getImageData(0, 0, canvas.width, canvas.height) };
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'brush') {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const d = drawing.current;
    if (!canvas || !ctx || !d) return;
    const p = pos(e);
    if (tool === 'brush') {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      return;
    }
    if (d.snapshot) ctx.putImageData(d.snapshot, 0, 0);
    ctx.beginPath();
    if (tool === 'rect') {
      ctx.strokeRect(d.x, d.y, p.x - d.x, p.y - d.y);
    } else if (tool === 'arrow') {
      drawArrow(ctx, d.x, d.y, p.x, p.y, width);
    }
  };

  const onUp = () => {
    drawing.current = null;
  };

  const confirm = async () => {
    const overlay = canvasRef.current;
    if (!overlay) return;
    setBusy(true);
    try {
      const blob = await compositeOverlayBlob(imageUrl, overlay);
      await commitImageEdit(commitMode, sessionId, node, { kind: 'annotate' }, { localResultBlob: blob });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="标注"
      confirmLabel="确认标注"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      extraActions={
        <div className="flex items-center gap-1 pr-2">
          {(
            [
              ['brush', '画笔'],
              ['rect', '矩形'],
              ['arrow', '箭头'],
              ['text', '文字'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => setTool(id)}
              className={
                tool === id
                  ? 'rounded-full bg-white/20 p-1.5 text-white'
                  : 'rounded-full p-1.5 text-white/60 hover:text-white'
              }
            >
              {id === 'brush' ? <Minus size={14} /> : id === 'rect' ? <Square size={14} /> : id === 'arrow' ? (
                <Minus size={14} className="rotate-45" />
              ) : (
                <Type size={14} />
              )}
            </button>
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
          />
          <input
            type="range"
            min={1}
            max={24}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-20"
          />
        </div>
      }
    >
      <div className="relative max-h-[72vh] max-w-[72vw]">
        <img src={imageUrl} alt="" className="max-h-[72vh] max-w-[72vw] object-contain" />
        <canvas
          ref={canvasRef}
          width={size.w || 1}
          height={size.h || 1}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
      </div>
    </EditOverlayShell>
  );
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const head = 10 + width * 1.5;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - 0.4), y2 - head * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - head * Math.cos(angle + 0.4), y2 - head * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}
