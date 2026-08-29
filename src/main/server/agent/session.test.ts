import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { startAgentTurn, abortChatTurn, resumeAgentTurn } from './session';
import { translateOpenAiChunk } from './translators/openai';
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
    expect(events.at(-1)).toEqual({ type: 'done', aborted: false });
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
    expect(events.map((event) => event.type)).toEqual(['status', 'tool', 'tool', 'status', 'done']);
    expect(events[0]).toMatchObject({ type: 'status', phase: 'thinking', step: 0 });
    expect(events[1]).toMatchObject({ type: 'tool', id: 'c1', name: 'read_file' });
    expect(events[2]).toMatchObject({ type: 'tool', id: 'c1', result: 'ok' });
    expect(events[3]).toMatchObject({ type: 'status', phase: 'replying', step: 0 });
  });

  it('abort ends the stream with aborted:true and persists nothing', async () => {
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
    expect(events.at(-1)).toEqual({ type: 'done', aborted: true });

    const full = await store.get(s.id);
    expect(full!.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
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
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  }, 10_000);

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
