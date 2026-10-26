import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMemoryManifest, readMemoryEntry } from '../../workspaceMemoryDir';
import { readWorkspaceMemory } from '../../workspaceMemory';
import { answerPermission, consumeInteractions, resetPermissionsForTests } from './permissions';
import { createPersonalMemoryTools, personalMemoryRoot } from './personalMemory';

describe('personal memory', () => {
  let dataRoot: string;
  beforeEach(async () => { dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-personal-mem-')); });
  afterEach(async () => { resetPermissionsForTests(); await rm(dataRoot, { recursive: true, force: true }); });
  const make = (permissionMode: 'ask' | 'workspace' | 'full') => createPersonalMemoryTools({ sessionId: 's', dataRoot, permissionMode, emit: () => undefined });

  it('works with no workspace: saved under the data root and listed in the injected index', async () => {
    const { tools } = make('workspace');
    const out = await (tools.personal_memory_write.execute as any)({ name: 'tone', description: '回复先给结论', type: 'user', body: '先结论后细节' }, { toolCallId: 't1' });
    expect(out.scope).toBe('personal');
    expect((await readMemoryEntry(personalMemoryRoot(dataRoot), out.fileName))?.body).toBe('先结论后细节');
    expect(await readWorkspaceMemory(personalMemoryRoot(dataRoot))).toContain('tone');
  });

  it('private memories stay out of the index and are returned with a reminder only on request', async () => {
    const { tools } = make('full');
    const out = await (tools.personal_memory_write.execute as any)({ name: 'health', description: '健康情况', type: 'user', body: '对花生过敏', private: true }, { toolCallId: 't2' });
    const index = await readFile(path.join(personalMemoryRoot(dataRoot), 'MEMORY.md'), 'utf8');
    expect(index).not.toContain('health');
    expect((await listMemoryManifest(personalMemoryRoot(dataRoot)))[0]).toMatchObject({ private: true });
    const read = await (tools.personal_memory_read.execute as any)({ file: out.fileName }, {});
    expect(read.body).toBe('对花生过敏');
    expect(read.reminder).toContain('私密');
  });

  it('in ask mode a write waits for the user and writes nothing until approved', async () => {
    const m = make('ask');
    await expect((m.tools.personal_memory_write.execute as any)({ name: 'x', description: 'd', type: 'user', body: 'b' }, { toolCallId: 't3' })).rejects.toThrow('__REIZO_INTERACTION_REQUIRED__');
    expect(await listMemoryManifest(personalMemoryRoot(dataRoot))).toEqual([]);
    answerPermission('t3', 'allow');
    const [item] = consumeInteractions('s');
    const done = await m.executeApproved(item.name, item.args);
    expect(done.error).toBeUndefined();
    expect(await listMemoryManifest(personalMemoryRoot(dataRoot))).toHaveLength(1);
  });

  it('refuses to store secrets', async () => {
    const { tools } = make('full');
    await expect((tools.personal_memory_write.execute as any)({ name: 'key', description: 'd', type: 'user', body: 'sk-' + 'a'.repeat(30) }, { toolCallId: 't4' })).rejects.toThrow('unsafe memory');
  });
});
