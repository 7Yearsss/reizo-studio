import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

export default function AssistantMessage({
  content,
  parts,
  streaming = false,
}: {
  content: string;
  parts?: ToolCallPart[];
  streaming?: boolean;
}) {
  return (
    <div className="group space-y-3">
      {parts?.map((part) => (
        <ToolCard key={part.id} part={part} />
      ))}
      <div className="markdown text-[15px] leading-[1.75] text-ink">
        {content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ children }) {
                const text = collectText(children);
                return (
                  <div className="group/code relative">
                    <pre>{children}</pre>
                    <button
                      type="button"
                      className="absolute top-2 right-2 hidden rounded bg-paper px-1.5 py-0.5 text-[10px] text-ink-muted group-hover/code:block"
                      onClick={() => void navigator.clipboard.writeText(text)}
                    >
                      复制
                    </button>
                  </div>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        ) : streaming && !parts?.length ? (
          <span className="text-ink-muted">…</span>
        ) : null}
      </div>
      {content && (
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(content)}
          className="hidden text-[11px] text-ink-muted group-hover:inline hover:text-ink"
        >
          复制
        </button>
      )}
    </div>
  );
}
