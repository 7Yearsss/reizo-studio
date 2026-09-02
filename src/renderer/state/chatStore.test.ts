// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEventHandler } from '../api';

/**
 * Renderer chat-store flow: envelope folding via the liveRevision fence,
 * unified interaction model, and the resume path. `api` and the sibling
 * stores are mocked so the store's own logic is what's under test.
 */

const sessionRow = {
  id: 's1',
  title: 'T',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  workspacePath: null as string | null,
  projectId: null as string | null,
  activeTurnStartedAt: null as string | null,
  lastTurnEndedAt: null as string | null,
  lastTurnOutcome: null as 'completed' | 'interrupted' | 'error' | null,
  lastTurnError: null as string | null,
  messages: [] as unknown[],
};

const apiMock = {
  listSessions: vi.fn(async () => [sessionRow]),
  getSession: vi.fn(async () => ({ ...sessionRow })),
  createSession: vi.fn(),
  patchSession: vi.fn(),
  renameSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(),
  sendMessage: vi.fn(),
  resumeTurn: vi.fn(),
  stopMessage: vi.fn(async () => undefined),
  answerPermission: vi.fn(async () => undefined),
  answerAsk: vi.fn(async () => undefined),
};

vi.mock('../api', () => apiMock);
vi.mock('./tabStore', () => ({
  pruneMissingSessions: vi.fn(),
  renameChatTab: vi.fn(),
  closeSessionTabs: vi.fn(),
}));
vi.mock('./settingsStore', () => ({
  getSnapshot: () => ({ settings: { activeProviderId: 'reizo', providers: [{ id: 'reizo', model: 'gpt-5.4' }] } }),
}));
vi.mock('./uiStore', () => ({ getSnapshot: () => ({ selectedProjectId: null as string | null }) }));
vi.mock('./artifactStore', () => ({ loadSessionArtifacts: vi.fn(), dropSessionArtifacts: vi.fn() }));
vi.mock('./terminalStore', () => ({ appendTerminalLine: vi.fn() }));

let store: typeof import('./chatStore');

beforeEach(async () => {
  vi.resetModules();
  Object.values(apiMock).forEach((fn) => 'mockClear' in fn && fn.mockClear());
  store = await import('./chatStore');
});

afterEach(() => {
  vi.clearAllTimers();
});

function envLines(events: Array<Record<string, unknown>>, epoch = 'e1'): string {
  return events.map((event, i) => JSON.stringify({ v: 1, sessionId: 's1', rev: i + 1, epoch, event })).join('\n') + '\n';
}

/** Drives the mocked sendMessage: feeds NDJSON envelope lines to onEvent. */
function feed(lines: string): void {
  apiMock.sendMessage.mockImplementation(
    async (_sid: string, _text: string, opts: { onEvent: StreamEventHandler }) => {
      for (const line of lines.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const parsed = JSON.parse(t);
        opts.onEvent(parsed.event, { rev: parsed.rev, epoch: parsed.epoch });
      }
    },
  );
}

