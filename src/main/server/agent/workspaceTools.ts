import { tool } from 'ai';
import { staleMemoryNote } from '../../../shared/memoryAge';
import { z } from 'zod';
import { READ_FILE_TOOL_MAX_BYTES } from '../../../shared/constants';
import type { PermissionMode } from '../../../shared/settings';
import {
  buildFileDiffPreview,
  type AskQuestion,
  type ChatStreamEvent,
  type FileDiffPreview,
  type TodoItem,
} from '../../../shared/stream';
import { flattenWorkspace, listWorkspaceDir, readWorkspaceText } from '../../workspaceFs';
import { grepWorkspace } from '../../workspaceGrep';
import { readWorkspaceMemory } from '../../workspaceMemory';
import {
  deleteMemoryEntry,
  listMemoryManifest,
  memoryFileNameFor,
  normalizeMemoryType,
  readMemoryEntry,
  writeMemoryEntry,
} from '../../workspaceMemoryDir';
import {
  editWorkspaceFile,
  previewDiff,
  readWorkspaceFileSnapshot,
  type WorkspaceFileVersion,
  writeWorkspaceFile,
} from '../../workspaceWrite';
import { runWorkspaceCommand } from '../../workspaceShell';
import { listBackgroundShells, readBackgroundShell, startBackgroundShell, stopBackgroundShell } from '../../backgroundShells';
import { ApprovalRequiredError, registerPendingAsk, requestPermission } from './permissions';

