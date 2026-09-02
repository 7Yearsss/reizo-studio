import { useMemo, useState } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { Check, Copy } from 'lucide-react';
import { normalizeMarkdownFences } from '../../lib/markdown/normalizeMarkdownFences';

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
 */
export default function MarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const markdown = useMemo(() => normalizeMarkdownFences(content), [content]);
  return (
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
  );
}
