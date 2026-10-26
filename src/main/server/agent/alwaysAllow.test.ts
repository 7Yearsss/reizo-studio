import { afterEach, describe, expect, it } from 'vitest';
import {
  answerPermission,
  configurePersistentAllow,
  consumeInteractions,
  listPersistentAllow,
  requestPermission,
  resetPermissionsForTests,
  revokePersistentAllow,
} from './permissions';

afterEach(() => resetPermissionsForTests());

const ask = (sessionId: string, toolCallId: string, name: string) => requestPermission({ sessionId, toolCallId, name, args: {}, mode: 'ask' });

describe('persistent always-allow for MCP tools', () => {
  it('allow-always sticks across sessions, is saved, and revoking asks again', async () => {
    const saved: string[][] = [];
    configurePersistentAllow([], (names) => saved.push(names));

    expect(await ask('s1', 'c1', 'mcp__files__read')).toBe(false);
    answerPermission('c1', 'allow-always');
    consumeInteractions('s1');

    expect(saved).toEqual([['mcp__files__read']]);
    expect(await ask('s1', 'c2', 'mcp__files__read')).toBe(true);
    expect(await ask('s2', 'c3', 'mcp__files__read')).toBe(true); // a different session, no new prompt

    expect(revokePersistentAllow('mcp__files__read')).toBe(true);
    expect(saved.at(-1)).toEqual([]);
    expect(await ask('s2', 'c4', 'mcp__files__read')).toBe(false);
  });

  it('a stored list is honoured after a restart, but only for eligible tools', async () => {
    configurePersistentAllow(['mcp__a__b', 'computer', 'create_schedule', 'write_file'], () => undefined);
    expect(listPersistentAllow()).toEqual(['mcp__a__b']);
    expect(await ask('s', 'c1', 'mcp__a__b')).toBe(true);
    expect(await ask('s', 'c2', 'computer')).toBe(false);
    expect(await requestPermission({ sessionId: 's', toolCallId: 'c3', name: 'create_schedule', args: {}, mode: 'full' })).toBe(false);
  });

  it('computer and the always-ask tools can never be made permanent', async () => {
    const saved: string[][] = [];
    configurePersistentAllow([], (names) => saved.push(names));
    expect(await ask('s', 'c1', 'computer')).toBe(false);
    answerPermission('c1', 'allow-always');
    consumeInteractions('s');
    expect(saved).toEqual([]);
    expect(await ask('s', 'c2', 'computer')).toBe(true); // this session's grant only
    expect(await ask('other', 'c3', 'computer')).toBe(false); // every new session still asks
    expect(await requestPermission({ sessionId: 's', toolCallId: 'c4', name: 'create_schedule', args: {}, mode: 'full' })).toBe(false);
    answerPermission('c4', 'allow-always');
    consumeInteractions('s');
    expect(await requestPermission({ sessionId: 's', toolCallId: 'c5', name: 'create_schedule', args: {}, mode: 'full' })).toBe(false);
  });
});