/** Apply the same substitution `editWorkspaceFile` would, for a pre-write preview. */
function applyEdit(before: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (!oldString || !before.includes(oldString)) return before;
  return replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function approvedVersion(args: Record<string, unknown>): WorkspaceFileVersion {
  if (!(args.expectedHash === null || typeof args.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(args.expectedHash)) || typeof args.expectedPath !== 'string' || !args.expectedPath)
    throw new Error('审批缺少文件版本，请重新读取并重新审批；本次未写入');
  return { expectedHash: args.expectedHash as string | null, expectedPath: args.expectedPath };
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
  options: { toolCallId: string; preview?: FileDiffPreview },
): Promise<void> {
  const args = asRecord(input);
  const ok = await requestPermission({
    sessionId,
    toolCallId: options.toolCallId,
    name,
    args,
    mode,
    preview: options.preview,
  });
  if (!ok) {
    throw new ApprovalRequiredError({
      toolCallId: options.toolCallId,
      name,
      args,
      kind: 'permission',
      preview: options.preview,
    });
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
  /** Keep what a write replaced so it can be undone; returns the snapshot id shown on the tool card. */
  onSnapshot?: (snapshot: { path: string; existed: boolean; before: string; after: string }) => Promise<string | undefined>;
}): WorkspaceToolset {
  const { workspacePath, onFileWritten, emit, onSnapshot } = options;

  async function executeApproved(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result?: string; error?: string }> {
    try {
      switch (name) {
        case 'run_command':
          if (args.background === true) return { result: JSON.stringify({ started: true, ...startBackgroundShell({ sessionId: options.sessionId, cwd: workspacePath, command: String(args.command ?? '') }) }) };
          return { result: JSON.stringify(await runWorkspaceCommand(workspacePath, String(args.command ?? ''), { isolate: true })) };
        case 'write_file': {
          const path = String(args.path ?? '');
          const content = String(args.content ?? '');
          const version = approvedVersion(args);
          const result = await writeWorkspaceFile(workspacePath, path, content, version);
          if (onFileWritten) await onFileWritten(path, content);
          const { before, ...rest } = result;
          const snapshotId = await onSnapshot?.({ path: result.path, existed: version.expectedHash !== null, before, after: content }).catch((): undefined => undefined);
          return {
            result: JSON.stringify({
              ...rest,
              ...(snapshotId ? { snapshotId } : {}),
              diff: previewDiff(before, content),
              preview: buildFileDiffPreview(result.path, before, content),
            }),
          };
        }
        case 'edit_file': {
          const result = await editWorkspaceFile(
            workspacePath,
            String(args.path ?? ''),
            String(args.oldString ?? ''),
            String(args.newString ?? ''),
            Boolean(args.replaceAll),
            approvedVersion(args),
          );
          if (onFileWritten) await onFileWritten(result.path, result.after);
          const snapshotId = await onSnapshot?.({ path: result.path, existed: true, before: result.before, after: result.after }).catch((): undefined => undefined);
          return {
            result: JSON.stringify({
              ...(snapshotId ? { snapshotId } : {}),
              path: result.path,
              replacements: result.replacements,
              diff: previewDiff(result.before, result.after),
              preview: buildFileDiffPreview(result.path, result.before, result.after),
            }),
          };
        }
        case 'memory_write': {
          const entry = {
            name: String(args.name ?? ''),
            description: String(args.description ?? ''),
            type: normalizeMemoryType(args.type),
            body: String(args.body ?? ''),
          };
          const fileName = memoryFileNameFor(entry.name);
          const existing = await readMemoryEntry(workspacePath, fileName).catch((): null => null);
          const after = `name: ${entry.name}\ndescription: ${entry.description}\ntype: ${entry.type}\n\n${entry.body}`;
          const before = existing
            ? `name: ${existing.name}\ndescription: ${existing.description}\ntype: ${existing.type}\n\n${existing.body}`
            : '';
          const result = await writeMemoryEntry(workspacePath, entry);
          emit({
            type: 'memory',
            action: 'wrote',
            items: [
              {
                file: result.fileName,
                name: entry.name,
                description: entry.description,
                type: entry.type,
              },
            ],
          });
          return {
            result: JSON.stringify({
              path: result.path,
              preview: buildFileDiffPreview(`memory/${fileName}`, before, after),
            }),
          };
        }
        case 'memory_delete': {
          const fileName = String(args.file ?? '');
          await deleteMemoryEntry(workspacePath, fileName);
          return { result: JSON.stringify({ deleted: `memory/${fileName}` }) };
        }
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
  onSnapshot?: (snapshot: { path: string; existed: boolean; before: string; after: string }) => Promise<string | undefined>;
}) {
  const { sessionId, workspacePath, permissionMode, emit, todos, onFileWritten, onSnapshot } = options;

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
      description:
        'Read a UTF-8 text file from the bound workspace. Only works for text files (code, markdown, json, etc.). CANNOT read binary files (images, audio, video, zip). Do not call read_file on images — canvas/image outputs are already rendered to the user. Path is relative to the workspace root.',
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
        const snapshot = await readWorkspaceFileSnapshot(workspacePath, input.path);
        const version = { expectedHash: snapshot.expectedHash, expectedPath: snapshot.expectedPath };
        await approve(sessionId, 'write_file', { ...input, ...version }, permissionMode, {
          ...toolOptions,
          preview: { ...buildFileDiffPreview(input.path, snapshot.content, input.content), ...version },
        });
        const result = await writeWorkspaceFile(workspacePath, input.path, input.content, version);
        if (onFileWritten) await onFileWritten(input.path, input.content);
        const { before, ...rest } = result;
        const snapshotId = await onSnapshot?.({ path: result.path, existed: version.expectedHash !== null, before, after: input.content }).catch((): undefined => undefined);
        return {
          ...rest,
          ...(snapshotId ? { snapshotId } : {}),
          diff: previewDiff(before, input.content),
          preview: buildFileDiffPreview(result.path, before, input.content),
        };
      },
    }),
    edit_file: tool({
      description:
        'Replace text in an existing workspace file. Fails if oldString is not found or occurs multiple times (when replaceAll is false). Include surrounding lines to make oldString unique.',
      inputSchema: z.object({
        path: z.string(),
        oldString: z.string().describe('Exact text to find. Must be unique unless replaceAll is true.'),
        newString: z.string().describe('Replacement text.'),
        replaceAll: z.boolean().optional(),
      }),
      execute: async (input, toolOptions) => {
        const snapshot = await readWorkspaceFileSnapshot(workspacePath, input.path);
        const priorContent = snapshot.content;
        const version = { expectedHash: snapshot.expectedHash, expectedPath: snapshot.expectedPath };
        const count = input.oldString ? priorContent.split(input.oldString).length - 1 : 0;
        if (count === 0) throw new Error('oldString was not found in the file');
        if (count > 1 && !input.replaceAll) {
          throw new Error(
            `Found ${count} occurrences of oldString. oldString must uniquely match exactly one block of text, or set replaceAll to true. Include more surrounding lines in oldString to make it unique.`,
          );
        }
        await approve(sessionId, 'edit_file', { ...input, ...version }, permissionMode, {
          ...toolOptions,
          preview: { ...buildFileDiffPreview(
            input.path,
            priorContent,
            applyEdit(priorContent, input.oldString, input.newString, Boolean(input.replaceAll)),
          ), ...version },
        });
        const result = await editWorkspaceFile(
          workspacePath,
          input.path,
          input.oldString,
          input.newString,
          input.replaceAll,
          version,
        );
        if (onFileWritten) await onFileWritten(input.path, result.after);
        const snapshotId = await onSnapshot?.({ path: result.path, existed: true, before: result.before, after: result.after }).catch((): undefined => undefined);
        return {
          ...(snapshotId ? { snapshotId } : {}),
          path: result.path,
          replacements: result.replacements,
          diff: previewDiff(result.before, result.after),
          preview: buildFileDiffPreview(result.path, result.before, result.after),
        };
      },
    }),
    run_command: tool({
      description: 'Run a shell command with the workspace as cwd. Ask the user first. Do not use for interactive programs. Set background:true for a process that keeps running (a dev server, a watcher): it returns an id at once, then use read_background to see new output and stop_background to end it.',
      inputSchema: z.object({
        command: z.string().describe('Shell command to run.'),
        background: z.boolean().optional().describe('Start it and return immediately instead of waiting for it to finish.'),
      }),
      execute: async (input, toolOptions) => {
        await approve(sessionId, 'run_command', input, permissionMode, toolOptions);
        if (input.background === true) return { started: true, ...startBackgroundShell({ sessionId, cwd: workspacePath, command: input.command }) };
        return runWorkspaceCommand(workspacePath, input.command, { isolate: true });
      },
    }),
    read_background: tool({
      description: 'Read the output a background command has produced since your last read. Pass the id from run_command and the nextOffset you got last time (0 the first time).',
      inputSchema: z.object({
        id: z.string().describe('Background command id.'),
        since: z.number().int().min(0).optional().describe('Offset returned as nextOffset by the previous read.'),
      }),
      execute: async ({ id, since }) => readBackgroundShell(id, sessionId, since ?? 0) ?? { error: `No background command "${id}" in this conversation. Running: ${listBackgroundShells(sessionId).map((s) => s.id).join(', ') || 'none'}` },
    }),
    stop_background: tool({
      description: 'Stop a background command you started.',
      inputSchema: z.object({ id: z.string().describe('Background command id.') }),
      execute: async ({ id }) => (stopBackgroundShell(id, sessionId) ? { ok: true, id } : { error: `No background command "${id}" in this conversation` }),
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
      description:
        'Read durable memories about the user/workspace. Without `file`, returns the MEMORY.md index plus every memory entry (name, description, type). With `file`, returns that memory file\'s full content.',
      inputSchema: z.object({
        file: z.string().optional().describe('Memory file name inside memory/ (e.g. "brand-colors.md").'),
      }),
      execute: async ({ file }) => {
        if (file) {
          const entry = await readMemoryEntry(workspacePath, file);
          return entry
            ? { path: `memory/${file}`, ...entry, ...(staleMemoryNote(entry.updatedAt) ? { warning: staleMemoryNote(entry.updatedAt) } : {}) }
            : { error: `No memory file "${file}"` };
        }
        return {
          path: 'MEMORY.md',
          index: await readWorkspaceMemory(workspacePath),
          entries: await listMemoryManifest(workspacePath),
        };
      },
    }),
    memory_write: tool({
      description:
        'Save one durable memory as a file in memory/ and index it in MEMORY.md. Give it a short `name`, a one-line `description` (used for recall), a `type` (user preference / feedback / project fact / external reference), and the `body`. Writing the same `name` overwrites — update in place instead of duplicating. Only save what is NOT derivable from the workspace itself (no code structure, git history, file contents).',
      inputSchema: z.object({
        name: z.string().describe('Short kebab-case-friendly title, e.g. "prefers-minimal-ui".'),
        description: z.string().describe('One-line summary used to decide if this memory is relevant later.'),
        type: z.enum(['user', 'feedback', 'project', 'reference']),
        body: z.string().describe('The memory content. For type "feedback" include why and how to apply it.'),
      }),
      execute: async (input, toolOptions) => {
        const fileName = memoryFileNameFor(input.name);
        const existing = await readMemoryEntry(workspacePath, fileName).catch((): null => null);
        const after = `name: ${input.name}\ndescription: ${input.description}\ntype: ${input.type}\n\n${input.body}`;
        const before = existing
          ? `name: ${existing.name}\ndescription: ${existing.description}\ntype: ${existing.type}\n\n${existing.body}`
          : '';
        const relPath = `memory/${fileName}`;
        await approve(sessionId, 'write_file', { path: relPath, content: after }, permissionMode, {
          ...toolOptions,
          preview: buildFileDiffPreview(relPath, before, after),
        });
        const result = await writeMemoryEntry(workspacePath, {
          name: input.name,
          description: input.description,
          type: input.type,
          body: input.body,
        });
        emit({
          type: 'memory',
          action: 'wrote',
          items: [
            { file: result.fileName, name: input.name, description: input.description, type: input.type },
          ],
        });
        return { ...result, preview: buildFileDiffPreview(relPath, before, after) };
      },
    }),
    memory_delete: tool({
      description: 'Delete a memory file that is wrong or outdated, and refresh the MEMORY.md index.',
      inputSchema: z.object({
        file: z.string().describe('Memory file name inside memory/.'),
      }),
      execute: async ({ file }, toolOptions) => {
        const existing = await readMemoryEntry(workspacePath, file).catch((): null => null);
        if (!existing) return { error: `No memory file "${file}"` };
        await approve(sessionId, 'write_file', { path: `memory/${file}`, content: '' }, permissionMode, {
          ...toolOptions,
          preview: buildFileDiffPreview(`memory/${file}`, existing.body, ''),
        });
        await deleteMemoryEntry(workspacePath, file);
        emit({
          type: 'memory',
          action: 'deleted',
          items: [{ file, name: existing.name, description: existing.description, type: existing.type }],
        });
        return { deleted: `memory/${file}` };
      },
    }),
    ask_user: createAskUserTool(sessionId),
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

/**
 * ask_user is a chat-interaction tool, not a workspace tool — it must exist
 * even when no workspace is configured, so it is built standalone and also
 * included in the workspace toolset.
 */
export function createAskUserTool(sessionId: string) {
  return tool({
    description:
      'Ask the user a structured question with optional choices. Use this instead of guessing preferences. ' +
      'For a visual-direction choice (mood / palette / typography for something you are about to design or generate), ' +
      'set kind:"direction" and provide 2-4 `directions` cards — the user picks by looking. The answer is the chosen card id. ' +
      'When the options correspond to nodes already on the canvas (e.g. draft images you generated for the user to compare), ' +
      'set each card\'s `nodeId` to that node id so the card shows the real thumbnail instead of a text mockup. ' +
      'When you have a clear recommendation, set `recommended` on each question to the option value (or direction id) ' +
      'you would pick — if every question has one, an unanswered card auto-resolves to your recommendations after a ' +
      'short countdown, so low-risk asks never stall the pipeline.',
    inputSchema: z.object({
      questions: z.array(
        z.object({
          id: z.string(),
          prompt: z.string(),
          options: z.array(z.string()).optional(),
          multi: z.boolean().optional(),
          kind: z.enum(['choice', 'text', 'direction']).optional(),
          recommended: z
            .string()
            .optional()
            .describe('The option value / direction id / free-text answer you would pick. Enables countdown auto-resolve when every question has one.'),
          directions: z
            .array(
              z.object({
                id: z.string(),
                title: z.string(),
                palette: z.array(z.string()).optional(),
                displayFont: z.string().optional(),
                bodyFont: z.string().optional(),
                mood: z.string().optional(),
                references: z.array(z.string()).optional(),
                nodeId: z.string().optional().describe('Canvas node id to preview as this card\'s image.'),
                imageUrl: z
                  .string()
                  .optional()
                  .describe('Preset sample image URL, or skill-asset:<skillId>/<file> for an image bundled in a skill directory.'),
              }),
            )
            .optional(),
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
  });
}
