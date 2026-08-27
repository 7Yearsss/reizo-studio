import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { ToolCallPart } from '../../../main/server/storage/ports';
import ToolCard from './ToolCard';

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return collectText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function languageFromChildren(children: ReactNode): string {
  const child = Array.isArray(children) ? children[0] : children;
  if (child && typeof child === 'object' && 'props' in child) {
    const cls = String((child as { props: { className?: string } }).props.className ?? '');
    const match = cls.match(/language-([\w+-]+)/);
    return match?.[1] ?? '';
  }
  return '';
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function StreamingCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-0.5 animate-pulse rounded-sm bg-accent align-text-bottom"
      aria-hidden
    />
  );
}

export default function AssistantMessage({
  content,
  parts,
  streaming = false,
  currentMatch = false,
  canRetry = false,
  onRetry,
}: {
  content: string;
  parts?: ToolCallPart[];
  streaming?: boolean;
  currentMatch?: boolean;
  canRetry?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`anim-msg group space-y-3 ${currentMatch ? 'chat-search-current' : ''}`}>
      {parts?.map((part) => (
        <ToolCard key={part.id} part={part} />
      ))}
      <div className="markdown text-[15px] leading-[1.75] text-ink">
        {content ? (
          <>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
              components={{
                pre({ children }) {
                  const text = collectText(children);
                  const lang = languageFromChildren(children);
                  return (
                    <div className="group/code relative my-2 overflow-hidden rounded-lg border border-line">
                      <div className="flex items-center justify-between bg-paper-inset/70 px-3 py-1">
                        <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                          {lang || 'code'}
                        </span>
                        <CopyButton
                          text={text}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-muted opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 hover:text-ink"
                        />
                      </div>
                      <pre className="code-block !mt-0 !rounded-none !border-0">{children}</pre>
                    </div>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
            {streaming && <StreamingCaret />}
          </>
        ) : streaming && !parts?.length ? (
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <StreamingCaret />
            <span className="text-[12px]">正在回复</span>
          </span>
        ) : null}
      </div>
      {content && !streaming && (
        <div className="flex gap-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyButton
            text={content}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
          />
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
            >
              <RotateCcw size={11} />
              重新生成
            </button>
          )}
        </div>
      )}
    </div>
  );
}
