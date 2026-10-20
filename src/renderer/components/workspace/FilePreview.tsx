import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock, type CodeBlockProps } from '../agents/code-block';
import { cn } from '../../lib/cn';
import HtmlPreview from './HtmlPreview';
import { mermaidMarkdownComponents } from '../markdown/mermaidMarkdown';

export type PreviewKind = 'markdown' | 'html' | 'code';

export function previewKind(path: string): PreviewKind {
  if (/\.(md|markdown|mdx)$/i.test(path)) return 'markdown';
  if (/\.html?$/i.test(path)) return 'html';
  return 'code';
}

export function detectLanguage(path: string): CodeBlockProps['language'] {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
      return 'typescript';
    case 'tsx':
    case 'jsx':
      return 'tsx';
    case 'js':
      return 'typescript';
    case 'json':
      return 'json';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return 'text';
  }
}

/** A workspace file as the user would want to read it: rendered Markdown / HTML with a switch back to the source. */
export default function FilePreview({ path, content }: { path: string; content: string }) {
  const kind = previewKind(path);
  const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [path]);

  const code = (
    <CodeBlock
      code={content}
      language={kind === 'markdown' || kind === 'html' ? 'text' : detectLanguage(path)}
      filename={path.split(/[/\\]/).pop()}
      maxHeight={240}
      showLineNumbers
    />
  );
  if (kind === 'code') return code;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 px-2 pt-1.5" role="tablist" aria-label="文件视图">
        {([['预览', false], ['源码', true]] as const).map(([label, isSource]) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={source === isSource}
            onClick={() => setSource(isSource)}
            className={cn(
              'rounded-md px-2 py-0.5 text-xs transition-colors',
              source === isSource ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {source ? (
        code
      ) : kind === 'markdown' ? (
        <div className="markdown min-h-0 flex-1 overflow-auto px-4 py-3 text-[14px] leading-[1.75] text-ink">
          <ReactMarkdown components={mermaidMarkdownComponents} remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <div className="h-[360px] min-h-0 flex-1 p-2">
          <HtmlPreview html={content} title={path} />
        </div>
      )}
    </div>
  );
}
