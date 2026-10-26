import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MCP_META_THRESHOLD } from '../../../shared/toolSearch';
import { answerPermission, consumeInteractions, resetPermissionsForTests, setPermissionSink } from './permissions';
import { closeSessionMcp, connectMcpTools, resetMcpBaseline, resetMcpPoolForTests } from './mcpTools';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'reizo-mcpmeta-'));
  await writeFile(path.join(root, 'mcp.json'), JSON.stringify({ mcpServers: { big: { command: 'unused' } } }));
});
afterEach(async () => {
  resetPermissionsForTests();
  await closeSessionMcp('s-meta');
  await resetMcpPoolForTests();
  await resetMcpBaseline(root);
  await rm(root, { recursive: true, force: true });
});

function fakeClient(count: number, calls: string[]) {
  const tools: Record<string, unknown> = {};
  for (let i = 0; i < count; i += 1) {
    const name = i === 7 ? 'calendar_create_event' : `util_${i}`;
    tools[name] = {
      description: i === 7 ? 'Create a calendar event with attendees' : `Utility number ${i}`,
      inputSchema: z.object({ title: z.string().optional() }),
      execute: async (input: unknown) => { calls.push(`${name}:${JSON.stringify(input)}`); return { ok: true, name }; },
    };
  }
  return { tools: async (): Promise<Record<string, unknown>> => tools, close: async (): Promise<void> => undefined } as never;
}

const run = (tool: unknown, input: unknown, id: string) => (tool as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: id, messages: [] });

describe('MCP progressive discovery', () => {
  it('below the threshold every tool is listed directly', async () => {
    const calls: string[] = [];
    const set = await connectMcpTools({ dataRoot: root, sessionId: 's-meta', permissionMode: 'full', createClient: async () => fakeClient(5, calls) });
    expect(Object.keys(set.tools).length).toBe(5);
  });

  it('with 100 tools the model sees two tools; search finds the right one and the call still needs approval', async () => {
    const calls: string[] = [];
    const set = await connectMcpTools({ dataRoot: root, sessionId: 's-meta', permissionMode: 'ask', createClient: async () => fakeClient(100, calls) });
    expect(100).toBeGreaterThan(MCP_META_THRESHOLD);
    expect(Object.keys(set.tools).sort()).toEqual(['mcp_call', 'mcp_search']);

    const found = (await run(set.tools.mcp_search, { query: 'calendar event' }, 'q1')) as { total: number; matches: Array<{ name: string }> };
    expect(found.total).toBe(100);
    const name = found.matches[0].name;
    expect(name).toContain('calendar_create_event');

    setPermissionSink('s-meta', () => undefined);
    await expect(run(set.tools.mcp_call, { name, input: { title: 'Standup' } }, 'c1')).rejects.toBeTruthy();
    expect(calls).toEqual([]); // held for approval, nothing ran
    answerPermission('c1', 'allow');
    const [item] = consumeInteractions('s-meta');
    expect(item.name).toBe(name); // the card is for the real tool, not the wrapper
    const out = await set.executeApproved(item.name, item.args, item.toolCallId);
    expect(out.error).toBeUndefined();
    expect(calls).toEqual([`calendar_create_event:{"title":"Standup"}`]);
  });

  it('an unknown name is explained instead of crashing', async () => {
    const set = await connectMcpTools({ dataRoot: root, sessionId: 's-meta', permissionMode: 'full', createClient: async () => fakeClient(60, []) });
    expect(await run(set.tools.mcp_call, { name: 'nope' }, 'c9')).toMatchObject({ error: expect.stringContaining('mcp_search') });
  });
});
