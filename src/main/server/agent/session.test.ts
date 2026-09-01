import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { startAgentTurn, abortChatTurn, resumeAgentTurn } from './session';
import { translateOpenAiChunk } from './translators/openai';
import { ApprovalRequiredError } from './permissions';
import type { ChatStreamEvent } from '../../../shared/stream';
import type { LiveEnvelope } from '../../../shared/liveRevision';

type Chunk = { type: string; [k: string]: unknown };
type Step = Chunk | { __delayMs: number };

function streamOf(chunks: Step[]) {
  return {
    fullStream: (async function* () {
      for (const c of chunks) {
        if ('__delayMs' in c) {
          await new Promise((r) => setTimeout(r, (c as { __delayMs: number }).__delayMs));
          continue;
        }
        yield c as Chunk;
      }
    })(),
  };
}

async function collectRaw(res: Response): Promise<LiveEnvelope[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const out: LiveEnvelope[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) out.push(JSON.parse(line));
  }
  if (buf.trim()) out.push(JSON.parse(buf));
  return out;
}

async function collect(res: Response): Promise<ChatStreamEvent[]> {
  return (await collectRaw(res)).map((e) => e.event);
}

function freshStore() {
  return createSqliteSessionStore(openDb(':memory:'));
}

describe('AgentSession.startTurn', () => {
  it('streams legacy events and persists the assistant row', async () => {
    const store = freshStore();
    const s = await store.create('t');
    await store.appendMessage(s.id, {
      id: 'u1',
      role: 'user',
      content: 'hi',
      createdAt: new Date().toISOString(),
    });

    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () =>
        streamOf([
          { type: 'text-delta', text: 'Hel' },
          { type: 'text-delta', text: 'lo' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'grep', input: { q: 'x' } },
          { type: 'tool-result', toolCallId: 'c1', toolName: 'grep', input: { q: 'x' }, output: 'found' },
        ]),
    });

    const events = await collect(res);
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual([
      'Hel',
      'lo',
    ]);
    const tool = events.find((e) => e.type === 'tool' && 'result' in e) as { name: string; result?: string } | undefined;
    expect(tool).toMatchObject({ name: 'grep', result: 'found' });
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'completed', aborted: false });
    // Tool start is visible immediately; the result upserts the same id.
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool')[0]).toMatchObject({
      id: 'c1',
      name: 'grep',
      args: { q: 'x' },
    });

    const full = await store.get(s.id);
    const assistant = full!.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('Hello');
    expect(assistant?.parts?.[0]).toMatchObject({ id: 'c1', name: 'grep', result: 'found' });
    expect(assistant?.turnId).toBeTruthy();
    expect(assistant?.durationMs).toBeGreaterThan(0);
    expect(store.getRuntimeState(s.id)?.lastTurnOutcome).toBe('completed');
  });

  it('streams lifecycle status around a tool and keeps the tool id stable', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const events = await collect(
      startAgentTurn({
        sessionStore: store,
        sessionId: s.id,
        translate: translateOpenAiChunk,
        createStream: () =>
          streamOf([
            { type: 'start-step', step: 0 },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: { path: 'a.txt' } },
            { type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', input: { path: 'a.txt' }, output: 'ok' },
            { type: 'finish-step', step: 0 },
          ]),
      }),
    );
    expect(events[0]).toMatchObject({ type: 'status', phase: 'thinking' });
    expect(events.map((event) => event.type)).toEqual(['status', 'status', 'tool', 'tool', 'status', 'done']);
    expect(events[1]).toMatchObject({ type: 'status', phase: 'thinking', step: 0 });
    expect(events[2]).toMatchObject({ type: 'tool', id: 'c1', name: 'read_file' });
    expect(events[3]).toMatchObject({ type: 'tool', id: 'c1', result: 'ok' });
    expect(events[4]).toMatchObject({ type: 'status', phase: 'thinking', step: 0 });
  });

  it('abort ends the stream with aborted:true and keeps the partial assistant row', async () => {
    const store = freshStore();
    const s = await store.create('t');

    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () =>
        streamOf([
          { type: 'text-delta', text: 'partial' },
          { __delayMs: 200 },
          { type: 'text-delta', text: ' more' },
        ]),
    });

    setTimeout(() => abortChatTurn(s.id), 40);
    const events = await collect(res);
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'interrupted', aborted: true });

    const full = await store.get(s.id);
    const assistant = full!.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toMatch(/partial/);
    expect(store.getRuntimeState(s.id)?.lastTurnOutcome).toBe('interrupted');
  });

  it('idle watchdog trips on a wedged upstream', async () => {
    const store = freshStore();
    const s = await store.create('t');

    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      watchdog: { idleMs: 60, stallMs: 500, abortGraceMs: 50 },
      createStream: () => streamOf([{ type: 'text-delta', text: 'start' }, { __delayMs: 5000 }]),
    });

    const events = await collect(res);
    expect(events.some((e) => e.type === 'error' && /idle/i.test((e as { error: string }).error))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'error' });
  }, 10_000);

  it('does not treat an empty upstream stream as a completed turn', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const events = await collect(
      startAgentTurn({
        sessionStore: store,
        sessionId: s.id,
        translate: translateOpenAiChunk,
        createStream: () => streamOf([]),
      }),
    );

    expect(events.at(-2)).toMatchObject({ type: 'error' });
    expect(events.at(-1)).toEqual({
      type: 'done',
      outcome: 'error',
      error: 'Provider ended without an assistant result',
    });
    expect((await store.get(s.id))!.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
    expect(store.getRuntimeState(s.id)?.lastTurnOutcome).toBe('error');
  });

  it('forces a terminal interrupted outcome when an upstream ignores abort', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      watchdog: { idleMs: 5_000, stallMs: 5_000, abortGraceMs: 30 },
      createStream: () => ({
        fullStream: {
          [Symbol.asyncIterator]() {
            return { next: () => new Promise<never>(() => undefined) };
          },
        },
      }),
    });

    setTimeout(() => abortChatTurn(s.id), 10);
    const events = await collect(res);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted', aborted: true });
    expect(store.getRuntimeState(s.id)?.lastTurnOutcome).toBe('interrupted');
  }, 2_000);

  it('classifies a provider step timeout as an error, not a user interruption', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () => ({
        fullStream: (async function* () {
          throw new Error('Step timeout of 120000ms exceeded');
        })(),
      }),
    });

    const events = await collect(res);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'error' });
    expect(events.at(-1)).not.toMatchObject({ aborted: true });
    expect(store.getRuntimeState(s.id)?.lastTurnOutcome).toBe('error');
  });

  it('surfaces a gateway 524 as a timeout instead of openai_error', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () => ({
        fullStream: (async function* () {
          throw Object.assign(new Error('openai_error'), {
            name: 'AI_APICallError',
            statusCode: 524,
            isRetryable: true,
            data: { error: { message: 'openai_error', type: 'bad_response_status_code' } },
          });
        })(),
      }),
    });

    const events = await collect(res);
    expect(events.at(-2)).toMatchObject({
      type: 'error',
      error: '上游超时（HTTP 524）。网关在等待模型输出时断开了，可以重试。',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'error',
      error: '上游超时（HTTP 524）。网关在等待模型输出时断开了，可以重试。',
    });
    expect(store.getRuntimeState(s.id)?.lastTurnError).toBe(
      '上游超时（HTTP 524）。网关在等待模型输出时断开了，可以重试。',
    );
  });

  it('opens another provider pass instead of completing a deferred plan', async () => {
    const store = freshStore();
    const s = await store.create('t');
    let passes = 0;

    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () =>
        streamOf([{ type: 'text-delta', text: '初步看下来，我继续核对几个关键边界：权限队列和恢复流程。' }]),
      onContinuePass: async ({ getAssistant, passIndex }) => {
        if (passIndex > 0) return null;
        passes += 1;
        expect(getAssistant().text).toMatch(/我继续核对/);
        return streamOf([{ type: 'text-delta', text: '核对结果：markTurnEnd 在刷新后会丢 in-flight 的 done。' }]);
      },
    });

    const events = await collect(res);
    expect(passes).toBe(1);
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toContain(
      '核对结果',
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'completed' });
    const assistant = (await store.get(s.id))!.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toMatch(/核对结果/);
  });

  it('suspends on an approval-needing tool and resumes the same turn', async () => {
    const store = freshStore();
    const s = await store.create('t');
    let passes = 0;

    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      watchdog: { idleMs: 200, stallMs: 400, abortGraceMs: 50 },
      createStream: () =>
        streamOf([
          { type: 'text-delta', text: 'let me run it' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'run_command', input: { command: 'npm test' } },
          {
            type: 'tool-error',
            toolCallId: 'c1',
            toolName: 'run_command',
            input: { command: 'npm test' },
            error: new ApprovalRequiredError({
              toolCallId: 'c1',
              name: 'run_command',
              args: { command: 'npm test' },
              kind: 'permission',
            }),
          },
        ]),
      onAwaitingInteraction: async ({ pending, emitToolResult }) => {
        passes += 1;
        expect(pending).toEqual([
          { toolCallId: 'c1', name: 'run_command', args: { command: 'npm test' }, kind: 'permission', questions: undefined },
        ]);
        emitToolResult({
          toolCallId: 'c1',
          name: 'run_command',
          args: { command: 'npm test' },
          result: '{"exitCode":0}',
        });
        return streamOf([{ type: 'text-delta', text: ' — all green' }]);
      },
    });

    const events = await collect(res);
    expect(passes).toBe(1);
    expect(events[0]).toMatchObject({ type: 'status', phase: 'thinking' });
    expect(events.some((e) => e.type === 'status' && (e as { phase: string }).phase === 'waiting')).toBe(true);
    expect(events.find((e) => e.type === 'tool' && 'result' in e)).toMatchObject({
      id: 'c1',
      result: '{"exitCode":0}',
    });
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe(
      'let me run it — all green',
    );
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'completed', aborted: false });

    const assistant = (await store.get(s.id))!.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('let me run it — all green');
    expect(assistant?.parts?.[0]).toMatchObject({ id: 'c1', name: 'run_command', result: '{"exitCode":0}' });
    expect(store.getRuntimeState(s.id)?.lastTurnOutcome).toBe('completed');
  });

  it('emits waiting heartbeats while the turn is parked on the user', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      watchdog: { idleMs: 2_000, stallMs: 2_000, abortGraceMs: 50, heartbeatMs: 20 },
      createStream: () =>
        streamOf([
          {
            type: 'tool-error',
            toolCallId: 'c1',
            toolName: 'run_command',
            input: { command: 'npm test' },
            error: new ApprovalRequiredError({
              toolCallId: 'c1',
              name: 'run_command',
              args: { command: 'npm test' },
              kind: 'permission',
            }),
          },
        ]),
      onAwaitingInteraction: async ({ emitToolResult }) => {
        await new Promise((r) => setTimeout(r, 55));
        emitToolResult({
          toolCallId: 'c1',
          name: 'run_command',
          args: { command: 'npm test' },
          result: '{"exitCode":0}',
        });
        return streamOf([{ type: 'text-delta', text: 'done' }]);
      },
    });

    const events = await collect(res);
    const waiting = events.filter((e) => e.type === 'status' && (e as { phase: string }).phase === 'waiting');
    expect(waiting.length).toBeGreaterThan(1);
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'completed', aborted: false });
  });

  it('emits monotonic revisions and a stable epoch on the envelope', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () =>
        streamOf([
          { type: 'text-delta', text: 'a' },
          { type: 'text-delta', text: 'b' },
        ]),
    });
    const envs = await collectRaw(res);
    expect(envs.map((e) => e.rev)).toEqual([...envs.map((_, i) => i + 1)]);
    expect(new Set(envs.map((e) => e.epoch)).size).toBe(1);
    expect(envs.every((e) => e.v === 1 && e.sessionId === s.id)).toBe(true);
  });

  it('resume replays the tail after a rev and does not duplicate seen events', async () => {
    const store = freshStore();
    const s = await store.create('t');
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      createStream: () =>
        streamOf([
          { type: 'text-delta', text: '1' },
          { __delayMs: 30 },
          { type: 'text-delta', text: '2' },
          { __delayMs: 30 },
          { type: 'text-delta', text: '3' },
        ]),
    });

    // Read the whole primary stream, then resume from rev 2.
    const primary = await collectRaw(res);
    const epoch = primary[0].epoch;
    const resumed = await collectRaw(resumeAgentTurn(s.id, { after: 2, epoch }));
    expect(resumed.every((e) => e.rev > 2)).toBe(true);
    expect(resumed.map((e) => e.event.type).includes('done')).toBe(true);
    // rev 1 and 2 must not reappear
    expect(resumed.some((e) => e.rev <= 2)).toBe(false);
  });

  it('resume of a finished turn just sends a terminal done', async () => {
    const store = freshStore();
    const s = await store.create('t');
    await collectRaw(
      startAgentTurn({
        sessionStore: store,
        sessionId: s.id,
        translate: translateOpenAiChunk,
        createStream: () => streamOf([{ type: 'text-delta', text: 'x' }]),
      }),
    );
    const resumed = await collectRaw(resumeAgentTurn(s.id, { after: 999 }));
    expect(resumed.at(-1)?.event).toMatchObject({ type: 'done' });
  });

  it('turn markers: a completed turn ends >= start', async () => {
    const store = freshStore();
    const s = await store.create('t');
    await collectRaw(
      startAgentTurn({
        sessionStore: store,
        sessionId: s.id,
        translate: translateOpenAiChunk,
        createStream: () => streamOf([{ type: 'text-delta', text: 'x' }]),
      }),
    );
    const rs = store.getRuntimeState(s.id)!;
    expect(rs.activeTurnStartedAt).toBeGreaterThan(0);
    expect(rs.lastTurnEndedAt).toBeGreaterThanOrEqual(rs.activeTurnStartedAt!);
  });

  it('turn markers: a frozen (crash-like) turn leaves start > end', async () => {
    const store = freshStore();
    const s = await store.create('t');
    store.freezeTurnMarkers();
    const res = startAgentTurn({
      sessionStore: store,
      sessionId: s.id,
      translate: translateOpenAiChunk,
      watchdog: { idleMs: 20, stallMs: 200, abortGraceMs: 20 },
      createStream: () => streamOf([{ type: 'text-delta', text: 'x' }, { __delayMs: 3000 }]),
    });
    await collectRaw(res);
    const rs = store.getRuntimeState(s.id)!;
    expect(rs.activeTurnStartedAt).toBeGreaterThan(0);
    expect(rs.lastTurnEndedAt).toBeNull();
  }, 10_000);
});
