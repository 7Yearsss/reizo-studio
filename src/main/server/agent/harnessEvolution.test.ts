import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyHarnessProposal, listHarnessProposals } from './harnessEvolution';
import type { TurnTrace } from './turnTrace';

const trace = (i: number): TurnTrace => ({
  at: new Date().toISOString(), sessionId: `s${i}`, model: 'm', outcome: 'completed', durationMs: 1,
  steps: 1, textChars: 1, tools: [{ name: 'read_file', ok: false, error: 'ENOENT' }], toolsDropped: 0,
  loopVerdicts: [], continuePasses: [], reasoningLeak: false,
});

describe('harness evolution loop', () => {
  it('turns recurring trace failures into an applied, idempotent prompt lesson', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'harness-evo-'));
    await mkdir(path.join(root, 'traces'));
    await writeFile(path.join(root, 'traces', 'a.jsonl'), [1, 2, 3].map((i) => JSON.stringify(trace(i))).join('\n') + '\n{torn');
    const [proposal] = await listHarnessProposals(root);
    expect(proposal?.applied).toBe(false);
    expect(await applyHarnessProposal(root, proposal!.id)).toBe(true);
    expect(await applyHarnessProposal(root, proposal!.id)).toBe(true);
    const file = await readFile(path.join(root, 'harness', 'systemprompt.md'), 'utf8');
    expect(file.match(new RegExp(proposal!.id, 'g'))).toHaveLength(1);
    expect((await listHarnessProposals(root))[0]?.applied).toBe(true);
    expect(await applyHarnessProposal(root, 'nope')).toBe(false);
  });
});
