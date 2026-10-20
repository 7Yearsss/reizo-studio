import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAllHarnessProposals, applyHarnessProposal, listHarnessProposals, MAX_LESSONS_CHARS } from './harnessEvolution';
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

  it('also proposes from loop halts, reasoning leaks, deferrals and open todos, only when recurring', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'harness-evo-'));
    await mkdir(path.join(root, 'traces'));
    const bad = (i: number): TurnTrace => ({ ...trace(i), tools: [], reasoningLeak: true, continuePasses: ['deferred', 'todos'], loopVerdicts: [{ tier: 'halt', reason: 'x' }] });
    await writeFile(path.join(root, 'traces', 'a.jsonl'), [1, 2].map((i) => JSON.stringify(bad(i))).join('\n') + '\n');
    const ids = (await listHarnessProposals(root)).map((p) => p.id).sort();
    expect(ids).toEqual(['act-instead-of-deferring', 'break-tool-loops', 'close-todos-before-finishing', 'keep-reasoning-out-of-reply']);
    await writeFile(path.join(root, 'traces', 'a.jsonl'), JSON.stringify(bad(1)) + '\n');
    expect(await listHarnessProposals(root)).toEqual([]);
  });

  it('refuses to grow the prompt past the cap', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'harness-evo-'));
    await mkdir(path.join(root, 'traces')); await mkdir(path.join(root, 'harness'));
    await writeFile(path.join(root, 'traces', 'a.jsonl'), [1, 2].map((i) => JSON.stringify(trace(i))).join('\n') + '\n');
    await writeFile(path.join(root, 'harness', 'systemprompt.md'), 'x'.repeat(MAX_LESSONS_CHARS));
    const [proposal] = await listHarnessProposals(root);
    await expect(applyHarnessProposal(root, proposal!.id)).rejects.toThrow(/full/);
  });

  it('auto-apply is throttled and only reads the tail of large trace files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'harness-evo-'));
    await mkdir(path.join(root, 'traces'));
    const filler = JSON.stringify({ ...trace(0), tools: [] });
    const old = Array.from({ length: 3000 }, () => filler).join('\n') + '\n';
    await writeFile(path.join(root, 'traces', 'a.jsonl'), old + [1, 2].map((i) => JSON.stringify(trace(i))).join('\n') + '\n');
    expect(await applyAllHarnessProposals(root, 60_000)).toBe(1);
    expect(await applyAllHarnessProposals(root, 60_000)).toBe(0);
  });
});
