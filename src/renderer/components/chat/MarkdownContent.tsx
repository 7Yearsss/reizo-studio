import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import {
  splitStreamingMarkdownChunks,
} from '../../lib/markdown/splitStreamingMarkdownChunks';
import { repairStreamingMarkdown } from '../../lib/markdown/repairStreamingMarkdown';

// Module-level constants — inline arrays would give react-markdown a new
// identity every render and defeat memoisation of sealed blocks.
const REMARK_PLUGINS = [remarkGfm];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REHYPE_PLUGINS: any = [[rehypeHighlight, { ignoreMissing: true }]];

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

export function CopyButton({ text, className }: { text: string; className?: string }) {
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

const MD_COMPONENTS: Components = {
  pre({ children }) {
    const text = collectText(children);
    const lang = languageFromChildren(children);
    return (
      <div className="group/code relative my-2 overflow-hidden rounded-lg border border-line">
        <div className="flex items-center justify-between bg-paper-inset/70 px-3 py-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">{lang || 'code'}</span>
          <CopyButton
            text={text}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-muted opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 hover:text-ink"
          />
        </div>
        <pre className="code-block !mt-0 !rounded-none !border-0">{children}</pre>
      </div>
    );
  },
};

function MarkdownBlockImpl({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

/** A sealed prefix block — never re-renders once its text is fixed. */
const SealedBlock = memo(MarkdownBlockImpl, (a, b) => a.text === b.text);

/**
 * Renders assistant markdown. While streaming, the content is split into
 * sealed prefix blocks (memoised, parsed once) + a repaired growing tail
 * that re-parses per token. When settled, it's one plain render.
 */
export default function MarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  if (!streaming) return <MarkdownBlockImpl text={content} />;

  const chunks = splitStreamingMarkdownChunks(content);
  return (
    <>
      {chunks.map((chunk) =>
        chunk.sealed ? (
          <SealedBlock key={chunk.start} text={chunk.text} />
        ) : (
          <MarkdownBlockImpl key="__tail" text={repairStreamingMarkdown(chunk.text)} />
        ),
      )}
    </>
  );
}
