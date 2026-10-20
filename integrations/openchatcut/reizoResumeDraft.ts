import { makeDraft, replayActions } from '../editor/store';
import type { ProjectDoc } from '../editor/types';
import { ExternalEditSessionOutcomeError, isExternalEditSessionStale, type ExternalEditSession } from './external-edit-session';

/** Reopen the exact review without losing operations, IDs, other timelines or its undo base. */
export function resumeReviewedDraft(session: ExternalEditSession, live: ProjectDoc): ExternalEditSession {
  if (session.status !== 'awaiting_review' || !session.proposal || session.approvalMode !== 'manual') {
    throw new ExternalEditSessionOutcomeError('rejected', 'Only a pending manual review can be resumed. Inspect session status before retrying.');
  }
  if (isExternalEditSessionStale(session, live)) {
    throw new ExternalEditSessionOutcomeError('stale', 'The project changed since this draft began. Do not overwrite newer edits.');
  }
  const operations = session.proposal.options[0].operations;
  const doc = replayActions(session.baseDoc, operations.flatMap(operation => operation.actions));
  return { ...session, status: 'drafting', draft: makeDraft(doc), operations,
    operationCount: operations.length, proposal: null, updatedAt: Date.now() };
}
