import assert from 'node:assert/strict';
import { makeDraft } from '../editor/store';
import { ExternalBridgeRuntime } from './external-bridge-runtime';
import { base, reviewed, reviewedWithRun } from './external-edit-session-core.verify';
import { revisionOf } from './external-edit-session';

globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
async function fixture() {
  const projectId = `approval-${crypto.randomUUID()}`;
  const live = makeDraft(base);
  let commits = 0;
  const runtime = new ExternalBridgeRuntime(projectId, 'editor', () => ({
    commands: { ...live.commands, applyDoc: (doc) => { commits++; live.commands.applyDoc(doc); } },
    getState: live.getState, getDoc: live.getDoc, getCreativeMode: () => null,
    templates: [], audio: [], getProjectId: () => projectId,
  }), () => undefined, {
    saveProject: async () => ({ projectId, revision: 1, epoch: 1, status: 'saved', saved: true, indexUpdated: true }),
    saveAutomaticVersion: async () => null,
    saveExternalProposal: async () => undefined,
  });
  await runtime.hydrate(await reviewedWithRun(projectId));
  const binding = { projectId, editorInstanceId: 'editor', baseRevision: revisionOf(base) };
  const args = { editSessionId: reviewed.id, proposalId: reviewed.proposal!.id };
  return { runtime, live, binding, args, commits: () => commits };
}

{
  const { runtime, live, binding, args, commits } = await fixture();
  const pending = await runtime.execute('get_edit_session', args, binding) as Record<string, unknown>;
  assert.equal(pending.proposalId, args.proposalId);
  await assert.rejects(runtime.execute('apply_reviewed_edit_session', { ...args, proposalId: 'other' }, binding), /changed/);
  assert.deepEqual(live.getDoc(), base);
  const result = await runtime.execute('apply_reviewed_edit_session', args, binding) as Record<string, unknown>;
  assert.equal(result.status, 'applied');
  assert.equal(commits(), 1, 'all operations commit through a single undo boundary');
  await assert.rejects(runtime.execute('apply_reviewed_edit_session', args, { ...binding, baseRevision: revisionOf(live.getDoc()) }));
  assert.equal(commits(), 1, 'duplicate confirmation never applies twice');
  await runtime.disconnect();
}
{
  const { runtime, live, binding, args, commits } = await fixture();
  await runtime.execute('resume_edit_session', args, binding);
  await runtime.execute('set_aspect_ratio', { editSessionId: args.editSessionId, ratio: '1:1' }, binding);
  const next = await runtime.execute('review_edit_session', { editSessionId: args.editSessionId, summary: 'new review' }, binding) as Record<string, unknown>;
  assert.notEqual(next.proposalId, args.proposalId);
  await assert.rejects(runtime.execute('apply_reviewed_edit_session', args, binding), /changed/);
  assert.deepEqual(live.getDoc(), base);
  assert.equal(commits(), 0);
  await runtime.reject();
  await assert.rejects(runtime.execute('apply_reviewed_edit_session', { ...args, proposalId: next.proposalId }, binding), /changed/);
  await runtime.disconnect();
}
{
  const { runtime, live, binding, args, commits } = await fixture();
  live.commands.setAspect(720, 720, 'contain');
  await assert.rejects(runtime.execute('apply_reviewed_edit_session', args, binding), /changed|stale/);
  assert.equal(commits(), 0, 'never force a stale proposal');
  await runtime.disconnect();
}
console.log('Reizo exact-proposal approval checks passed');
