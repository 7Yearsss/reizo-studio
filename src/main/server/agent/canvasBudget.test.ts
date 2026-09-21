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
import { answerPermission, isApprovalRequiredError } from './permissions';

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
  const tools = createCanvasTools({
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
  return { tools, budget, sessionId: session.id, nodeId: node.id, canvasStore };
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
