import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { MASK_COLORS } from '../../../../shared/canvasImageEdit';
import { commitImageEdit } from './commitEdit';
import type { EditCommitMode } from './commitEdit';
import EditOverlayShell from './EditOverlayShell';
import { canvasToPngBlob, loadHtmlImage } from './pixelOps';
import { cn } from '../../../lib/cn';

type Rect = { x: number; y: number; w: number; h: number };
type Entry = { rect: Rect; from: string; to: string };

const MAX_ENTRIES = MASK_COLORS.length;

export default function EditTextOverlay({
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
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let live = true;
    void loadHtmlImage(imageUrl).then((img) => {
      if (live) setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    });
    return () => {
      live = false;
    };
  }, [imageUrl]);

  const norm = (clientX: number, clientY: number) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (clientY - box.top) / box.height)),
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (entries.length >= MAX_ENTRIES) return;
    const p = norm(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    const start = dragRef.current;
    if (!start) return;
    const p = norm(e.clientX, e.clientY);
    if (!p) return;
    setDraft({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    });
  };
  const onUp = () => {
    const r = draft;
    dragRef.current = null;
    setDraft(null);
    if (!r || r.w < 0.01 || r.h < 0.01) return;
    setEntries((prev) => {
      const next = [...prev, { rect: r, from: '', to: '' }];
      setSelected(next.length - 1);
      return next;
    });
  };

  const patchEntry = (i: number, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((en, j) => (j === i ? { ...en, ...patch } : en)));
  };

  const usable = entries.filter((e) => e.to.trim().length > 0);

  const confirm = async () => {
    if (!imgSize || usable.length === 0) return;
    setBusy(true);
    try {
      // Black PNG with each text region painted in its mask color.
      const mask = document.createElement('canvas');
      mask.width = imgSize.w;
      mask.height = imgSize.h;
      const ctx = mask.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, mask.width, mask.height);
      entries.forEach((en, i) => {
        if (!en.to.trim()) return;
        ctx.fillStyle = MASK_COLORS[i % MASK_COLORS.length];
        ctx.fillRect(
          Math.round(en.rect.x * imgSize.w),
          Math.round(en.rect.y * imgSize.h),
          Math.round(en.rect.w * imgSize.w),
          Math.round(en.rect.h * imgSize.h),
        );
      });
      const maskBlob = await canvasToPngBlob(mask);
      const regions = entries
        .map((en, i) => ({ en, i }))
        .filter(({ en }) => en.to.trim().length > 0)
        .map(({ en, i }) => ({
          color: MASK_COLORS[i % MASK_COLORS.length],
          instruction: en.from.trim()
            ? `把文字「${en.from.trim()}」改为「${en.to.trim()}」,保持与原图相同的字体风格、字号、颜色与排版`
            : `把该处文字改为「${en.to.trim()}」,保持与原图相同的字体风格、字号、颜色与排版`,
        }));
      await commitImageEdit(
        commitMode,
        sessionId,
        node,
        { kind: 'textEdit', regions },
        { maskBlob },
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const entryColor = (i: number) => MASK_COLORS[i % MASK_COLORS.length];
  const confirmDisabled = usable.length === 0;

  return (
    <EditOverlayShell
      title="编辑文字"
      confirmLabel="重绘文字"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      confirmDisabled={confirmDisabled}
      confirmHint={entries.length === 0 ? '在图上框出要修改的文字区域' : '为框选处填写新文字'}
    >
      <div className="relative flex h-full w-full items-center justify-center">
        <div ref={wrapRef} className="relative inline-block max-h-[64vh] max-w-[70vw] select-none">
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="block max-h-[64vh] max-w-[70vw] rounded-lg shadow-2xl"
          />
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            {entries.map((en, i) => (
              <button
                key={i}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(i);
                }}
                className={cn(
                  'absolute rounded-sm border-2 border-dashed transition-shadow',
                  selected === i ? 'ring-2 ring-white/70' : '',
                )}
                style={{
                  left: `${en.rect.x * 100}%`,
                  top: `${en.rect.y * 100}%`,
                  width: `${en.rect.w * 100}%`,
                  height: `${en.rect.h * 100}%`,
                  borderColor: entryColor(i),
                  backgroundColor: `${entryColor(i)}26`,
                }}
              >
                <span
                  className="absolute -left-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white"
                  style={{ backgroundColor: entryColor(i) }}
                >
                  {i + 1}
                </span>
              </button>
            ))}
            {draft ? (
              <div
                className="absolute rounded-sm border-2 border-dashed border-white/80 bg-white/10"
                style={{
                  left: `${draft.x * 100}%`,
                  top: `${draft.y * 100}%`,
                  width: `${draft.w * 100}%`,
                  height: `${draft.h * 100}%`,
                }}
              />
            ) : null}
            {entries.length === 0 && !draft ? (
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-4 py-1.5 text-[12px] text-white/90">
                拖动框出要修改的文字区域
              </div>
            ) : null}
          </div>
        </div>

        {entries.length > 0 ? (
          <div className="absolute right-4 top-4 w-60 space-y-2 overflow-y-auto rounded-xl border border-line bg-paper-raised/95 p-3 shadow-xl backdrop-blur">
            {entries.map((en, i) => (
              <div
                key={i}
                onClick={() => setSelected(i)}
                className={cn(
                  'cursor-pointer rounded-lg border p-2',
                  selected === i ? 'border-ink/40 bg-paper-inset' : 'border-line',
                )}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: entryColor(i) }}
                    />
                    第 {i + 1} 处
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEntries((prev) => prev.filter((_, j) => j !== i));
                      setSelected(0);
                    }}
                    className="rounded p-0.5 text-ink-faint hover:bg-paper-inset hover:text-ink"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  type="text"
                  value={en.from}
                  onChange={(e) => patchEntry(i, { from: e.target.value })}
                  placeholder="原文（选填）"
                  className="mb-1 w-full rounded-md border border-line bg-paper px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint"
                />
                <input
                  type="text"
                  value={en.to}
                  onChange={(e) => patchEntry(i, { to: e.target.value })}
                  placeholder="改为（必填）"
                  className="w-full rounded-md border border-line bg-paper px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint"
                />
              </div>
            ))}
            {entries.length >= MAX_ENTRIES ? (
              <p className="text-[11px] text-ink-muted">最多 {MAX_ENTRIES} 处</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </EditOverlayShell>
  );
}
