import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { rectFromPoints, toImageRect, type Point, type Rect } from '../../../shared/cropRect';

export const SCREENSHOT_CAPTURED_EVENT = 'reizo:screenshot-captured';

/** Crop a PNG data URL to `rect` (real image pixels) and return it as a file. */
async function cropToFile(dataUrl: string, rect: Rect | null, name: string): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('截图无法读取'));
    el.src = dataUrl;
  });
  const box = rect ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const canvas = document.createElement('canvas');
  canvas.width = box.width;
  canvas.height = box.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法处理截图');
  context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/png'); });
  if (!blob) throw new Error('无法处理截图');
  return new File([blob], name, { type: 'image/png' });
}

/**
 * Right after the screenshot shortcut: the picture comes up full size, drag a box around the part to ask about
 * (Enter or the button sends it; no box sends the whole picture; Esc throws it away).
 */
export default function ScreenshotCropDialog({ onDone }: { onDone: (file: File) => void }): ReactElement | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const open = (event: Event): void => {
      setDataUrl((event as CustomEvent<{ dataUrl: string }>).detail.dataUrl);
      setSelection(null);
      setDrag(null);
    };
    window.addEventListener(SCREENSHOT_CAPTURED_EVENT, open);
    return (): void => window.removeEventListener(SCREENSHOT_CAPTURED_EVENT, open);
  }, []);

  const name = (): string => `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

  async function confirm(): Promise<void> {
    const current = dataUrl;
    const img = imageRef.current;
    if (!current || !img) return;
    const rect = selection ? toImageRect(selection, { width: img.clientWidth, height: img.clientHeight }, { width: img.naturalWidth, height: img.naturalHeight }) : null;
    setDataUrl(null);
    onDone(await cropToFile(current, rect, name()));
  }

  useEffect(() => {
    if (!dataUrl) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDataUrl(null);
      else if (event.key === 'Enter') void confirm();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  });

  if (!dataUrl) return null;

  const local = (event: ReactPointerEvent<HTMLElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(Math.max(0, event.clientX - box.left), box.width), y: Math.min(Math.max(0, event.clientY - box.top), box.height) };
  };
  const live = drag ? rectFromPoints(drag.from, drag.to) : selection;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/70 p-6" role="dialog" aria-label="截图提问">
      <p className="text-sm text-white/80">拖动框选要问的区域，回车发送；不框选则发送整张图，Esc 放弃</p>
      <div
        className="relative max-h-[78vh] max-w-[92vw] cursor-crosshair select-none"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const p = local(event); setSelection(null); setDrag({ from: p, to: p }); }}
        onPointerMove={(event) => { if (drag) setDrag({ from: drag.from, to: local(event) }); }}
        onPointerUp={() => { if (drag) { setSelection(rectFromPoints(drag.from, drag.to)); setDrag(null); } }}
      >
        <img ref={imageRef} src={dataUrl} alt="截图" draggable={false} className="block max-h-[78vh] max-w-[92vw] object-contain" />
        {live && live.width > 0 && live.height > 0 && (
          <div className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: live.x, top: live.y, width: live.width, height: live.height, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setDataUrl(null)} className="rounded-full px-4 py-1.5 text-sm text-white/80 hover:text-white">放弃</button>
        <button type="button" onClick={() => void confirm()} className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black">{selection ? '发送选中区域' : '发送整张图'}</button>
      </div>
    </div>
  );
}
