import { tool } from 'ai';
import { z } from 'zod';
import { READ_FILE_TOOL_MAX_BYTES } from '../../../shared/constants';
import type { PermissionMode } from '../../../shared/settings';
import type { AskQuestion, ChatStreamEvent, TodoItem } from '../../../shared/stream';
import { flattenWorkspace, listWorkspaceDir, readWorkspaceText } from '../../workspaceFs';
import { grepWorkspace } from '../../workspaceGrep';
import { readWorkspaceMemory, writeWorkspaceMemory } from '../../workspaceMemory';
import { editWorkspaceFile, previewDiff, writeWorkspaceFile } from '../../workspaceWrite';
import { runWorkspaceCommand } from '../../workspaceShell';
import { ApprovalRequiredError, registerPendingAsk, requestPermission } from './permissions';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

/**
 * Gate a side-effecting tool. Never blocks: if the user hasn't pre-approved
 * this tool, a pending `permission` interaction is recorded and this throws
 * `ApprovalRequiredError`, which unwinds the AI SDK step so `session.ts` can
 * suspend the turn (all provider timers cleared) until the answer arrives.
 */
async function approve(
  sessionId: string,
  name: string,
  input: unknown,
  mode: PermissionMode,
  options: { toolCallId: string },
): Promise<void> {
  const args = asRecord(input);
  const ok = await requestPermission({ sessionId, toolCallId: options.toolCallId, name, args, mode });
  if (!ok) {
    throw new ApprovalRequiredError({ toolCallId: options.toolCallId, name, args, kind: 'permission' });
  }
}

export interface WorkspaceToolset {
  tools: ReturnType<typeof buildTools>;
  /**
   * Run the post-approval body of a side-effecting tool during a resumed
   * pass, after the user granted it. Returns a JSON string result (matching
   * how the live path stringifies tool output) or an error string.
   */
  executeApproved(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result?: string; error?: string }>;
}

