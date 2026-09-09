import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brush, Eraser, Lasso, Plus, Redo2, Square, Trash2, Undo2, X } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { MASK_COLORS } from '../../../../shared/canvasImageEdit';
import { createMaskCanvas, maskToBlackWhitePng, regionsToMaskPng } from './pixelOps';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import { imageLineWidth } from './editMath';
import { cn } from '../../../lib/cn';
import EditOverlayShell from './EditOverlayShell';
import EditJobStage from './EditJobStage';
import EditSlider from './EditSlider';

type Tool = 'brush' | 'rect' | 'unmask' | 'lasso';
type BBox = { minX: number; minY: number; maxX: number; maxY: number };
interface Region {
  id: string;
  color: string;
  instruction: string;
  hasInk: boolean;
}

const rid = () => Math.random().toString(36).slice(2, 9);
const freshRegion = (color: string): Region => ({ id: rid(), color, instruction: '', hasInk: false });

export default function MaskOverlay({
  sessionId,
  node,
  imageUrl,
  mode,
  commitMode = 'derive',
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  mode: 'inpaint' | 'erase';
  commitMode?: EditCommitMode;
  onClose: () => void;
}) {
  const isErase = mode === 'erase';

  const imgRef = useRef<HTMLImageElement>(null);
  const tintRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const regionCanvases = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const bboxes = useRef<Map<string, BBox>>(new Map());
  const undoStacks = useRef<Map<string, ImageData[]>>(new Map());
  const redoStacks = useRef<Map<string, ImageData[]>>(new Map());
  const drawing = useRef<{ x: number; y: number; pts: Array<{ x: number; y: number }> } | null>(null);
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceDown = useRef(false);
  const barFocused = useRef(false);

  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState(28);
  const [feather, setFeather] = useState(0);
  const [regions, setRegions] = useState<Region[]>(() => [freshRegion(MASK_COLORS[0])]);
  const [activeId, setActiveId] = useState<string>(() => regions[0].id);
  const [busy, setBusy] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });
  const [viewZoom, setViewZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const ready = imgSize.w > 1;
  const activeRegion = regions.find((r) => r.id === activeId) ?? regions[0];
  const anyInk = regions.some((r) => r.hasInk);
  const usedColors = useMemo(() => new Set(regions.map((r) => r.color)), [regions]);

  // --- image + buffers ---------------------------------------------------------

  const initFromImage = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    regionCanvases.current.clear();
    bboxes.current.clear();
    undoStacks.current.clear();
    redoStacks.current.clear();
    scratchRef.current = createMaskCanvas(w, h);
    setImgSize({ w, h });
  }, []);

  useEffect(() => {
    regionCanvases.current.clear();
    bboxes.current.clear();
    undoStacks.current.clear();
    redoStacks.current.clear();
    const first = freshRegion(MASK_COLORS[0]);
    setRegions([first]);
    setActiveId(first.id);
    setImgSize({ w: 1, h: 1 });
    setAnchor(null);
    if (imgRef.current?.complete) initFromImage();
  }, [imageUrl, initFromImage]);

  const regionCanvas = (id: string): HTMLCanvasElement | null => {
    if (imgSize.w <= 1) return null;
    let c = regionCanvases.current.get(id);
    if (!c) {
      c = createMaskCanvas(imgSize.w, imgSize.h);
      regionCanvases.current.set(id, c);
    }
    return c;
  };

  // --- coordinate + geometry helpers ----------------------------------------

  const displayWidth = () => imgRef.current?.getBoundingClientRect().width || 1;
  const lineW = () => imageLineWidth(brush, displayWidth(), imgSize.w);

  const toImage = (e: { clientX: number; clientY: number }) => {
    const canvas = tintRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * canvas.width,
      y: ((e.clientY - box.top) / box.height) * canvas.height,
    };
  };

  const growBBox = (id: string, p: { x: number; y: number }) => {
    const pad = lineW() / 2;
    const b = bboxes.current.get(id) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, p.x - pad);
    b.minY = Math.min(b.minY, p.y - pad);
    b.maxX = Math.max(b.maxX, p.x + pad);
    b.maxY = Math.max(b.maxY, p.y + pad);
    bboxes.current.set(id, b);
  };

  const computeAnchor = useCallback(
    (id: string) => {
      const img = imgRef.current;
      const b = bboxes.current.get(id);
      if (!img || !b || !Number.isFinite(b.minX)) return null;
      const ir = img.getBoundingClientRect();
      const sx = (v: number) => ir.left + (v / imgSize.w) * ir.width;
      const sy = (v: number) => ir.top + (v / imgSize.h) * ir.height;
      const cx = Math.min(window.innerWidth - 200, Math.max(200, (sx(b.minX) + sx(b.maxX)) / 2));
      const below = sy(b.maxY) + 14;
      const above = sy(b.minY) - 14 - 52;
      const y = below + 60 > window.innerHeight - 150 ? Math.max(72, above) : below;
      return { x: cx, y };
    },
    [imgSize.w, imgSize.h],
  );

  useEffect(() => {
    if (isErase) return;
    if (!activeRegion?.hasInk) {
      setAnchor(null);
      return;
    }
    if (!barFocused.current) setAnchor(computeAnchor(activeId));
  }, [activeId, isErase, activeRegion?.hasInk, computeAnchor]);

  // --- tint compositing ------------------------------------------------------

  const rebuildTint = useCallback(() => {
    const tint = tintRef.current;
    const tctx = tint?.getContext('2d');
    const scratch = scratchRef.current;
    const sctx = scratch?.getContext('2d');
    if (!tint || !tctx || !scratch || !sctx) return;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, tint.width, tint.height);
    for (const r of regions) {
      const rc = regionCanvases.current.get(r.id);
      if (!rc) continue;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.drawImage(rc, 0, 0);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = isErase ? '#ffffff' : r.color;
      sctx.fillRect(0, 0, scratch.width, scratch.height);
      sctx.globalCompositeOperation = 'source-over';
      tctx.globalAlpha = r.id === activeId || isErase ? 1 : 0.65;
      tctx.drawImage(scratch, 0, 0);
      tctx.globalAlpha = 1;
    }
  }, [regions, activeId, isErase]);

  useEffect(() => {
    rebuildTint();
  }, [rebuildTint]);

  // --- painting ------------------------------------------------------------

  const snapshot = (id: string) => {
    const c = regionCanvases.current.get(id);
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const st = undoStacks.current.get(id) ?? [];
    st.push(ctx.getImageData(0, 0, c.width, c.height));
    if (st.length > 40) st.shift();
    undoStacks.current.set(id, st);
    redoStacks.current.set(id, []);
  };

  const markInk = (id: string) => {
    setRegions((rs) => (rs.find((r) => r.id === id)?.hasInk ? rs : rs.map((r) => (r.id === id ? { ...r, hasInk: true } : r))));
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, erase: boolean) => {
    const ctx = regionCanvas(activeId)?.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lineW();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    if (!erase) growBBox(activeId, to);
    rebuildTint();
  };

  const clearPreview = () => {
    const p = previewRef.current?.getContext('2d');
    if (p && previewRef.current) p.clearRect(0, 0, previewRef.current.width, previewRef.current.height);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (spaceDown.current || e.button === 1) {
      panDrag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (!regionCanvas(activeId)) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    snapshot(activeId);
    const p = toImage(e);
    drawing.current = { ...p, pts: [p] };
    if (tool === 'brush' || tool === 'unmask') {
      stroke(p, p, tool === 'unmask');
      markInk(activeId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
    if (panDrag.current) {
      setPan({
        x: panDrag.current.panX + (e.clientX - panDrag.current.x),
        y: panDrag.current.panY + (e.clientY - panDrag.current.y),
      });
      return;
    }
    const d = drawing.current;
    if (!d) return;
    const p = toImage(e);
    if (tool === 'brush' || tool === 'unmask') {
      stroke({ x: d.x, y: d.y }, p, tool === 'unmask');
      d.x = p.x;
      d.y = p.y;
      markInk(activeId);
      return;
    }
    d.pts.push(p);
    const preview = previewRef.current;
    const ctx = preview?.getContext('2d');
    if (!preview || !ctx) return;
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.strokeStyle = isErase ? '#ffffff' : activeRegion.color;
    ctx.setLineDash([imageLineWidth(6, displayWidth(), imgSize.w), imageLineWidth(4, displayWidth(), imgSize.w)]);
    ctx.lineWidth = imageLineWidth(2, displayWidth(), imgSize.w);
    ctx.beginPath();
    if (tool === 'rect') ctx.strokeRect(d.pts[0].x, d.pts[0].y, p.x - d.pts[0].x, p.y - d.pts[0].y);
    else {
      ctx.moveTo(d.pts[0].x, d.pts[0].y);
      for (const pt of d.pts) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  };

  const onPointerUp = () => {
    panDrag.current = null;
    const d = drawing.current;
    drawing.current = null;
    clearPreview();
    const ctx = regionCanvas(activeId)?.getContext('2d');
    if (d && ctx) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      const last = d.pts[d.pts.length - 1];
      if (tool === 'rect' && last) {
        const rw = last.x - d.pts[0].x;
        const rh = last.y - d.pts[0].y;
        if (Math.abs(rw) > 3 && Math.abs(rh) > 3) {
          ctx.fillRect(d.pts[0].x, d.pts[0].y, rw, rh);
          growBBox(activeId, d.pts[0]);
          growBBox(activeId, last);
          markInk(activeId);
          rebuildTint();
        }
      }
      if (tool === 'lasso' && d.pts.length > 3) {
        ctx.beginPath();
        ctx.moveTo(d.pts[0].x, d.pts[0].y);
        for (const pt of d.pts) {
          ctx.lineTo(pt.x, pt.y);
          growBBox(activeId, pt);
        }
        ctx.closePath();
        ctx.fill();
        markInk(activeId);
        rebuildTint();
      }
    }
    if (!isErase && !barFocused.current) setAnchor(computeAnchor(activeId));
  };

  // --- history + regions --------------------------------------------------

  const undoStep = useCallback(() => {
    const c = regionCanvases.current.get(activeId);
    const ctx = c?.getContext('2d');
    const st = undoStacks.current.get(activeId) ?? [];
    if (!c || !ctx || st.length === 0) return;
    const prev = st.pop();
    if (!prev) return;
    const rst = redoStacks.current.get(activeId) ?? [];
    rst.push(ctx.getImageData(0, 0, c.width, c.height));
    redoStacks.current.set(activeId, rst);
    ctx.putImageData(prev, 0, 0);
    rebuildTint();
  }, [activeId, rebuildTint]);

  const redoStep = useCallback(() => {
    const c = regionCanvases.current.get(activeId);
    const ctx = c?.getContext('2d');
    const rst = redoStacks.current.get(activeId) ?? [];
    if (!c || !ctx || rst.length === 0) return;
    const next = rst.pop();
    if (!next) return;
    const st = undoStacks.current.get(activeId) ?? [];
    st.push(ctx.getImageData(0, 0, c.width, c.height));
    undoStacks.current.set(activeId, st);
    ctx.putImageData(next, 0, 0);
    rebuildTint();
  }, [activeId, rebuildTint]);

  const clearActive = () => {
    const c = regionCanvases.current.get(activeId);
    const ctx = c?.getContext('2d');
    if (c && ctx) {
      snapshot(activeId);
      ctx.clearRect(0, 0, c.width, c.height);
    }
    bboxes.current.delete(activeId);
    setRegions((rs) => rs.map((r) => (r.id === activeId ? { ...r, hasInk: false } : r)));
    setAnchor(null);
    rebuildTint();
  };

  const addRegion = () => {
    if (!activeRegion.hasInk) return;
    const color = MASK_COLORS.find((c) => !usedColors.has(c)) ?? MASK_COLORS[regions.length % MASK_COLORS.length];
    const r = freshRegion(color);
    setRegions((rs) => [...rs, r]);
    setActiveId(r.id);
    setAnchor(null);
    barFocused.current = false;
  };

  const removeRegion = (id: string) => {
    regionCanvases.current.delete(id);
    bboxes.current.delete(id);
    undoStacks.current.delete(id);
    redoStacks.current.delete(id);
    setRegions((rs) => {
      const next = rs.filter((r) => r.id !== id);
      if (next.length === 0) {
        const f = freshRegion(MASK_COLORS[0]);
        setActiveId(f.id);
        return [f];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const setActiveColor = (color: string) => {
    if (usedColors.has(color) && activeRegion.color !== color) return;
    setRegions((rs) => rs.map((r) => (r.id === activeId ? { ...r, color } : r)));
  };

  const setActiveText = (instruction: string) => {
    setRegions((rs) => rs.map((r) => (r.id === activeId ? { ...r, instruction } : r)));
  };

  // --- keyboard, zoom -----------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !barFocused.current) {
        spaceDown.current = e.type === 'keydown';
        if (e.type === 'keydown') e.preventDefault();
      }
      if (e.type !== 'keydown') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoStep();
        else undoStep();
      }
      if (!barFocused.current && e.key === '[') setBrush((b) => Math.max(8, b - 4));
      if (!barFocused.current && e.key === ']') setBrush((b) => Math.min(80, b + 4));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [undoStep, redoStep]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setViewZoom((z) => Math.min(6, Math.max(0.4, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  };

  // --- confirm ----------------------------------------------------------

  const confirm = async () => {
    const featherPx = feather ? imageLineWidth(feather, displayWidth(), imgSize.w) : 0;
    let blob: Blob | null = null;
    let regionSpec: Array<{ color: string; instruction: string }> | undefined;

    if (isErase) {
      const c = regionCanvases.current.get(activeId);
      if (!c) return;
      blob = await maskToBlackWhitePng(c, featherPx);
    } else {
      const inked = regions
        .map((r) => ({ region: r, canvas: regionCanvases.current.get(r.id) }))
        .filter((x): x is { region: Region; canvas: HTMLCanvasElement } => x.region.hasInk && !!x.canvas);
      if (inked.length === 0) return;
      blob = await regionsToMaskPng(
        inked.map((x) => ({ canvas: x.canvas, color: x.region.color })),
        imgSize.w,
        imgSize.h,
        featherPx,
      );
      regionSpec = inked.map((x) => ({ color: x.region.color, instruction: x.region.instruction.trim() }));
    }
    if (!blob) return;

    setBusy(true);
    try {
      const id = await commitImageEdit(
        commitMode,
        sessionId,
        node,
        {
          kind: mode,
          instruction: isErase ? undefined : regionSpec?.[0]?.instruction || undefined,
          regions: regionSpec && regionSpec.length > 1 ? regionSpec : undefined,
        },
        { maskBlob: blob },
      );
      if (id) setJobId(id);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const confirmDisabled = isErase ? !activeRegion.hasInk : !anyInk;

  // --- render ----------------------------------------------------------

  const chips = regions.filter((r) => r.hasInk || r.id === activeId);

  return (
    <EditOverlayShell
      title={isErase ? '擦除' : '重绘'}
      confirmLabel={isErase ? '确认擦除' : anyInk && regions.filter((r) => r.hasInk).length > 1 ? '一起生成' : '开始重绘'}
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      confirmDisabled={confirmDisabled}
      confirmHint={confirmDisabled ? '先涂抹要修改的区域' : undefined}
      hideActions={Boolean(jobId)}
      extraActions={
        jobId ? null : (
          <div className="flex items-center gap-1 pr-2">
            {(
              [
                ['brush', '画笔', Brush],
                ['rect', '矩形', Square],
                ['lasso', '套索', Lasso],
                ['unmask', '取消选区（橡皮）', Eraser],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => setTool(id)}
                className={tool === id ? 'rounded-full bg-paper-inset p-1.5 text-ink' : 'rounded-full p-1.5 text-ink-muted hover:text-ink'}
              >
                <Icon size={14} />
              </button>
            ))}
            {!isErase ? (
              <>
                <span className="mx-0.5 h-4 w-px bg-line" />
                {MASK_COLORS.map((c) => {
                  const taken = usedColors.has(c) && activeRegion.color !== c;
                  return (
                    <button
                      key={c}
                      type="button"
                      title={taken ? '已被其它区域使用' : '当前区域颜色'}
                      disabled={taken}
                      onClick={() => setActiveColor(c)}
                      className={cn(
                        'h-4 w-4 rounded-full',
                        activeRegion.color === c ? 'ring-2 ring-ink ring-offset-1 ring-offset-paper-raised' : 'ring-1 ring-line',
                        taken && 'opacity-25',
                      )}
                      style={{ background: c }}
                    />
                  );
                })}
              </>
            ) : null}
            <span className="mx-0.5 h-4 w-px bg-line" />
            <button type="button" title="撤销 (⌘Z)" onClick={undoStep} className="rounded-full p-1.5 text-ink-muted hover:text-ink">
              <Undo2 size={14} />
            </button>
            <button type="button" title="重做 (⌘⇧Z)" onClick={redoStep} className="rounded-full p-1.5 text-ink-muted hover:text-ink">
              <Redo2 size={14} />
            </button>
            <button type="button" title={isErase ? '清空蒙版' : '清空当前区域'} onClick={clearActive} className="rounded-full p-1.5 text-ink-muted hover:text-ink">
              <Trash2 size={14} />
            </button>
            <div className="flex items-center gap-1.5 pl-1 text-[11px] text-ink-muted">
              笔刷
              <input
                type="range"
                min={8}
                max={80}
                value={brush}
                onChange={(e) => setBrush(Number(e.target.value))}
                className="edit-slider w-24"
              />
              <span className="w-6 tabular-nums text-ink">{brush}</span>
            </div>
          </div>
        )
      }
      footer={
        jobId ? null : (
          <div className="flex w-[min(560px,86vw)] flex-col items-center gap-2">
            {!isErase ? (
              <p className="text-[11px] text-ink-muted">
                涂一处 → 就地写它要改成什么 → 回车标记下一处 → <span className="text-ink">⌘/Ctrl+Enter 一次生成</span>
              </p>
            ) : null}
            <EditSlider label="羽化" value={feather} display={feather ? `${feather}` : '无'} min={0} max={24} onChange={setFeather} className="w-64" />
          </div>
        )
      }
    >
      {jobId ? (
        <EditJobStage
          sessionId={sessionId}
          jobId={jobId}
          beforeUrl={imageUrl}
          onAccept={onClose}
          onDiscard={onClose}
          allowDelete={commitMode !== 'revise'}
        />
      ) : (
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden" onWheel={onWheel}>
          <div
            className="relative"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${viewZoom})`, transformOrigin: 'center center' }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={initFromImage}
              className="block max-h-[68vh] max-w-[86vw] select-none"
            />
            <canvas
              ref={tintRef}
              width={imgSize.w}
              height={imgSize.h}
              className="pointer-events-none absolute inset-0 h-full w-full opacity-45"
              style={{ filter: feather ? `blur(${feather * viewZoom}px)` : undefined }}
            />
            <canvas
              ref={previewRef}
              width={imgSize.w}
              height={imgSize.h}
              className="absolute inset-0 h-full w-full cursor-none"
              style={{ touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setCursor(null)}
            />
          </div>

          {/* region rail */}
          {!isErase && (chips.length > 1 || chips[0]?.hasInk) ? (
            <div className="absolute left-3 top-3 z-[214] flex max-w-[240px] flex-col gap-1">
              {chips.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className={cn(
                    'group/chip flex items-center gap-2 rounded-lg border px-2 py-1 text-left text-[11px] transition-colors',
                    r.id === activeId ? 'border-ink bg-paper-raised text-ink' : 'border-line bg-paper-raised/85 text-ink-muted hover:text-ink',
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: r.color }} />
                  <span className="min-w-0 flex-1 truncate">{r.instruction || `区域 ${i + 1}`}</span>
                  {regions.length > 1 ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRegion(r.id);
                      }}
                      className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 hover:bg-paper-inset hover:text-danger group-hover/chip:opacity-100"
                    >
                      <X size={11} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {/* anchored per-region prompt bar */}
          {!isErase && anchor && activeRegion.hasInk ? (
            <div
              className="fixed z-[216] w-[min(400px,86vw)] -translate-x-1/2 rounded-2xl border border-line bg-paper-raised/98 p-2 shadow-2xl backdrop-blur"
              style={{ left: anchor.x, top: anchor.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: activeRegion.color }} />
                <input
                  autoFocus
                  value={activeRegion.instruction}
                  onChange={(e) => setActiveText(e.target.value)}
                  onFocus={() => {
                    barFocused.current = true;
                  }}
                  onBlur={() => {
                    barFocused.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void confirm();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      addRegion();
                    }
                  }}
                  placeholder="这一处改成什么？留空 = 智能移除"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                />
                <button
                  type="button"
                  onClick={addRegion}
                  title="标记下一处 (Enter)"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
                >
                  <Plus size={12} />
                  下一处
                </button>
              </div>
            </div>
          ) : null}

          {cursor && ready ? (
            <div
              className="pointer-events-none fixed z-[210] rounded-full border-2 border-white mix-blend-difference"
              style={{
                left: cursor.x,
                top: cursor.y,
                width: brush * viewZoom,
                height: brush * viewZoom,
                transform: 'translate(-50%, -50%)',
              }}
            />
          ) : null}
          {!ready ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-ink-muted">图片加载中…</div>
          ) : null}
        </div>
      )}
    </EditOverlayShell>
  );
}
