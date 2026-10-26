import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { previewDelay, previewLines, type PreviewLine } from '../../../shared/sessionPreview';
import * as api from '../../api';

export interface HoverTarget { id: string; title: string; top: number; left: number }

const cache = new Map<string, { at: number; lines: PreviewLine[] }>();
const CACHE_MS = 15_000;

async function linesFor(id: string): Promise<PreviewLine[]> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.lines;
  const session = await api.getSession(id);
  const lines = previewLines(session.messages);
  cache.set(id, { at: Date.now(), lines });
  return lines;
}

/**
 * Hover a conversation in the sidebar to see its last few messages. The first hover waits a moment; while one preview is
 * open or just closed, moving to the next row switches at once. Esc, a hidden window, a lost focus or a context menu
 * close it, and the card never takes pointer events or focus.
 */
export function useSessionHoverPreview(): { bind: (id: string, title: string) => { onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void; onMouseLeave: () => void; onContextMenu: () => void }; card: ReactElement | null } {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastClosed = useRef<number | null>(null);

  const close = useCallback((): void => {
    window.clearTimeout(timer.current);
    setTarget((current) => { if (current) lastClosed.current = Date.now(); return null; });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    const onHide = (): void => { if (document.hidden) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    document.addEventListener('visibilitychange', onHide);
    return (): void => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      document.removeEventListener('visibilitychange', onHide);
      window.clearTimeout(timer.current);
    };
  }, [close]);

  const bind = (id: string, title: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>): void => {
      const rect = e.currentTarget.getBoundingClientRect();
      const next: HoverTarget = { id, title, top: rect.top, left: rect.right + 8 };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setTarget(next), previewDelay(target ? Date.now() : lastClosed.current, Date.now()));
    },
    onMouseLeave: (): void => {
      window.clearTimeout(timer.current);
      // Keep the card for a beat so the next row can take it over without a gap.
      timer.current = window.setTimeout(close, 150);
    },
    onContextMenu: close,
  });

  return { bind, card: target ? <PreviewCard target={target} /> : null };
}

function PreviewCard({ target }: { target: HoverTarget }): ReactElement {
  const [lines, setLines] = useState<PreviewLine[] | null>(cache.get(target.id)?.lines ?? null);
  useEffect(() => {
    let cancelled = false;
    setLines(cache.get(target.id)?.lines ?? null);
    void linesFor(target.id).then((next) => { if (!cancelled) setLines(next); }, (): void => { if (!cancelled) setLines([]); });
    return (): void => { cancelled = true; };
  }, [target.id]);

  const top = Math.max(8, Math.min(target.top, window.innerHeight - 220));
  return (
    <div role="tooltip" className="pointer-events-none fixed z-50 w-72 rounded-xl border border-line bg-paper-raised p-3 shadow-xl" style={{ top, left: target.left }}>
      <p className="mb-1.5 truncate text-[12px] font-medium text-ink">{target.title}</p>
      {lines === null ? (
        <p className="text-[11px] text-ink-muted">加载中…</p>
      ) : lines.length === 0 ? (
        <p className="text-[11px] text-ink-muted">还没有消息</p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line, i) => (
            <li key={i} className="text-[11px] leading-snug text-ink-muted">
              <span className="mr-1 font-medium text-ink/70">{line.role === 'user' ? '你' : 'AI'}</span>
              <span className="line-clamp-3">{line.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