describe('chatStore streaming fold', () => {
  it('folds text deltas and a tool result, then reconciles from getSession', async () => {
    feed(
      envLines([
        { type: 'text', delta: 'Hel' },
        { type: 'text', delta: 'lo' },
        { type: 'tool', id: 't1', name: 'grep', args: { q: 'x' }, result: 'hit' },
        { type: 'done', outcome: 'completed', aborted: false },
      ]),
    );
    apiMock.getSession.mockResolvedValueOnce({
      ...sessionRow,
      messages: [
        { id: 'u1', role: 'user', content: 'hi', createdAt: 'x' },
        { id: 'a1', role: 'assistant', content: 'Hello', createdAt: 'x' },
      ],
    });

    await store.sendMessage('s1', 'hi');

    const s = store.getSnapshot();
    expect(s.sendingBySession['s1']).toBe(false);
    expect(s.turnStartedAtBySession['s1']).toBeUndefined();
    expect(s.messagesBySession['s1'].map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(s.streamingBySession['s1']).toBe(''); // cleared after reconcile
    expect(apiMock.getSession).toHaveBeenCalled();
  });

  it('routes a permission event into the unified interaction slice', async () => {
    // Mirror production: the stream stays open while a permission is pending,
    // so sendMessage has not resolved yet when we inspect the slice.
    let release: () => void = () => undefined;
    apiMock.sendMessage.mockImplementation(
      (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
        new Promise<void>((resolve) => {
          opts.onEvent(
            { type: 'permission', id: 'p1', name: 'run_command', args: { command: 'ls' } },
            { rev: 1, epoch: 'e1' },
          );
          release = resolve;
        }),
    );
    const pending = store.sendMessage('s1', 'do it');
    await Promise.resolve();
    const started = store.getSnapshot().turnStartedAtBySession.s1;
    expect(started).toBeGreaterThan(Date.now() - 2_000);
    expect(store.getSnapshot().interactionBySession['s1']).toMatchObject({
      kind: 'permission',
      id: 'p1',
      name: 'run_command',
    });
    // answering clears it
    await store.answerPermission('s1', 'allow');
    expect(store.getSnapshot().interactionBySession['s1']).toBeNull();
    expect(apiMock.answerPermission).toHaveBeenCalledWith('s1', 'p1', 'allow');
    release();
    await pending;
  });

  it('does not treat a heartbeat status as progress or a reply', async () => {
    const started = Date.now();
    let release: () => void = () => undefined;
    apiMock.sendMessage.mockImplementation(
      (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
        new Promise<void>((resolve) => {
          opts.onEvent({ type: 'text', delta: 'hi' }, { rev: 1, epoch: 'e1' });
          const progress = store.getSnapshot().lastProgressAtBySession.s1;
          opts.onEvent(
            { type: 'status', phase: 'replying', heartbeat: true },
            { rev: 2, epoch: 'e1' },
          );
          expect(store.getSnapshot().lastProgressAtBySession.s1).toBe(progress);
          expect(store.getSnapshot().replyPhaseBySession.s1).toBe('replying');
          release = resolve;
        }),
    );
    const pending = store.sendMessage('s1', 'hi');
    await Promise.resolve();
    expect(store.getSnapshot().turnStartedAtBySession.s1).toBeGreaterThanOrEqual(started);
    expect(store.getSnapshot().lastTextAtBySession.s1).toBeGreaterThanOrEqual(started);
    release();
    await pending;
  });

  it('reveals text on the typewriter clock instead of every delta', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let release: () => void = () => undefined;
      apiMock.sendMessage.mockImplementation(
        (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
          new Promise<void>((resolve) => {
            for (let i = 0; i < 20; i += 1) {
              opts.onEvent({ type: 'text', delta: 'x' }, { rev: i + 1, epoch: 'e1' });
            }
            release = resolve;
          }),
      );
      const pending = store.sendMessage('s1', 'hi');
      await Promise.resolve();
      const first = store.getSnapshot().streamingBySession.s1;
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBeLessThan(20);
      vi.advanceTimersByTime(2_000);
      expect(store.getSnapshot().streamingBySession.s1).toBe('x'.repeat(20));
      release();
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a permission prompt when a sibling tool_use arrives', async () => {
    let release: () => void = () => undefined;
    apiMock.sendMessage.mockImplementation(
      (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
        new Promise<void>((resolve) => {
          opts.onEvent(
            { type: 'permission', id: 'p1', name: 'run_command', args: { command: 'npm test' } },
            { rev: 1, epoch: 'e1' },
          );
          opts.onEvent(
            { type: 'tool', id: 't2', name: 'run_command', args: { command: 'npm run lint' } },
            { rev: 2, epoch: 'e1' },
          );
          release = resolve;
        }),
    );
    const pending = store.sendMessage('s1', 'do it');
    await Promise.resolve();
    expect(store.getSnapshot().interactionBySession['s1']).toMatchObject({
      kind: 'permission',
      id: 'p1',
    });
    release();
    await pending;
  });

  it('does not wipe a newer permission that arrived while answering the previous one', async () => {
    let onEvent: StreamEventHandler | undefined;
    let release: () => void = () => undefined;
    apiMock.sendMessage.mockImplementation(
      (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
        new Promise<void>((resolve) => {
          onEvent = opts.onEvent;
          opts.onEvent(
            { type: 'permission', id: 'p1', name: 'run_command', args: { command: 'npm test' } },
            { rev: 1, epoch: 'e1' },
          );
          release = resolve;
        }),
    );
    apiMock.answerPermission.mockImplementation(async () => {
      onEvent?.(
        { type: 'permission', id: 'p2', name: 'run_command', args: { command: 'npm run lint' } },
        { rev: 2, epoch: 'e1' },
      );
    });
    const pending = store.sendMessage('s1', 'do it');
    await Promise.resolve();
    await store.answerPermission('s1', 'allow');
    expect(store.getSnapshot().interactionBySession['s1']).toMatchObject({
      kind: 'permission',
      id: 'p2',
    });
    release();
    await pending;
  });

  it('keeps a turn active until stop receives the terminal interrupted event', async () => {
    let onEvent: StreamEventHandler | undefined;
    let release: () => void = () => undefined;
    apiMock.sendMessage.mockImplementation(
      (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
        new Promise<void>((resolve) => {
          onEvent = opts.onEvent;
          release = resolve;
        }),
    );
    apiMock.getSession.mockResolvedValueOnce({ ...sessionRow, lastTurnOutcome: 'interrupted' });

    const pending = store.sendMessage('s1', 'long task');
    await Promise.resolve();
    const stopping = store.stopMessage('s1');
    await Promise.resolve();

    expect(store.getSnapshot().sendingBySession['s1']).toBe(true);
    expect(store.getSnapshot().interruptRequestedBySession['s1']).toBe(true);

    onEvent?.({ type: 'done', outcome: 'interrupted', aborted: true }, { rev: 1, epoch: 'e1' });
    release();
    await Promise.all([pending, stopping]);
    expect(store.getSnapshot().sendingBySession['s1']).toBe(false);
    expect(store.getSnapshot().turnOutcomeBySession['s1']).toBe('interrupted');
  });

  it('gap in revisions still resolves (folds + tail reconcile)', async () => {
    feed(
      [
        { v: 1, sessionId: 's1', rev: 1, epoch: 'e1', event: { type: 'text', delta: 'a' } },
        // rev 2 & 3 missing -> gap
        { v: 1, sessionId: 's1', rev: 4, epoch: 'e1', event: { type: 'text', delta: 'b' } },
        { v: 1, sessionId: 's1', rev: 5, epoch: 'e1', event: { type: 'done', outcome: 'completed', aborted: false } },
      ]
        .map((x) => JSON.stringify(x))
        .join('\n') + '\n',
    );
    await store.sendMessage('s1', 'hi');
    // no throw, sending cleared, reconcile ran
    expect(store.getSnapshot().sendingBySession['s1']).toBe(false);
    expect(apiMock.getSession).toHaveBeenCalled();
  });

  it('resumeInterruptedTurn tails /stream/resume and reconciles', async () => {
    apiMock.resumeTurn.mockImplementation(
      async (_sid: string, _after: number, _epoch: unknown, onEvent: StreamEventHandler) => {
        onEvent({ type: 'text', delta: 'more' }, { rev: 10, epoch: 'e1' });
        onEvent({ type: 'done', outcome: 'completed', aborted: false }, { rev: 11, epoch: 'e1' });
      },
    );
    await store.resumeInterruptedTurn('s1');
    expect(apiMock.resumeTurn).toHaveBeenCalledWith('s1', -1, null, expect.any(Function), expect.any(AbortSignal));
    expect(store.getSnapshot().sendingBySession['s1']).toBe(false);
  });

  it('shouldShowInterruptBanner reflects start > end and dismissal', async () => {
    apiMock.listSessions.mockResolvedValueOnce([
      { ...sessionRow, activeTurnStartedAt: '2026-01-01T00:00:05.000Z', lastTurnEndedAt: null },
    ]);
    await store.loadSessions();
    expect(store.shouldShowInterruptBanner('s1')).toBe(true);
    store.dismissInterrupt('s1');
    expect(store.shouldShowInterruptBanner('s1')).toBe(false);
  });

  it('hydrates a persisted turn error so a failed reply is visible after reload', async () => {
    apiMock.listSessions.mockResolvedValueOnce([
      {
        ...sessionRow,
        lastTurnOutcome: 'error',
        lastTurnError: '用户额度不足',
      },
    ]);
    await store.loadSessions();
    expect(store.getSnapshot().turnOutcomeBySession.s1).toBe('error');
    expect(store.getSnapshot().errorBySession.s1).toBe('用户额度不足');
  });

  it('refreshes terminal metadata even when messages are already cached', async () => {
    apiMock.getSession.mockResolvedValueOnce({
      ...sessionRow,
      messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 'x' }],
    });
    await store.ensureSessionMessages('s1');
    apiMock.getSession.mockResolvedValueOnce({
      ...sessionRow,
      lastTurnOutcome: 'error',
      lastTurnError: 'Provider unavailable',
      messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 'x' }],
    });
    await store.ensureSessionMessages('s1');
    expect(apiMock.getSession).toHaveBeenCalledWith('s1');
    expect(store.getSnapshot().errorBySession.s1).toBe('Provider unavailable');
  });

  it('keeps the turn live and resumes when the stream ends before a terminal done', async () => {
    let releaseResume: () => void = () => undefined;
    apiMock.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error('Response stream ended before terminal turn outcome'), {
        name: 'ChatStreamIncompleteError',
      }),
    );
    apiMock.resumeTurn.mockImplementation(
      (_sid: string, _after: number, _epoch: unknown, onEvent: StreamEventHandler) =>
        new Promise<void>((resolve) => {
          releaseResume = () => {
            onEvent({ type: 'done', outcome: 'completed', aborted: false }, { rev: 2, epoch: 'e1' });
            resolve();
          };
        }),
    );
    apiMock.getSession.mockResolvedValue({
      ...sessionRow,
      lastTurnOutcome: 'completed',
      messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 'x' }],
    });

    const pending = store.sendMessage('s1', 'hi');
    await vi.waitFor(() => {
      expect(apiMock.resumeTurn).toHaveBeenCalled();
      expect(store.getSnapshot().sendingBySession.s1).toBe(true);
    });
    expect(store.getSnapshot().errorBySession.s1).toBe('回复连接中断，正在恢复…');
    expect(store.getSnapshot().replyPhaseBySession.s1).toBe('thinking');

    releaseResume();
    await pending;

    expect(store.getSnapshot().sendingBySession.s1).toBe(false);
    expect(store.getSnapshot().turnOutcomeBySession.s1).toBe('completed');
  });

  it('does not clobber a live turn when ensureSessionMessages refetches', async () => {
    let release: () => void = () => undefined;
    apiMock.sendMessage.mockImplementation(
      (_s: string, _t: string, opts: { onEvent: StreamEventHandler }) =>
        new Promise<void>((resolve) => {
          opts.onEvent({ type: 'text', delta: 'live' }, { rev: 1, epoch: 'e1' });
          release = resolve;
        }),
    );
    const pending = store.sendMessage('s1', 'hi');
    await Promise.resolve();
    apiMock.getSession.mockResolvedValueOnce({
      ...sessionRow,
      lastTurnOutcome: 'interrupted',
      messages: [{ id: 'stale', role: 'user', content: 'stale', createdAt: 'x' }],
    });
    await store.ensureSessionMessages('s1');
    expect(store.getSnapshot().sendingBySession.s1).toBe(true);
    expect(store.getSnapshot().messagesBySession.s1.some((m) => m.content === 'stale')).toBe(false);
    expect(store.getSnapshot().messagesBySession.s1.some((m) => m.role === 'user' && m.content === 'hi')).toBe(true);
    release();
    await pending;
  });
});
