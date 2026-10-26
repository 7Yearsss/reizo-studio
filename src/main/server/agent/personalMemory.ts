import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { PermissionMode } from '../../../shared/settings';
import type { ChatStreamEvent } from '../../../shared/stream';
import { staleMemoryNote } from '../../../shared/memoryAge';
import { deleteMemoryEntry, listMemoryManifest, memoryFileNameFor, readMemoryEntry, writeMemoryEntry } from '../../workspaceMemoryDir';
import { ApprovalRequiredError, requestPermission } from './permissions';

/** Personal memory lives beside the app data, not in any workspace, so it follows the user everywhere. */
export function personalMemoryRoot(dataRoot: string): string {
  return path.join(dataRoot, 'personal-memory');
}

export const PERSONAL_MEMORY_TOOLS = ['personal_memory_read', 'personal_memory_write', 'personal_memory_delete'] as const;

const PRIVATE_REMINDER = '这是用户标记为私密的记忆：只在回答当前问题确实需要时使用，不要复述给无关的人，也不要写进文件或发给外部工具。';

export function createPersonalMemoryTools(options: {
  sessionId: string;
  dataRoot: string;
  permissionMode: PermissionMode;
  emit: (event: ChatStreamEvent) => void;
}) {
  const root = personalMemoryRoot(options.dataRoot);

  async function write(input: { name: string; description: string; type: 'user' | 'feedback' | 'project' | 'reference'; body: string; private?: boolean }) {
    const result = await writeMemoryEntry(root, input);
    options.emit({ type: 'memory', action: 'wrote', items: [{ file: result.fileName, name: input.name, description: input.description, type: input.type }] });
    return { ...result, scope: 'personal', private: input.private === true };
  }

  async function remove(file: string) {
    await deleteMemoryEntry(root, file);
    return { ok: true, file };
  }

  async function gate(name: string, args: Record<string, unknown>, toolCallId: string) {
    const allowed = await requestPermission({ sessionId: options.sessionId, toolCallId, name, args, mode: options.permissionMode });
    if (!allowed) throw new ApprovalRequiredError({ toolCallId, name, args, kind: 'permission' });
  }

  const tools = {
    personal_memory_read: tool({
      description:
        'Read the user\'s PERSONAL memory (it follows them across every workspace; use it for lasting preferences, how they like to work, facts about them). With no `file`, returns the index and the list of entries (private ones are listed by name only).',
      inputSchema: z.object({ file: z.string().optional().describe('Entry file name, e.g. "prefers-short-answers.md".') }),
      execute: async ({ file }) => {
        if (file) {
          const entry = await readMemoryEntry(root, file);
          if (!entry) return { error: `No personal memory "${file}"` };
          const stale = staleMemoryNote(entry.updatedAt);
          return { ...entry, ...(entry.private ? { reminder: PRIVATE_REMINDER } : {}), ...(stale ? { warning: stale } : {}) };
        }
        return { entries: (await listMemoryManifest(root)).map((m) => ({ ...m })) };
      },
    }),
    personal_memory_write: tool({
      description:
        'Save one durable fact about the USER (not about a project) to personal memory, so it applies in every workspace and with no workspace open: tone and language preferences, role, recurring formats, constraints. Same `name` overwrites. Set `private: true` for sensitive facts — private entries are never injected or recalled automatically. Do not save anything derivable from files, and never save secrets.',
      inputSchema: z.object({
        name: z.string().describe('Short title, e.g. "prefers-formal-email-tone".'),
        description: z.string().describe('One-line summary used to decide if this memory is relevant later.'),
        type: z.enum(['user', 'feedback', 'project', 'reference']),
        body: z.string(),
        private: z.boolean().optional().describe('Sensitive: only read on request, never auto-injected.'),
      }),
      execute: async (input, toolOptions) => {
        await gate('personal_memory_write', input, toolOptions.toolCallId);
        return write(input);
      },
    }),
    personal_memory_delete: tool({
      description: 'Delete a personal memory that is wrong or outdated.',
      inputSchema: z.object({ file: z.string().describe('Entry file name.') }),
      execute: async ({ file }, toolOptions) => {
        await gate('personal_memory_delete', { file }, toolOptions.toolCallId);
        return remove(file);
      },
    }),
  };

  return {
    tools,
    /** Run a write/delete the user just approved on its card. */
    async executeApproved(name: string, args: Record<string, unknown>): Promise<{ result?: string; error?: string }> {
      try {
        if (name === 'personal_memory_write') return { result: JSON.stringify(await write(args as Parameters<typeof write>[0])) };
        if (name === 'personal_memory_delete') return { result: JSON.stringify(await remove(String(args.file))) };
        return { error: `Unknown tool ${name}` };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    fileNameFor: memoryFileNameFor,
  };
}
