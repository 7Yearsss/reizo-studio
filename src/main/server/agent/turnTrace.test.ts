import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTurnTraceCollector, summarizeTraceHistory, writeTurnTrace } from './turnTrace';

describe('turn trace', () => {
  it('records setup, phases, model-call spans, first events and the tool timeline', () => {
    let t = 1000;
    const trace = createTurnTraceCollector({ sessionId: 's1', model: 'm', now: () => t, originAt: 400 });
    trace.mark('modelReady');
    t += 10;
    const call = trace.startModelCall();
    t += 5; call.permitAcquired();
    t += 700; call.headers(200);
    t += 80;
    trace.onEvent({ type: 'reasoning', delta: 'x' });
    trace.onEvent({ type: 'tool', id: 'a', name: 'generate_document', args: {} });
    t += 20; trace.onEvent({ type: 'tool', id: 'a', name: 'generate_document', args: {}, result: 'ok' });
    t += 100; call.bodyDone();
    const result = trace.finish({ outcome: 'completed', text: '', reasoningLeak: false });
    expect(result.setupMs).toBe(600);
    expect(result.phases).toEqual({ modelReady: 0 });
    expect(result.modelCalls).toEqual([{ startMs: 10, queueMs: 5, headersMs: 700, bodyMs: 200, status: 200 }]);
    expect(result.firstEvent).toEqual({ reasoning: 795, tool: 795 });
    expect(result.toolTimeline).toEqual([{ name: 'generate_document', startMs: 795, endMs: 815 }]);
  });

  it('records tool timing, failures, steps, loop verdicts and continue passes', () => {
    let t = 1000;
    const trace = createTurnTraceCollector({ sessionId: 's1', model: 'm', now: () => t });
    trace.onEvent({ type: 'status', phase: 'thinking', step: 0 });
    trace.onEvent({ type: 'tool', id: 'a', name: 'read_file', args: {} });
    t += 250;
    trace.onEvent({ type: 'tool', id: 'a', name: 'read_file', args: {}, result: 'ok' });
    trace.onEvent({ type: 'status', phase: 'thinking', step: 1 });
    trace.onEvent({ type: 'tool', id: 'b', name: 'edit_file', args: {} });
    t += 40;
    trace.onEvent({ type: 'tool', id: 'b', name: 'edit_file', args: {}, error: 'no match' });
    trace.onEvent({ type: 'tool_loop', tier: 'warn', reason: 'same tool failing' });
    trace.onContinue('todos');
    const result = trace.finish({ outcome: 'completed', text: 'done', reasoningLeak: false });
    expect(result.steps).toBe(2);
    expect(result.tools).toEqual([
      { name: 'read_file', ms: 250, ok: true },
      { name: 'edit_file', ms: 40, ok: false, error: 'no match' },
    ]);
    expect(result.loopVerdicts).toEqual([{ tier: 'warn', reason: 'same tool failing' }]);
    expect(result.continuePasses).toEqual(['todos']);
    expect(result.durationMs).toBe(290);

    const md = trace.toTrajectoryMarkdown();
    expect(md).toContain('[ACTION 1] read_file({})');
    expect(md).toContain('[OBSERVATION 1] ok');
    expect(md).toContain('[ACTION 2] edit_file({})');
    expect(md).toContain('[ERROR 2] no match');
  });

  it('summarizes multi-turn trace history and separates recurring failures from 1/k noise', () => {
    const t1 = createTurnTraceCollector({ sessionId: 's1', model: 'm' });
    t1.onEvent({ type: 'tool', id: '1', name: 'edit_file', args: {}, error: 'no match' });
    t1.onEvent({ type: 'tool', id: '2', name: 'read_file', args: {}, error: 'ENOENT' });
    t1.onContinue('undelivered');
    const t2 = createTurnTraceCollector({ sessionId: 's2', model: 'm' });
    t2.onEvent({ type: 'tool', id: '3', name: 'edit_file', args: {}, error: 'no match again' });
    t2.onEvent({ type: 'tool_loop', tier: 'warn', reason: 'stuck' });

    const summary = summarizeTraceHistory([
      t1.finish({ outcome: 'completed', text: '', reasoningLeak: false }),
      t2.finish({ outcome: 'completed', text: '', reasoningLeak: false }),
    ]);
    expect(summary.totalTurns).toBe(2);
    expect(summary.recurringToolFailures.map((f) => f.tool)).toEqual(['edit_file']);
    expect(summary.singleTurnToolFailures.map((f) => f.tool)).toEqual(['read_file']);
    expect(summary.loopWarnCount).toBe(1);
    expect(summary.undeliveredCount).toBe(1);
  });

  it('caps tool rows and reports how many were dropped', () => {
    const trace = createTurnTraceCollector({ sessionId: 's', model: 'm' });
    for (let i = 0; i < 205; i++) trace.onEvent({ type: 'tool', id: String(i), name: 'grep', args: {}, result: 'x' });
    const result = trace.finish({ outcome: 'completed', text: '', reasoningLeak: false });
    expect(result.tools).toHaveLength(200);
    expect(result.toolsDropped).toBe(5);
  });

  it('appends one JSON line per turn under traces/', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trace-'));
    try {
      const make = (outcome: string) => createTurnTraceCollector({ sessionId: 'sess/1', model: 'm' }).finish({ outcome, text: '', reasoningLeak: true });
      await writeTurnTrace(root, make('completed'));
      await writeTurnTrace(root, make('error'));
      const lines = (await readFile(path.join(root, 'traces', 'sess_1.jsonl'), 'utf8')).trim().split('\n');
      expect(lines.map((l) => JSON.parse(l).outcome)).toEqual(['completed', 'error']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
