import { useCallback, useEffect, useState } from 'react';
import { Check, FileText, X } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import type { ArtifactReview } from '../../../shared/artifactReview';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { refreshDocumentReviews, selectDocument, useDocumentWorkspace } from '../../state/documentWorkspace';
import { refreshSheetReviews, selectWorkbook, useSheetWorkspace } from '../../state/sheetWorkspace';
import { refreshPresentationReviews, selectPresentation, usePresentationWorkspace } from '../../state/presentationWorkspace';
import { useTabStore } from '../../state/useTabStore';
import * as uiStore from '../../state/uiStore';
import { cn } from '../../lib/cn';
import { diffHunks } from '../../../shared/textDiff';

const MAX_SHOWN = 4;

interface Kind {
  title: string;
  tab: uiStore.RightPanelTab;
  select(sessionId: string, id: string): void;
  refresh(id: string): void;
  /** Only editors that reload from the shared artifact store can be decided from the chat. */
  decidable: boolean;
}

const KINDS: Record<string, Kind> = {
  propose_document_edits: { title: '文档修改建议', tab: 'documents', select: selectDocument, refresh: refreshDocumentReviews, decidable: true },
  propose_sheet_edits: { title: '表格修改建议', tab: 'sheets', select: selectWorkbook, refresh: refreshSheetReviews, decidable: true },
  propose_presentation_edits: { title: 'PPT 修改建议', tab: 'presentations', select: selectPresentation, refresh: refreshPresentationReviews, decidable: false },
};

const DEL = 'rounded-[3px] bg-[#ff0000]/12 px-0.5 text-ink line-through decoration-ink/40 dark:bg-rose-500/15 dark:text-rose-300 dark:decoration-rose-500/70';
const INS = 'rounded-[3px] bg-[#9ccc2c]/25 px-0.5 text-ink dark:bg-emerald-500/20 dark:text-emerald-300';

/** One inline line: unchanged text stays plain, only the words that changed are marked. */
function InlineDiff({ before, after }: { before: string; after: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [i, hunk] of diffHunks(before, after).entries()) {
    if (hunk.start > at) parts.push(before.slice(at, hunk.start));
    if (hunk.end > hunk.start) parts.push(<del key={`d${i}`} className={DEL}>{before.slice(hunk.start, hunk.end)}</del>);
    if (hunk.text) parts.push(<ins key={`i${i}`} className={cn(INS, 'no-underline')}>{hunk.text}</ins>);
    at = hunk.end;
  }
  if (at < before.length) parts.push(before.slice(at));
  return <p className="line-clamp-6 whitespace-pre-wrap break-words text-ink">{parts}</p>;
}

export interface ReviewProposal {
  artifactId: string;
  reviewId: string;
  toolName: string;
}

/** The review a propose_*_edits call created, or null while running / on failure. */
export function reviewProposalOf(part: ToolCallPart): ReviewProposal | null {
  if (!KINDS[part.name] || !part.result || part.error) return null;
  try {
    const r = JSON.parse(part.result) as { ok?: boolean; artifactId?: unknown; reviewId?: unknown };
    if (r.ok === false || typeof r.artifactId !== 'string' || typeof r.reviewId !== 'string') return null;
    return { artifactId: r.artifactId, reviewId: r.reviewId, toolName: part.name };
  } catch {
    return null;
  }
}

/** Before → after for the agent's suggestion, decidable right in the chat; the Doc panel stays in sync. */
export default function ReviewProposalCard({ proposal }: { proposal: ReviewProposal }) {
  const { artifactId, reviewId } = proposal;
  const kind = KINDS[proposal.toolName];
  const sessionId = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.sessionId);
  const docRev = useDocumentWorkspace((s) => s.revisions[artifactId]);
  const sheetRev = useSheetWorkspace((s) => s.reviewRevisions[artifactId]);
  const deckRev = usePresentationWorkspace((s) => s.revisions[artifactId]);
  const revision = `${docRev}.${sheetRev}.${deckRev}`;
  const [review, setReview] = useState<ArtifactReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.listArtifactReviews(artifactId).then(
      (all) => { if (!cancelled) setReview(all.find((r) => r.id === reviewId) ?? null); },
      () => { /* The Doc panel still carries the suggestion. */ },
    );
    return () => { cancelled = true; };
  }, [artifactId, reviewId, revision]);

  const decide = useCallback(async (decision: 'accept' | 'reject') => {
    if (!review) return;
    const ids = review.changes.filter((c) => c.status === 'pending').map((c) => c.id);
    if (!ids.length) return;
    setBusy(true); setError('');
    try {
      const result = await api.decideArtifactReview(artifactId, review.id, review.reviewVersion, ids, decision);
      artifacts.upsertArtifact(result.artifact);
      kind.refresh(artifactId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请在右侧面板里处理');
      kind.refresh(artifactId);
    } finally { setBusy(false); }
  }, [artifactId, review, kind]);

  function openInPanel() {
    if (sessionId) kind.select(sessionId, artifactId);
    uiStore.setRightPanelTab(kind.tab);
  }

  const changes = review?.changes ?? [];
  const pending = changes.filter((c) => c.status === 'pending').length;
  const accepted = changes.filter((c) => c.status === 'accepted').length;
  const rejected = changes.filter((c) => c.status === 'rejected').length;
  const status = !review ? '' : pending > 0 ? `${pending} 处待审核` : accepted > 0 && rejected > 0 ? `已接受 ${accepted} 处，拒绝 ${rejected} 处` : accepted > 0 ? '已接受' : '已拒绝';

  return (
    <div className="my-1 w-full overflow-hidden rounded-2xl bg-paper-raised shadow-[var(--shadow-outline)]">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <FileText size={15} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{kind.title}</span>
        {status ? (
          <span className={cn('shrink-0 text-xs', pending > 0 ? 'text-ink-muted' : accepted > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-muted')}>{status}</span>
        ) : null}
      </div>
      {changes.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-line px-3.5 py-2.5">
          {changes.slice(0, MAX_SHOWN).map((change) => (
            <li key={change.id} className={cn('text-[13px] leading-6', change.status === 'rejected' && 'opacity-60')}>
              {kind.decidable && proposal.toolName === 'propose_document_edits' ? null : <p className="text-xs text-ink-muted">{change.label}</p>}
              <InlineDiff before={change.before} after={change.after} />
            </li>
          ))}
          {changes.length > MAX_SHOWN ? <li className="text-xs text-ink-muted">另有 {changes.length - MAX_SHOWN} 处，在右侧面板里查看</li> : null}
        </ul>
      ) : null}
      {error ? <p className="border-t border-line px-3.5 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
      <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-2">
        {pending > 0 && kind.decidable ? (
          <>
            <button type="button" disabled={busy} onClick={() => void decide('accept')} className="inline-flex h-7 items-center gap-1 rounded-lg bg-ink px-2.5 text-xs font-medium text-paper disabled:opacity-50"><Check size={13} />接受{pending > 1 ? '全部' : ''}</button>
            <button type="button" disabled={busy} onClick={() => void decide('reject')} className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs text-ink-muted hover:bg-paper-inset disabled:opacity-50"><X size={13} />拒绝</button>
          </>
        ) : null}
        <button type="button" onClick={openInPanel} className="ml-auto h-7 rounded-lg px-2.5 text-xs text-ink-muted hover:bg-paper-inset">在右侧面板查看</button>
      </div>
    </div>
  );
}
