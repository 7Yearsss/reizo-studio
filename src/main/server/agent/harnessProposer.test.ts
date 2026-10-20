import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareIsolatedProposerDir,
  proposeInvariantLessonsFromTraces,
  stageAndValidateDomProposal,
} from './harnessProposer';
import { createTurnTraceCollector } from './turnTrace';

describe('harnessProposer (Harness² B4, B5, B6, D4)', () => {
  it('proposes INV lessons only from recurring multi-turn failures and ignores 1/k single-turn noise', () => {
    const t1 = createTurnTraceCollector({ sessionId: 's1', model: 'm' });
    t1.onEvent({ type: 'tool', id: '1', name: 'edit_file', args: {}, error: 'target not found' });
    t1.onEvent({ type: 'tool', id: '2', name: 'grep', args: {}, error: 'one-off error' });

    const t2 = createTurnTraceCollector({ sessionId: 's2', model: 'm' });
    t2.onEvent({ type: 'tool', id: '3', name: 'edit_file', args: {}, error: 'target not found' });

    const proposals = proposeInvariantLessonsFromTraces([
      t1.finish({ outcome: 'completed', text: '', reasoningLeak: false }),
      t2.finish({ outcome: 'completed', text: '', reasoningLeak: false }),
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].dimension).toBe('INV');
    expect(proposals[0].id).toBe('recurring-edit_file-failure');
    expect(proposals[0].content).toContain('edit_file');
  });

  it('stages and validates DOM skills/subagents in an isolated git-free directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposer-'));
    try {
      const staging = await prepareIsolatedProposerDir(root, 'run-1');
      const skillRes = await stageAndValidateDomProposal(staging, {
        dimension: 'DOM',
        targetKind: 'skill',
        id: 'deck-qa',
        title: 'Deck QA',
        rationale: 'Use when verifying slide layout and visual contrast.',
        content: '# Deck QA\nCheck every slide for 1280x720 bounds.',
      });
      expect(skillRes.valid).toBe(true);

      const agentRes = await stageAndValidateDomProposal(staging, {
        dimension: 'DOM',
        targetKind: 'subagent',
        id: 'doc-reviewer',
        title: 'Doc Reviewer',
        rationale: 'Specialist for auditing long documents.',
        content: '---\nname: doc-reviewer\ndescription: Audits documents\ntools: [read_file]\n---\nAudit numbering and terminology consistency.',
      });
      expect(agentRes.valid).toBe(true);

      await mkdir(path.join(staging, '.git'), { recursive: true });
      const gitBlocked = await stageAndValidateDomProposal(staging, {
        dimension: 'DOM',
        targetKind: 'skill',
        id: 'blocked',
        title: 'Blocked',
        rationale: 'Should fail when .git is present',
        content: 'body',
      });
      expect(gitBlocked.valid).toBe(false);
      expect(gitBlocked.issues[0]).toContain('.git');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
