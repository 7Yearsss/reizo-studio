import { isStepCount, streamText, type ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { getProviderPreset } from '../../../shared/providers';
import { encodeStreamEvent, type ChatStreamEvent, type TodoItem } from '../../../shared/stream';
import { createOpenAiModel } from './provider/openai';
import { createWorkspaceTools } from './workspaceTools';
import { clearPermissionSink, setPermissionSink } from './permissions';
import { readWorkspaceMemory } from '../../workspaceMemory';
import type { Skill } from '../../skills';
import type { ChatMessage, SessionStore, ToolCallPart } from '../storage/ports';
import type { SettingsStore } from '../storage/settingsStore';

const abortBySession = new Map<string, AbortController>();

export function abortChatTurn(sessionId: string): boolean {
  const current = abortBySession.get(sessionId);
  if (!current) return false;
  current.abort();
  return true;
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

export async function runChatTurn(options: {
  sessionStore: SessionStore;
  settingsStore: SettingsStore;
  sessionId: string;
  userText: string;
  providerId?: string;
  model?: string;
  mentions?: string[];
  skill?: Skill | null;
  attachments?: { name: string; content: string }[];
}): Promise<Response> {
  const { sessionStore, settingsStore, sessionId, userText, mentions = [], skill, attachments = [] } = options;

  const session = await sessionStore.get(sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const settings = await settingsStore.get();
  const providerId = options.providerId || settings.activeProviderId;
  const preset = getProviderPreset(providerId);
  if (!preset) {
    return Response.json({ error: 'Unknown provider' }, { status: 400 });
  }

  const stored = settings.providers[providerId];
  const apiKey = stored?.apiKey;
  if (!apiKey) {
    return Response.json(
      { error: `No API key configured for ${preset.name}. Add one in Settings.` },
      { status: 400 },
    );
  }

  const modelId = options.model || stored.model || preset.defaultModel;
  const baseUrl = stored.baseUrl || preset.baseUrl;
  if (!baseUrl || !modelId) {
    return Response.json({ error: 'Provider is missing a base URL or model id.' }, { status: 400 });
  }

  const extraBlocks = [
    mentions.length > 0 ? `Referenced workspace paths:\n${mentions.map((m) => `- ${m}`).join('\n')}` : '',
    attachments.length > 0
      ? attachments.map((file) => `Attached file ${file.name}:\n\`\`\`\n${file.content.slice(0, 20_000)}\n\`\`\``).join('\n\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const userMessage: ChatMessage = {
    id: nanoid(),
    role: 'user',
    content: extraBlocks ? `${userText}\n\n${extraBlocks}` : userText,
    createdAt: new Date().toISOString(),
  };
  await sessionStore.appendMessage(sessionId, userMessage);

  if ((session.title === 'New chat' || session.title === '新对话') && userText.trim()) {
    const title = userText.trim().replace(/\s+/g, ' ').slice(0, 60);
    await sessionStore.rename(sessionId, title);
  }

  const workspacePath = settings.workspacePath;
  const memory = workspacePath ? await readWorkspaceMemory(workspacePath) : '';
  const systemParts = [
    workspacePath
      ? `You are Reizo Studio, a local desktop agent that finishes real work in the user's files. The workspace is at: ${workspacePath}. Prefer tools over guessing. Use list_dir/read_file/find_files/grep to inspect, edit_file/write_file to change files, run_command for tests and git, ask_user when you need a choice, todo_write for a visible plan, and memory_read/memory_write for durable notes in MEMORY.md.`
      : 'You are Reizo Studio, a helpful creative assistant running locally on the user\'s desktop. Use ask_user if you need the user to choose.',
    memory ? `Workspace MEMORY.md:\n${memory}` : '',
    skill ? `The user invoked skill "${skill.name}". Follow this skill:\n${skill.body}` : '',
  ].filter(Boolean);

  const history: ModelMessage[] = [
    { role: 'system', content: systemParts.join('\n\n') },
    ...session.messages.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    { role: 'user', content: userMessage.content },
  ];

  const previous = abortBySession.get(sessionId);
  previous?.abort();
  const abortController = new AbortController();
  abortBySession.set(sessionId, abortController);

  const encoder = new TextEncoder();
  const parts: ToolCallPart[] = [];
  const todos: TodoItem[] = [];
  let text = '';
  let aborted = false;
  let emit: (event: ChatStreamEvent) => void = () => undefined;

  const tools = workspacePath
    ? createWorkspaceTools({
        sessionId,
        workspacePath,
        permissionMode: settings.permissionMode,
        emit: (event) => emit(event),
        todos,
      })
    : undefined;

  const result = streamText({
    model: createOpenAiModel({ apiKey, modelId, baseUrl }),
    messages: history,
    tools,
    stopWhen: tools ? isStepCount(12) : undefined,
    abortSignal: abortController.signal,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(encodeStreamEvent(event)));
      };
      emit = send;
      setPermissionSink(sessionId, send);

      try {
        for await (const chunk of result.fullStream) {
          if (abortController.signal.aborted) {
            aborted = true;
            break;
          }
          if (chunk.type === 'text-delta') {
            text += chunk.text;
            send({ type: 'text', delta: chunk.text });
          } else if (chunk.type === 'tool-call') {
            const existing = parts.find((p) => p.id === chunk.toolCallId);
            if (existing) {
              existing.name = chunk.toolName;
              existing.args = asRecord(chunk.input);
            } else {
              parts.push({
                type: 'tool',
                id: chunk.toolCallId,
                name: chunk.toolName,
                args: asRecord(chunk.input),
              });
            }
          } else if (chunk.type === 'tool-result') {
            let part = parts.find((p) => p.id === chunk.toolCallId);
            if (!part) {
              part = {
                type: 'tool',
                id: chunk.toolCallId,
                name: chunk.toolName,
                args: asRecord(chunk.input),
              };
              parts.push(part);
            }
            part.result = stringifyToolOutput(chunk.output);
            send({
              type: 'tool',
              id: part.id,
              name: part.name,
              args: part.args,
              result: part.result,
            });
          } else if (chunk.type === 'tool-error') {
            let part = parts.find((p) => p.id === chunk.toolCallId);
            if (!part) {
              part = {
                type: 'tool',
                id: chunk.toolCallId,
                name: chunk.toolName,
                args: asRecord(chunk.input),
              };
              parts.push(part);
            }
            part.error = stringifyToolOutput(chunk.error);
            send({
              type: 'tool',
              id: part.id,
              name: part.name,
              args: part.args,
              error: part.error,
            });
          } else if (chunk.type === 'abort') {
            aborted = true;
            break;
          } else if (chunk.type === 'error') {
            send({ type: 'error', error: stringifyToolOutput(chunk.error) });
          }
        }

        if (!aborted && !abortController.signal.aborted && (text || parts.length)) {
          await sessionStore.appendMessage(sessionId, {
            id: nanoid(),
            role: 'assistant',
            content: text,
            parts: parts.length ? parts : undefined,
            createdAt: new Date().toISOString(),
          });
        }

        send({ type: 'done', aborted: aborted || abortController.signal.aborted });
        controller.close();
      } catch (err) {
        if (abortController.signal.aborted) {
          send({ type: 'done', aborted: true });
          controller.close();
          return;
        }
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        send({ type: 'done' });
        controller.close();
      } finally {
        clearPermissionSink(sessionId);
        if (abortBySession.get(sessionId) === abortController) {
          abortBySession.delete(sessionId);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
