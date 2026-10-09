import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalRequiredError, clearPermissionSink } from './permissions';
import { createWorkspaceTools } from './workspaceTools';

describe('approved workspace versions', () => {
  it('freezes full-file version on write/edit previews and refuses external changes after approval', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reizo-approved-version-'));
    const sessionId = 'version-fixture';
    try {
      const tools = createWorkspaceTools({ sessionId, workspacePath: root, permissionMode: 'ask', emit: () => undefined, todos: [] });
      for (const name of ['write_file', 'edit_file'] as const) {
        await writeFile(path.join(root, 'target.txt'), 'hello world');
        const args = name === 'write_file' ? { path: 'target.txt', content: 'proposed overwrite' } : { path: 'target.txt', oldString: 'hello', newString: 'proposed' };
        const execute = tools.tools[name].execute as unknown as (args: Record<string, string>, options: { toolCallId: string }) => Promise<unknown>;
        let required: ApprovalRequiredError | undefined;
        try { await execute(args, { toolCallId: name }); } catch (error) { if (error instanceof ApprovalRequiredError) required = error; else throw error; }
        expect(required).toBeInstanceOf(ApprovalRequiredError);
        expect(required.interaction.preview?.expectedHash).toMatch(/^[a-f0-9]{64}$/);
        expect(required.interaction.args.expectedHash).toBe(required.interaction.preview?.expectedHash);
        await writeFile(path.join(root, 'target.txt'), 'external editor update');
        const result = await tools.executeApproved(name, required.interaction.args);
        expect(result.error).toContain('审批后发生变化');
        expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('external editor update');
      }
    } finally {
      clearPermissionSink(sessionId);
      if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('reizo-approved-version-')) await rm(root, { recursive: true, force: true });
    }
  });
});
