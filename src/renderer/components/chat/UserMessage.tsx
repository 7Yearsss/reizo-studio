import { splitPresentationContext } from '../../../shared/presentationReferences';
import { selectPresentation } from '../../state/presentationWorkspace';
import { splitDocumentContext } from '../../../shared/documentReferences';
import { selectDocument } from '../../state/documentWorkspace';
import { useMemo, useState } from 'react';
import { Check, Copy, Pencil } from 'lucide-react';
import { HighlightedText } from '../../lib/highlightText';
import CanvasRefChips, { splitCanvasRefs } from './CanvasRefChips';
import { splitSheetContext } from '../../../shared/sheetReferences';
import { selectWorkbook } from '../../state/sheetWorkspace';
import { setRightPanelTab } from '../../state/uiStore';
import { Button } from '../ui/button';

/** One-line reference chip: the quoted part truncates at the end so the start of the selection stays readable. */
function RefChipText({ label, name, quote }: { label?: number; name: string; quote?: string }) {
  const body = quote ? quote.replace(/s+/g, ' ').trim() : '';
  return (
    <span className="min-w-0 truncate">
      {label ? <span className="mr-1 font-semibold">[{label}]</span> : null}
      {body ? body : name}
      {body ? <span className="ml-1.5 text-ink-muted">· {name}</span> : null}
    </span>
  );
}

const LEGACY_HTML_CONTEXT = /\n*<html-context>[^\n]*<\/html-context>/g;

export default function UserMessage({
  content,
  sessionId,
  searchQuery,
  currentMatch = false,
  canEdit = false,
  onEdit,
}: {
  content: string;
  sessionId?: string;
  searchQuery?: string;
  currentMatch?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // The agent-facing node-ref block (raw ids + prompt dumps) is split out and
  // rendered as thumbnail chips — users shouldn't read machine identifiers.
  const { text, nodeIds, sheetRefs, documentRefs, presentationRefs } = useMemo(() => {
    // Older messages carry an <html-context> block from the removed HTML page integration.
    const presentation = splitPresentationContext(content.replace(LEGACY_HTML_CONTEXT, ''));
    const document = splitDocumentContext(presentation.text);
    const sheet = splitSheetContext(document.text);
    return { ...splitCanvasRefs(sheet.text), sheetRefs: sheet.refs, documentRefs: document.refs, presentationRefs: presentation.refs };
  }, [content]);

  function copy() {
    void navigator.clipboard.writeText(text || content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div
      className={`anim-msg group flex justify-end ${currentMatch ? 'chat-search-current' : ''}`}
    >
      <div className="max-w-[75%]">
        <div
          data-slot="message-content"
          className="whitespace-pre-wrap rounded-[18px] bg-paper-inset px-4 py-2.5 text-[15px] leading-relaxed text-ink"
        >
          <HighlightedText text={text} query={searchQuery} />
        </div>
        <CanvasRefChips nodeIds={nodeIds} sessionId={sessionId} />
        {documentRefs.length > 0 && <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">{documentRefs.map((ref, index) => <Button key={index} variant="outline" size="xs" className="max-w-full min-w-0 shrink" onClick={() => { if (sessionId) { selectDocument(sessionId, ref.artifactId); setRightPanelTab('documents'); } }}><RefChipText label={ref.label} name={ref.name} quote={ref.selection?.text} /></Button>)}</div>}
        {presentationRefs.length > 0 && <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">{presentationRefs.map((ref, index) => <Button key={index} variant="outline" size="xs" className="max-w-full min-w-0 shrink" onClick={() => { if (sessionId) { selectPresentation(sessionId, ref.artifactId); setRightPanelTab('presentations'); } }}><RefChipText name={ref.name} quote={ref.elementIds?.length ? `${ref.elementIds.length} 个元素` : undefined} /></Button>)}</div>}
        {sheetRefs.length > 0 && <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">{sheetRefs.map((ref, index) => <Button key={`${ref.artifactId}:${index}`} variant="outline" size="xs" onClick={() => { if (sessionId) { selectWorkbook(sessionId, ref.artifactId); setRightPanelTab('sheets'); } }}><RefChipText label={ref.label} name={ref.name} quote={ref.range ? `${ref.sheetName ?? ''}!${ref.range}` : undefined} /></Button>)}</div>}
        <div className="mt-1 flex justify-end gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
            >
              <Pencil size={11} />
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  );
}
