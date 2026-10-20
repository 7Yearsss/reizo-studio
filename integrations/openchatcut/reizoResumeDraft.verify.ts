import assert from 'node:assert/strict';
import { INITIAL } from '../editor/initial';
import { docFromTimeline } from '../persist/projectStore';
import { replayActions } from '../editor/store';
import { createExternalEditSession, captureExternalToolActions, reviewExternalEditSession, restoreExternalEditSession, checkpointExternalEditSession, restoreDraftingExternalEditSession, finishExternalEditSession } from './external-edit-session';
import { resumeReviewedDraft } from './reizoResumeDraft';

const base = docFromTimeline({ ...INITIAL, items: [] });
let session = createExternalEditSession(base, 'Reizo Agent', 'manual');
assert(session.draft);
const id = session.draft.commands.addTextClip({ name: '标题', text: 'original', fontSize: 100 });
session = captureExternalToolActions(session, 'edit_item', {});
let reviewed = reviewExternalEditSession(session, 'Initial');
for (const [round, fontSize] of [80, 60, 40].entries()) {
  // Exercise persisted/reloaded review, not only an in-memory draft object.
  const restored = restoreExternalEditSession({ sessionId: reviewed.id, clientName: reviewed.clientName,
    status: 'awaiting_review', approvalMode: 'manual', baseRevision: reviewed.baseRevision,
    createdAt: reviewed.createdAt, operationCount: reviewed.operationCount,
    proposal: JSON.parse(JSON.stringify(reviewed.proposal)) }, base);
  session = resumeReviewedDraft(restored, base);
  assert(session.draft);
  assert.equal(session.id, reviewed.id);
  assert.equal(session.draft.getState().items.length, 1);
  assert.equal(session.draft.getState().items[0].id, id);
  assert.equal(session.draft.getState().items[0].props?.text, 'original');
  const restoredDraft = restoreDraftingExternalEditSession(checkpointExternalEditSession(session), base);
  assert.deepEqual(restoredDraft.draft?.getDoc(), session.draft.getDoc());
  session.draft.commands.updateItemProps(id, { fontSize });
  session = captureExternalToolActions(session, 'update_item_props', { itemId: id, props: { fontSize } });
  reviewed = reviewExternalEditSession(session, `Round ${round + 1}`);
  assert.equal(reviewed.proposal?.resultState.items[0].props?.fontSize, fontSize);
  assert.equal(base.timelines[0].items.length, 0);
}
assert(reviewed.proposal);
const applied = replayActions(base, reviewed.proposal.options[0].operations.flatMap(o => o.actions));
assert.equal(applied.timelines[0].items[0].id, id);
assert.equal(applied.timelines[0].items[0].props?.fontSize, 40);
assert.throws(() => resumeReviewedDraft(reviewed, applied), /changed/);
for (const status of ['applied', 'rejected', 'cancelled', 'stale', 'failed'] as const) {
  assert.throws(() => resumeReviewedDraft(finishExternalEditSession(reviewed, status), base), /pending manual/);
}
assert.throws(() => resumeReviewedDraft({ ...reviewed, approvalMode: 'auto' }, base), /pending manual/);
console.log('Three persisted draft revisions preserve IDs, base, checkpoint recovery, replay and stale/terminal guards.');
