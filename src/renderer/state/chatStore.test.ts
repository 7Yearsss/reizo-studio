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
        { type: 'done', aborted: false },
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

  it('gap in revisions still resolves (folds + tail reconcile)', async () => {
    feed(
      [
        { v: 1, sessionId: 's1', rev: 1, epoch: 'e1', event: { type: 'text', delta: 'a' } },
        // rev 2 & 3 missing -> gap
        { v: 1, sessionId: 's1', rev: 4, epoch: 'e1', event: { type: 'text', delta: 'b' } },
        { v: 1, sessionId: 's1', rev: 5, epoch: 'e1', event: { type: 'done', aborted: false } },
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
        onEvent({ type: 'done', aborted: false }, { rev: 11, epoch: 'e1' });
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
});