export function createWorkspaceTools(options: {
  sessionId: string;
  workspacePath: string;
  permissionMode: PermissionMode;
  emit: (event: ChatStreamEvent) => void;
  todos: TodoItem[];
  onFileWritten?: (relativePath: string, content: string) => Promise<void>;
}): WorkspaceToolset {
  const { workspacePath, onFileWritten } = options;

  async function executeApproved(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result?: string; error?: string }> {
    try {
      switch (name) {
        case 'run_command':
          return { result: JSON.stringify(await runWorkspaceCommand(workspacePath, String(args.command ?? ''))) };
        case 'write_file': {
          const path = String(args.path ?? '');
          const content = String(args.content ?? '');
          const result = await writeWorkspaceFile(workspacePath, path, content);
          if (onFileWritten) await onFileWritten(path, content);
          return { result: JSON.stringify({ ...result, diff: previewDiff('', content) }) };
        }
        case 'edit_file': {
          const result = await editWorkspaceFile(
            workspacePath,
            String(args.path ?? ''),
            String(args.oldString ?? ''),
            String(args.newString ?? ''),
            Boolean(args.replaceAll),
          );
          if (onFileWritten) await onFileWritten(result.path, result.after);
          return {
            result: JSON.stringify({
              path: result.path,
              replacements: result.replacements,
              diff: previewDiff(result.before, result.after),
            }),
          };
        }
        case 'memory_write':
          return { result: JSON.stringify(await writeWorkspaceMemory(workspacePath, String(args.content ?? ''))) };
        default:
          return { error: `Cannot resume unknown tool "${name}"` };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { tools: buildTools(options), executeApproved };
}

function buildTools(options: {
  sessionId: string;
  workspacePath: string;
  permissionMode: PermissionMode;
  emit: (event: ChatStreamEvent) => void;
  todos: TodoItem[];
  onFileWritten?: (relativePath: string, content: string) => Promise<void>;
}) {
  const { sessionId, workspacePath, permissionMode, emit, todos, onFileWritten } = options;

  return {
    list_dir: tool({
      description: 'List files and folders in the bound workspace. Path is relative to the workspace root.',
      inputSchema: z.object({
        path: z.string().optional().describe('Relative directory path. Empty string is the workspace root.'),
      }),
      execute: async ({ path: relativePath }) => {
        const entries = await listWorkspaceDir(workspacePath, relativePath ?? '');
        return { path: relativePath || '.', entries };
      },
    }),
    read_file: tool({
      description: 'Read a UTF-8 text file from the bound workspace. Path is relative to the workspace root.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path inside the workspace.'),
      }),
      execute: async ({ path: relativePath }) => {
        return readWorkspaceText(workspacePath, relativePath, READ_FILE_TOOL_MAX_BYTES);
      },
    }),
    find_files: tool({
      description: 'List workspace files and folders (flattened, depth-limited) matching a substring.',
      inputSchema: z.object({
        query: z.string().optional().describe('Case-insensitive substring to match against relative paths.'),
      }),
      execute: async ({ query }) => {
        const all = await flattenWorkspace(workspacePath);
        const q = (query ?? '').toLowerCase();
        const entries = q ? all.filter((e) => e.relativePath.toLowerCase().includes(q)) : all;
        return { entries: entries.slice(0, 80) };
      },
    }),
    write_file: tool({
      description: 'Create or overwrite a UTF-8 text file in the workspace. Creates parent folders as needed.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path inside the workspace.'),
        content: z.string().describe('Full file contents to write.'),
      }),
      execute: async (input, toolOptions) => {
        await approve(sessionId, 'write_file', input, permissionMode, toolOptions);
        const result = await writeWorkspaceFile(workspacePath, input.path, input.content);
        if (onFileWritten) await onFileWritten(input.path, input.content);
        return { ...result, diff: previewDiff('', input.content) };
      },
    }),
    edit_file: tool({
      description: 'Replace text in an existing workspace file. Fails if oldString is not found.',
      inputSchema: z.object({
        path: z.string(),
        oldString: z.string().describe('Exact text to find.'),
        newString: z.string().describe('Replacement text.'),
        replaceAll: z.boolean().optional(),
      }),
      execute: async (input, toolOptions) => {
        await approve(sessionId, 'edit_file', input, permissionMode, toolOptions);
        const result = await editWorkspaceFile(
          workspacePath,
          input.path,
          input.oldString,
          input.newString,
          input.replaceAll,
        );
        if (onFileWritten) await onFileWritten(input.path, result.after);
        return {
          path: result.path,
          replacements: result.replacements,
          diff: previewDiff(result.before, result.after),
        };
      },
    }),
    run_command: tool({
      description: 'Run a shell command with the workspace as cwd. Ask the user first. Do not use for interactive programs.',
      inputSchema: z.object({
        command: z.string().describe('Shell command to run.'),
      }),
      execute: async (input, toolOptions) => {
        await approve(sessionId, 'run_command', input, permissionMode, toolOptions);
        return runWorkspaceCommand(workspacePath, input.command);
      },
    }),
    grep: tool({
      description: 'Search workspace text files for a regex or substring. Returns path, line number, and matching line.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional().describe('Optional relative directory to limit the search.'),
      }),
      execute: async ({ pattern, path: relativeDir }) => grepWorkspace(workspacePath, pattern, relativeDir ?? ''),
    }),
    memory_read: tool({
      description: 'Read MEMORY.md in the workspace — durable notes the user wants you to remember.',
      inputSchema: z.object({}),
      execute: async () => ({ path: 'MEMORY.md', content: await readWorkspaceMemory(workspacePath) }),
    }),
    memory_write: tool({
      description: 'Overwrite MEMORY.md with durable notes. Keep it short and factual.',
      inputSchema: z.object({
        content: z.string(),
      }),
      execute: async (input, toolOptions) => {
        await approve(sessionId, 'write_file', { path: 'MEMORY.md', content: input.content }, permissionMode, toolOptions);
        return writeWorkspaceMemory(workspacePath, input.content);
      },
    }),
    ask_user: tool({
      description: 'Ask the user a structured question with optional choices. Use this instead of guessing preferences.',
      inputSchema: z.object({
        questions: z.array(
          z.object({
            id: z.string(),
            prompt: z.string(),
            options: z.array(z.string()).optional(),
            multi: z.boolean().optional(),
          }),
        ),
      }),
      // Never returns: it records the pending question and unwinds the step so
      // the turn suspends. The resumed pass supplies `{ answers }` as this
      // tool call's result. The annotation keeps the tool's output type real.
      execute: async ({ questions }, toolOptions): Promise<{ answers: Record<string, string> }> => {
        registerPendingAsk({
          sessionId,
          toolCallId: toolOptions.toolCallId,
          name: 'ask_user',
          questions: questions as AskQuestion[],
        });
        throw new ApprovalRequiredError({
          toolCallId: toolOptions.toolCallId,
          name: 'ask_user',
          args: { questions },
          kind: 'ask',
          questions: questions as AskQuestion[],
        });
      },
    }),
    todo_write: tool({
      description: 'Replace the in-progress task list shown above the composer. Keep 2-8 concrete steps.',
      inputSchema: z.object({
        items: z.array(
          z.object({
            id: z.string(),
            content: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed']),
          }),
        ),
      }),
      execute: async ({ items }) => {
        todos.splice(0, todos.length, ...items);
        emit({ type: 'todos', items: [...todos] });
        return { items: todos };
      },
    }),
  };
}
