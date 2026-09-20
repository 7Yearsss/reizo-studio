import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function SkillDetailModal({
  icon,
  coverSrc,
  title,
  subtitle,
  chips,
  loadMarkdown,
  onClose,
  footer,
}: {
  icon?: React.ReactNode;
  /** Resolved image URL shown as a banner above the body. */
  coverSrc?: string | null;
  title: string;
  subtitle?: string;
  chips?: React.ReactNode;
  /** Fetches the SKILL.md body to render; should resolve to null on failure. */
  loadMarkdown: () => Promise<string | null>;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    loadMarkdown()
      .then((text) => {
        if (cancelled) return;
        setMarkdown(text);
        setState(text === null ? 'error' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [loadMarkdown]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-line px-6 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold">{title}</h2>
              {chips}
            </div>
            {subtitle && <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-full p-1 text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        {coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            className="max-h-52 w-full border-b border-line object-cover"
            loading="lazy"
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {state === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-ink-muted">
              <Loader2 size={14} className="animate-spin" />
              加载技能说明…
            </div>
          ) : state === 'error' || !markdown ? (
            <p className="py-16 text-center text-xs text-ink-muted">没能加载这个技能的 SKILL.md 内容。</p>
          ) : (
            <article className="prose-sm max-w-none text-sm leading-6 text-ink [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-paper-inset [&_pre]:p-3 [&_pre]:text-xs [&_code]:rounded [&_code]:bg-paper-inset [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </article>
          )}
        </div>

        {footer && <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
