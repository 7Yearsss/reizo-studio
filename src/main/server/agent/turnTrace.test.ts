import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTurnTraceCollector, writeTurnTrace } from './turnTrace';

describe('turn trace', () => {
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
