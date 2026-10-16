import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Guarded, repeatable overlay for the pinned upstream revision. */
export function patchDraftRefinement(source) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  copyFileSync(path.join(here, 'reizoResumeDraft.ts'), path.join(source, 'src/agent/reizoResumeDraft.ts'));
  copyFileSync(path.join(here, 'reizoResumeDraft.verify.ts'), path.join(source, 'src/agent/reizoResumeDraft.verify.ts'));
  const patch = (relative, marker, anchor, replacement) => {
    const file = path.join(source, relative);
    const code = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (code.includes(marker)) return;
    if (code.split(anchor).length !== 2) throw new Error(`Unexpected upstream refinement anchor: ${relative}`);
    writeFileSync(file, code.replace(anchor, replacement));
  };
  patch('src/agent/external-tool-shape.ts', "name: 'resume_edit_session'", "    name: 'review_edit_session',", `    name: 'resume_edit_session',
    description: 'Reopen this exact pending manual review for local refinements, preserving all existing edits and IDs. Does not apply or discard it. Requires an unchanged live project. Read the resumed draft, edit only requested fields, preview and review again.',
    input_schema: { type: 'object', properties: { editSessionId: SESSION_ID_PROPERTY }, required: ['editSessionId'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'review_edit_session',`);
  patch('src/agent/external-bridge-runtime.ts', "import { resumeReviewedDraft }", "import type { AgentContext } from './context';", "import { resumeReviewedDraft } from './reizoResumeDraft';\nimport type { AgentContext } from './context';");
  patch('src/agent/external-bridge-runtime.ts', "if (name === 'resume_edit_session')", "    if (name === 'review_edit_session') {", `    if (name === 'resume_edit_session') {
      const run = this.requireRun(requiredSession.id);
      await run.confirmOwnership();
      throwIfExternalCallCancelled(signal);
      if (this.reizoApply || this.sessions.get(requiredSession.id) !== requiredSession || this.proposalSessionId !== requiredSession.id) {
        throw new Error('Review changed while resuming; inspect session status.');
      }
      const resumed = resumeReviewedDraft(requiredSession, this.getContext().getDoc());
      // Remove Apply synchronously before persistence can yield to the UI.
      this.sessions.set(resumed.id, resumed);
      this.proposalSessionId = null;
      this.publish({ proposal: null, stale: false });
      try {
        await this.persistence.saveExternalProposal(this.projectId, storedExternalSession(resumed, 'drafting', undefined, run.runId));
      } catch (error) {
        if (this.sessions.get(resumed.id) === resumed) {
          this.sessions.set(requiredSession.id, requiredSession);
          this.proposalSessionId = requiredSession.id;
          this.publish({ proposal: requiredSession.proposal, stale: isProposalStale(requiredSession.proposal!, this.getContext().getDoc()) });
        }
        throw error;
      }
      return this.info(resumed);
    }
    if (name === 'review_edit_session') {`);
}
