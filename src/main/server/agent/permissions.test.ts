import { afterEach, describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../../../shared/stream';
import {
  answerAsk,
  answerPermission,
  consumeInteractions,
  isReadOnlyShellCommand,
  registerPendingAsk,
  requestPermission,
  resetPermissionsForTests,
  setPermissionSink,
  waitForInteractions,
} from './permissions';

afterEach(() => {
  resetPermissionsForTests();
});

function ids(events: ChatStreamEvent[], type: 'permission' | 'ask'): string[] {
  return events.filter((event) => event.type === type).map((event) => (event as { id: string }).id);
}

describe('interaction gate', () => {
  it('classifies inspect-only git as read-only', () => {
    expect(isReadOnlyShellCommand('git status --short --branch')).toBe(true);
    expect(isReadOnlyShellCommand('git diff --stat')).toBe(true);
    expect(isReadOnlyShellCommand('git log --oneline --decorate -8')).toBe(true);
    expect(isReadOnlyShellCommand('git remote -v')).toBe(true);
    expect(isReadOnlyShellCommand('git commit -am msg')).toBe(false);
    expect(isReadOnlyShellCommand('git status && rm -rf /')).toBe(false);
  });

  it('auto-allows read-only git without recording a pending prompt', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const ok = await requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'git status --short --branch' },
      mode: 'ask',
    });
    expect(ok).toBe(true);
    expect(events).toEqual([]);
    await expect(waitForInteractions('s1')).resolves.toBeUndefined();
  });

  it('records a pending prompt (never blocks) for a writing command', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const ok = await requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'git commit -am msg' },
      mode: 'ask',
    });
    expect(ok).toBe(false);
    expect(ids(events, 'permission')).toEqual(['a']);

    let resolved = false;
    void waitForInteractions('s1').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    expect(answerPermission('a', 'allow')).toBe(true);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'a', name: 'run_command', args: { command: 'git commit -am msg' }, kind: 'permission', decision: 'allow', answers: undefined },
    ]);
  });

  it('shows one prompt at a time and re-emits the next after an answer', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    await requestPermission({ sessionId: 's1', toolCallId: 'a', name: 'run_command', args: { command: 'npm test' }, mode: 'ask' });
    await requestPermission({ sessionId: 's1', toolCallId: 'b', name: 'run_command', args: { command: 'npm run lint' }, mode: 'ask' });
    expect(ids(events, 'permission')).toEqual(['a']);

    expect(answerPermission('a', 'allow')).toBe(true);
    expect(ids(events, 'permission')).toEqual(['a', 'b']);

    let done = false;
    void waitForInteractions('s1').then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);

    expect(answerPermission('b', 'deny')).toBe(true);
    await waitForInteractions('s1');
    expect(done).toBe(true);
    const resolved = consumeInteractions('s1');
    expect(resolved.map((r) => [r.toolCallId, r.decision])).toEqual([
      ['a', 'allow'],
      ['b', 'deny'],
    ]);
  });

  it('allow-session resolves every pending prompt for that tool and grants future calls', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    await requestPermission({ sessionId: 's1', toolCallId: 'a', name: 'run_command', args: { command: 'npm test' }, mode: 'ask' });
    await requestPermission({ sessionId: 's1', toolCallId: 'b', name: 'run_command', args: { command: 'npm run lint' }, mode: 'ask' });

    expect(answerPermission('a', 'allow-session')).toBe(true);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1').map((r) => r.decision)).toEqual(['allow-session', 'allow-session']);

    // A later call for the same tool no longer needs a prompt.
    const ok = await requestPermission({
      sessionId: 's1',
      toolCallId: 'c',
      name: 'run_command',
      args: { command: 'npm run build' },
      mode: 'ask',
    });
    expect(ok).toBe(true);
  });

  it('unanswered interactions read as denied when consumed', async () => {
    setPermissionSink('s1', () => undefined);
    await requestPermission({ sessionId: 's1', toolCallId: 'a', name: 'run_command', args: { command: 'rm x' }, mode: 'ask' });
    const controller = new AbortController();
    const wait = waitForInteractions('s1', controller.signal);
    controller.abort();
    await wait;
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'a', name: 'run_command', args: { command: 'rm x' }, kind: 'permission', decision: 'deny', answers: undefined },
    ]);
  });

  it('routes ask questions through the same gate', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [{ id: 'colour', prompt: 'Which colour?' }],
    });
    expect(ids(events, 'ask')).toEqual(['q1']);

    expect(answerAsk('q1', { colour: 'blue' })).toBe(true);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q1', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { colour: 'blue' } },
    ]);
  });
});
