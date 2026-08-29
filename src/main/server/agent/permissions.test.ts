import { afterEach, describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../../../shared/stream';
import {
  answerPermission,
  isReadOnlyShellCommand,
  requestPermission,
  resetPermissionsForTests,
  setPermissionSink,
} from './permissions';

afterEach(() => {
  resetPermissionsForTests();
});

function permissionIds(events: ChatStreamEvent[]): string[] {
  return events.filter((event) => event.type === 'permission').map((event) => event.id);
}

describe('parallel tool permissions', () => {
  it('classifies inspect-only git as read-only', () => {
    expect(isReadOnlyShellCommand('git status --short --branch')).toBe(true);
    expect(isReadOnlyShellCommand('git diff --stat')).toBe(true);
    expect(isReadOnlyShellCommand('git log --oneline --decorate -8')).toBe(true);
    expect(isReadOnlyShellCommand('git remote -v')).toBe(true);
    expect(isReadOnlyShellCommand('git commit -am msg')).toBe(false);
    expect(isReadOnlyShellCommand('git remote add origin https://example.com')).toBe(false);
    expect(isReadOnlyShellCommand('git status && rm -rf /')).toBe(false);
  });

  it('auto-allows read-only git without prompting', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const allowed = await requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'git status --short --branch' },
      mode: 'ask',
    });
    expect(allowed).toBe(true);
    expect(events).toEqual([]);
  });

  it('does not auto-allow git that writes', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const pending = requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'git commit -am msg' },
      mode: 'ask',
    });
    await Promise.resolve();
    expect(permissionIds(events)).toEqual(['a']);
    expect(answerPermission('a', 'allow')).toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it('allow-session unblocks every waiter for the same tool', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const first = requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'npm test' },
      mode: 'ask',
    });
    const second = requestPermission({
      sessionId: 's1',
      toolCallId: 'b',
      name: 'run_command',
      args: { command: 'npm run lint' },
      mode: 'ask',
    });
    await Promise.resolve();
    expect(permissionIds(events)).toEqual(['a', 'b']);
    expect(answerPermission('b', 'allow-session')).toBe(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('after allowing one tool, re-emits the next waiter so the UI can ask again', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const first = requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'npm test' },
      mode: 'ask',
    });
    const second = requestPermission({
      sessionId: 's1',
      toolCallId: 'b',
      name: 'run_command',
      args: { command: 'npm run lint' },
      mode: 'ask',
    });
    await Promise.resolve();
    events.length = 0;
    expect(answerPermission('b', 'allow')).toBe(true);
    await expect(second).resolves.toBe(true);
    expect(permissionIds(events)).toEqual(['a']);
    expect(answerPermission('a', 'allow')).toBe(true);
    await expect(first).resolves.toBe(true);
  });
});
