import { useMemo, useState, useCallback } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { Check, Copy } from 'lucide-react';
import { normalizeMarkdownFences } from '../../lib/markdown/normalizeMarkdownFences';
import * as tabStore from '../../state/tabStore';
import * as canvasStore from '../../state/canvasStore';

const STREAMDOWN_PLUGINS = { code };
const STREAMDOWN_CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
};
const STREAMDOWN_TRANSLATIONS = {
  copyCode: '复制',
  copied: '已复制',
};
const LINK_SAFETY = { enabled: false as const };

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

/**
 * Renders assistant markdown. Streaming uses Streamdown's block parser so
 * completed blocks stay memoised; settled content uses static mode.
 * Intercepts clicks on `canvas:<nodeId>` links to spotlight/focus the node on canvas.
 */
export default function MarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const markdown = useMemo(() => normalizeMarkdownFences(content), [content]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const a = target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && href.startsWith('canvas:')) {
      e.preventDefault();
      e.stopPropagation();
      const nodeId = href.slice(7);
      const sessionId = tabStore.activeSessionId();
      if (sessionId && nodeId) {
        canvasStore.spotlight(sessionId, [nodeId]);
      }
    }
  }, []);

  return (
    <div onClick={handleClick} className="[&_a[href^='canvas:']]:inline-flex [&_a[href^='canvas:']]:items-center [&_a[href^='canvas:']]:gap-1 [&_a[href^='canvas:']]:rounded-md [&_a[href^='canvas:']]:border [&_a[href^='canvas:']]:border-accent/40 [&_a[href^='canvas:']]:bg-accent/10 [&_a[href^='canvas:']]:px-1.5 [&_a[href^='canvas:']]:py-0.5 [&_a[href^='canvas:']]:text-xs [&_a[href^='canvas:']]:font-medium [&_a[href^='canvas:']]:text-accent [&_a[href^='canvas:']]:no-underline [&_a[href^='canvas:']]:cursor-pointer hover:[&_a[href^='canvas:']]:bg-accent/20 transition-colors">
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        isAnimating={streaming}
        parseIncompleteMarkdown={streaming}
        plugins={STREAMDOWN_PLUGINS}
        controls={STREAMDOWN_CONTROLS}
        translations={STREAMDOWN_TRANSLATIONS}
        linkSafety={LINK_SAFETY}
        lineNumbers={false}
        codeBlockMaxHeight={Number.POSITIVE_INFINITY}
        tableMaxHeight={Number.POSITIVE_INFINITY}
      >
        {markdown}
      </Streamdown>
    </div>
  );
}
