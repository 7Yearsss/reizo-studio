import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Apply only an exact reviewed proposal, using the existing atomic commit/undo path. */
export function patchDraftApproval(source) {
  copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reizoDraftApproval.verify.ts'), path.join(source, 'src/agent/reizoDraftApproval.verify.ts'));
  const patch = (relative, marker, anchor, replacement) => {
    const file = path.join(source, relative);
    const code = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (code.includes(marker)) return;
    if (code.split(anchor).length !== 2) throw new Error(`Unexpected upstream approval anchor: ${relative}`);
    writeFileSync(file, code.replace(anchor, replacement));
  };
  patch('src/agent/external-bridge-session.ts', 'proposalId: session.proposal?.id', '    editSessionId: session.id,', '    editSessionId: session.id,\n    proposalId: session.proposal?.id,');
  patch('src/agent/external-tool-shape.ts', "name: 'apply_reviewed_edit_session'", "    name: 'review_edit_session',", `    name: 'apply_reviewed_edit_session',
    description: 'Apply all operations of the exact pending proposal authorized by the host. Requires its proposalId; rejects changed, stale or terminal drafts. Does not confirm real-project tools.',
    input_schema: { type: 'object', properties: { editSessionId: SESSION_ID_PROPERTY, proposalId: { type: 'string' } }, required: ['editSessionId', 'proposalId'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'review_edit_session',`);
  patch('src/agent/external-bridge-runtime.ts', "if (name === 'apply_reviewed_edit_session')", "    if (name === 'review_edit_session') {", `    if (name === 'apply_reviewed_edit_session') {
      throwIfExternalCallCancelled(signal);
      if (this.reizoApply || requiredSession.status !== 'awaiting_review'
          || this.proposalSessionId !== requiredSession.id || !requiredSession.proposal
          || requiredSession.proposal.id !== invocationArgs.proposalId) {
        throw new Error('The reviewed proposal changed or is no longer pending. Confirm the current draft again.');
      }
      const count = requiredSession.proposal.options[0].operations.length;
      await this.apply(new Set(Array.from({ length: count }, (_, i) => i)), false, true, signal);
      const result = this.info(this.requireSession(requiredSession.id));
      if (result.status !== 'applied') throw new Error('Proposal was not applied; inspect the current project and draft.');
      return result;
    }
    if (name === 'review_edit_session') {`);
  // applyDraft awaits ownership. A UI Reject/Resume may win that await; never commit its obsolete proposal.
  patch('src/agent/external-bridge-runtime.ts', 'Proposal changed during apply authorization.', '    const context = this.getContext();\n    const committed = await commitExternalProposal({', `    if (this.currentProposalSession() !== session || session.status !== 'awaiting_review') {
      throw new Error('Proposal changed during apply authorization.');
    }
    const context = this.getContext();
    const committed = await commitExternalProposal({`);
}
