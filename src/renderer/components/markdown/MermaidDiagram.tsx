import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Check, Copy } from 'lucide-react';
import { isMermaidDrawing, renderMermaid } from '../../lib/markdown/renderMermaid';

const THEME = {
  '--pele-bg': 'var(--paper-raised)',
  '--pele-fg': 'var(--ink)',
  '--pele-muted': 'var(--ink-muted)',
  '--pele-line': 'var(--ink)',
  '--pele-surface': 'var(--paper-inset)',
  '--pele-surface-alt': 'var(--paper)',
  '--pele-border': 'var(--line)',
  '--pele-accent': 'var(--ink)',
  '--pele-critical': 'var(--danger)',
  '--pele-radius': '6px',
} as CSSProperties;

function idPrefix(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '');
  return `d${clean || '0'}`;
}

export default function MermaidDiagram({ source, pending = false }: { source: string; pending?: boolean }) {
  const prefix = idPrefix(useId());
  const drawn = useMemo(
    () => (pending ? null : renderMermaid(source, prefix)),
    [pending, source, prefix],
  );

  return (
    <figure
      data-mermaid={pending ? 'pending' : drawn && isMermaidDrawing(drawn) ? drawn.type : 'error'}
      className="my-3 overflow-hidden rounded-xl border border-line bg-paper-raised"
      style={THEME}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-ink-muted">
        <span>图表</span>
        {pending && <span>编写中</span>}
        <span className="ml-auto">
          <CopySource text={source} />
        </span>
      </div>
      {pending || !drawn ? (
        <pre className="mx-2 mb-2 overflow-x-auto rounded-lg bg-paper-inset p-2 font-mono text-[11px] leading-5 text-ink">{source}</pre>
      ) : isMermaidDrawing(drawn) ? (
        <div className="overflow-x-auto px-2 pb-2" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      ) : (
        <>
          <p className="px-2.5 pb-1 text-[11px] text-danger">{drawn.message}</p>
          <pre className="mx-2 mb-2 overflow-x-auto rounded-lg bg-paper-inset p-2 font-mono text-[11px] leading-5 text-ink">{source}</pre>
        </>
      )}
    </figure>
  );
}

function CopySource({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-paper-inset hover:text-ink"
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
