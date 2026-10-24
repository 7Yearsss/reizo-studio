import { useMemo, useState, useCallback, type ReactNode } from 'react';
import type { PluggableList } from 'unified';
import { Streamdown, defaultRemarkPlugins } from 'streamdown';
import { code } from '@streamdown/code';
import { Check, Copy } from 'lucide-react';
import { normalizeMarkdownFences } from '../../lib/markdown/normalizeMarkdownFences';
import { stripThinkTags } from '../../lib/markdown/stripThinkTags';
import * as tabStore from '../../state/tabStore';
import * as canvasStore from '../../state/canvasStore';
import * as uiStore from '../../state/uiStore';
import { requestSheetFocus } from '../../state/sheetWorkspace';
import { linkSheetCells, parseSheetCellHref } from '../../lib/markdown/linkSheetCells';
import { MermaidStreamBlock } from '../markdown/mermaidMarkdown';
import { workspaceFileLinks, workspaceFilePath } from '../../lib/markdown/workspaceFileLinks';
import WorkspaceFileDialog from '../workspace/WorkspaceFileDialog';
import { openArtifact } from '../../state/artifactStore';
import { compactFileReply, type GeneratedReplyFile } from '../../lib/markdown/compactFileReply';

const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), workspaceFileLinks];
const NO_GENERATED_FILES: GeneratedReplyFile[] = [];
const MARKDOWN_COMPONENTS = {
  strong: ({ children }: { children?: ReactNode }) => <strong data-streamdown="strong">{children}</strong>,
};

const STREAMDOWN_PLUGINS = {
  code,
  renderers: [{ language: ['mermaid', 'mmd'], component: MermaidStreamBlock }],
};
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
  generatedFiles = NO_GENERATED_FILES,
}: {
  content: string;
  streaming?: boolean;
  generatedFiles?: GeneratedReplyFile[];
}) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const markdown = useMemo(() => linkSheetCells(normalizeMarkdownFences(stripThinkTags(content))), [content]);
  // Streamdown keys its processor cache by plugin name/options. Pass files as
  // options so one message's download policy cannot leak into another message.
  const remarkPlugins = useMemo<PluggableList>(() => [...REMARK_PLUGINS, [compactFileReply, { files: generatedFiles, compactSummaries: !streaming }]], [generatedFiles, streaming]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const a = target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href?.startsWith('#artifact:')) {
      e.preventDefault();
      e.stopPropagation();
      const sessionId = tabStore.activeSessionId();
      if (sessionId) void openArtifact(sessionId, href.slice(10)).then(opened => {
        if (opened) uiStore.setRightPanelTabForSession(sessionId, 'artifacts');
      });
      return;
    }
    const filePath = href ? workspaceFilePath(href) : null;
    if (filePath) {
      e.preventDefault();
      e.stopPropagation();
      setPreviewPath(filePath);
      return;
    }
    const cell = href ? parseSheetCellHref(href) : null;
    if (cell) {
      e.preventDefault();
      e.stopPropagation();
      const sessionId = tabStore.activeSessionId();
      if (sessionId) { requestSheetFocus(sessionId, cell); uiStore.setRightPanelTab('sheets'); }
      return;
    }
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
        remarkPlugins={remarkPlugins}
        components={MARKDOWN_COMPONENTS}
        controls={STREAMDOWN_CONTROLS}
        translations={STREAMDOWN_TRANSLATIONS}
        linkSafety={LINK_SAFETY}
        lineNumbers={false}
        codeBlockMaxHeight={Number.POSITIVE_INFINITY}
        tableMaxHeight={Number.POSITIVE_INFINITY}
      >
        {markdown}
      </Streamdown>
      {previewPath && <WorkspaceFileDialog path={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  );
}
