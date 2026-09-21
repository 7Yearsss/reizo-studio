import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { createSettingsStore } from '../storage/settingsStore';
import { createCanvasTools } from './canvasTools';
import {
  CANVAS_BUDGET_ALLOW_BATCH,
  CANVAS_BUDGET_EXECUTE_LIMIT,
  createCanvasBudget,
} from './canvasBudget';
import { answerPermission, isApprovalRequiredError, type ApprovalRequiredError } from './permissions';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

async function setup() {
  const handle = openDb(':memory:');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-budget-test-'));
  const sessions = createSqliteSessionStore(handle);
  const canvasStore = createCanvasStore(handle);
  const settingsStore = createSettingsStore(tmpDir);
  const session = await sessions.create('test-session', null, null);
  const budget = createCanvasBudget();
  const { tools, executeApproved } = createCanvasTools({
    sessionId: session.id,
    canvasStore,
    settingsStore,
    dataRoot: './data-test',
    budget,
  });
  const canvas = canvasStore.ensureCanvas(session.id);
  const node = canvasStore.addNode(canvas.id, {
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params: {},
  }).node;
  return { tools, executeApproved, budget, sessionId: session.id, nodeId: node.id, canvasStore };
}

describe('canvasBudget', () => {
  it('counts and trips only past the execute ceiling', () => {
    const b = createCanvasBudget({ execute: 2 });
    b.record('execute');
    b.record('execute');
    expect(b.exceeded('execute')).toBe(false);
    b.record('execute');
    expect(b.exceeded('execute')).toBe(true);
    b.extendExecute(2);
    expect(b.exceeded('execute')).toBe(false);
  });

  it('checkpoints the 5th canvas run, then lets an allow resume through without recounting', async () => {
    const { tools, budget, nodeId } = await setup();
    const run = (n: number) =>
      (tools.run_node as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { id: nodeId, wait: false, timeoutMs: 50 },
        { toolCallId: `tc${n}` },
      );

    // Runs 1..4 fit the default quota (they fail fast downstream — no provider
    // key — but the budget gate must not be what stops them).
    for (let i = 1; i <= CANVAS_BUDGET_EXECUTE_LIMIT; i++) {
      await run(i);
    }
    expect(budget.counts().execute).toBe(CANVAS_BUDGET_EXECUTE_LIMIT);

    // The 5th run unwinds the step instead of silently executing.
    let threw = false;
    try {
      await run(5);
    } catch (err) {
      threw = isApprovalRequiredError(err);
    }
    expect(threw).toBe(true);

    // User approves the checkpoint → ceiling extends, the resumed call and the
    // rest of the batch proceed without re-asking.
    expect(answerPermission('tc5', 'allow')).toBe(true);
    for (let i = 5; i <= 5 + 3; i++) {
      await expect(run(i)).resolves.toBeTruthy();
    }
    const counts = budget.counts().execute;
    // limit was extended past the current count
    expect(counts).toBeLessThanOrEqual(CANVAS_BUDGET_EXECUTE_LIMIT + 1 + CANVAS_BUDGET_ALLOW_BATCH);
  });

  it('keeps the ceiling after a deny', async () => {
    const { tools, nodeId } = await setup();
    const run = (n: number) =>
      (tools.run_node as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { id: nodeId, wait: false, timeoutMs: 50 },
        { toolCallId: `td${n}` },
      );
    for (let i = 1; i <= CANVAS_BUDGET_EXECUTE_LIMIT; i++) await run(i);
    await expect(run(5)).rejects.toMatchObject({ name: 'ApprovalRequiredError' });
    answerPermission('td5', 'deny');
    // A retried run still trips the checkpoint.
    await expect(run(6)).rejects.toMatchObject({ name: 'ApprovalRequiredError' });
    answerPermission('td6', 'deny');
  });

  it('resume: an approved run_node checkpoint replays the gated call without recounting', async () => {
    const { tools, executeApproved, budget, nodeId, canvasStore, sessionId } = await setup();
    const run = (n: number) =>
      (tools.run_node as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { id: nodeId, wait: false, timeoutMs: 50 },
        { toolCallId: `tr${n}` },
      );
    for (let i = 1; i <= CANVAS_BUDGET_EXECUTE_LIMIT; i++) await run(i);
    // The gated call targets a fresh node so the same-params fuse can't
    // intercept it — we want to observe the budget resume, not the fuse.
    const canvas = canvasStore.ensureCanvas(sessionId);
    const fresh = canvasStore.addNode(canvas.id, { type: 'image', x: 999, y: 0, w: 100, h: 100, params: {} }).node;
    let err: unknown;
    try {
      await (tools.run_node as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { id: fresh.id, wait: false, timeoutMs: 50 },
        { toolCallId: 'tr5' },
      );
    } catch (e) {
      err = e;
    }
    expect(isApprovalRequiredError(err)).toBe(true);
    const interaction = (err as ApprovalRequiredError).interaction;
    expect(interaction.args.tool).toBe('run_node');
    expect(answerPermission('tr5', 'allow')).toBe(true);
    // The resume path must actually run the gated call, not bounce off a
    // "Cannot resume unknown tool" default — and must not charge it twice.
    const out = await executeApproved(interaction.args, 'tr5');
    expect(out.error).toBeUndefined();
    const res = JSON.parse(out.result ?? '{}') as { ok?: boolean; status?: string; id?: string };
    expect(res.ok).toBe(true);
    expect(res.id).toBe(fresh.id);
    expect(budget.counts().execute).toBe(CANVAS_BUDGET_EXECUTE_LIMIT + 1);
  });

  it('run_graph counts its runnable scope, not one call', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    for (let i = 0; i < 5; i++) {
      canvasStore.addNode(canvas.id, {
        type: 'image',
        x: i * 320,
        y: 0,
        w: 100,
        h: 100,
        params: { prompt: `p${i}` },
      });
    }
    let err: unknown;
    try {
      await (tools.run_graph as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { wait: false, timeoutMs: 50 },
        { toolCallId: 'tg1' },
      );
    } catch (e) {
      err = e;
    }
    // 6 runnable nodes > the limit of 4 — a single call can no longer launder
    // a whole batch as "one" execution.
    expect(isApprovalRequiredError(err)).toBe(true);
    const args = (err as ApprovalRequiredError).interaction.args;
    expect(args.tool).toBe('run_graph');
    expect(args.planned).toBe(6);
  });

  it('resume: an approved pipeline checkpoint goes live without duplicating the storyboard', async () => {
    const { tools, executeApproved, nodeId, canvasStore, sessionId } = await setup();
    for (let i = 1; i <= CANVAS_BUDGET_EXECUTE_LIMIT; i++) {
      await (tools.run_node as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { id: nodeId, wait: false, timeoutMs: 50 },
        { toolCallId: `tp${i}` },
      );
    }
    const canvas = canvasStore.ensureCanvas(sessionId);
    const scene = { title: 'a', script: 's', keyframePrompt: 'p', videoPrompt: 'v', cameraMotion: 'pan' as const, duration: '5s' as const };
    let err: unknown;
    try {
      await (tools.create_storyboard_pipeline as never as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { storyTitle: 'T', ratio: '16:9', scenes: [scene, scene], autoRunFirstScene: true, asProposal: true, operationId: 'op1' },
        { toolCallId: 'tcpipe' },
      );
    } catch (e) {
      err = e;
    }
    expect(isApprovalRequiredError(err)).toBe(true);
    // The throw lands after the ghost structure is committed.
    const before = canvasStore.getSnapshot(canvas.id)!.nodes.length;
    expect(before).toBeGreaterThan(1);
    expect(answerPermission('tcpipe', 'allow')).toBe(true);
    const out = await executeApproved((err as ApprovalRequiredError).interaction.args, 'tcpipe');
    expect(out.error).toBeUndefined();
    const res = JSON.parse(out.result ?? '{}') as { approved?: boolean; planNodeIds?: string[] };
    expect(res.approved).toBe(true);
    // planNodeIds = the pipeline's own output (1 note + 2 nodes per scene),
    // not the pre-existing setup node.
    expect(res.planNodeIds?.length).toBe(1 + 2 * 2);
    // Resume must not rebuild — same node count, no duplicated storyboard.
    expect(canvasStore.getSnapshot(canvas.id)!.nodes.length).toBe(before);
  });

  it('fuse: warns on a same-params re-run, refuses from the third', async () => {
    const { tools, nodeId, canvasStore, sessionId } = await setup();
    const run = (n: number) =>
      (tools.run_node as never as { execute: (a: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(
        { id: nodeId, wait: false, timeoutMs: 50 },
        { toolCallId: `tf${n}` },
      );

    const first = await run(1);
    expect(first.note).toBeUndefined();
    const second = await run(2);
    expect(String(second.note)).toContain('identical parameters');
    const third = await run(3);
    expect(third.ok).toBe(false);
    expect(String(third.error)).toContain('refused');

    // A params change resets the fuse.
    const canvas = canvasStore.ensureCanvas(sessionId);
    canvasStore.updateNode(canvas.id, nodeId, { params: { prompt: 'changed' } });
    const fourth = await run(4);
    expect(fourth.note).toBeUndefined();
    expect(String(fourth.error ?? '')).not.toContain('refused');
  });
});
