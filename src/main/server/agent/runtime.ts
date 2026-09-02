import { isStepCount, streamText, type ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { getProviderPreset } from '../../../shared/providers';
import type { ChatStreamEvent, TodoItem } from '../../../shared/stream';
import { createOpenAiModel } from './provider/openai';
import { createWorkspaceTools } from './workspaceTools';
import { createCanvasTools } from './canvasTools';
import { getCanvasSelection } from '../canvas/selection';
import type { CanvasStore } from '../storage/canvasStore';
import type { CanvasImageParams } from '../../../shared/canvas';
import { startAgentTurn } from './session';
import { consumeInteractions, waitForInteractions } from './permissions';
import { translateOpenAiChunk } from './translators/openai';
import { compactAssistantParts, compactModelMessages } from './modelHistory';
import { CONTINUE_USER_MESSAGE, MAX_CONTINUE_PASSES, shouldContinueAgentPass } from './continuePass';
import { readWorkspaceMemory } from '../../workspaceMemory';
import type { Skill } from '../../skills';
import type { ChatMessage, SessionStore, ToolCallPart } from '../../../shared/chat';
import type { SettingsStore } from '../storage/settingsStore';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ProjectStore } from '../storage/projectStore';
import type { LargeValueStore } from '../storage/largeValueStore';

/**
 * Reverse proxies (Cloudflare 524, nginx read timeouts) often fail one
 * Responses API pass after a long wait. A couple of retries recover that
 * pass without re-running tools the user already approved. 0 turned those
 * into a dead `openai_error` with no second chance.
 */
const PROVIDER_MAX_RETRIES = 2;
/**
 * These now only ever cover *real generation* plus bounded autonomous tools
 * (read_file, inspect-only git, post-approval tool bodies — the shell path
 * self-limits at 30s). Human approval time is never inside a step: an
 * approval-needing tool unwinds the step immediately and the turn suspends
 * between passes with every one of these timers cleared.
 */
const PROVIDER_TIMEOUT = {
  firstChunkMs: 3 * 60_000,
  chunkMs: 60_000,
  stepMs: 5 * 60_000,
} as const;

export { abortChatTurn } from './session';

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
  artifactStore?: ArtifactStore;
  projectStore?: ProjectStore;
  truncateAfterId?: string;
  regenerate?: boolean;
  largeValueStore?: LargeValueStore;
  canvasStore?: CanvasStore;
  dataRoot?: string;
}): Promise<Response> {
  const {
    sessionStore,
    settingsStore,
    sessionId,
    userText,
    mentions = [],
    skill,
    attachments = [],
    artifactStore,
    projectStore,
    truncateAfterId,
    regenerate = false,
    largeValueStore,
    canvasStore,
    dataRoot,
  } = options;

  let session = await sessionStore.get(sessionId);
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

  if (truncateAfterId) {
    const idx = session.messages.findIndex((m) => m.id === truncateAfterId);
    if (idx < 0) {
      return Response.json({ error: 'truncateAfterId not found' }, { status: 400 });
    }
    session = await sessionStore.setMessages(sessionId, session.messages.slice(0, idx));
  }

  const canvasRefIds = mentions.filter((m) => m.startsWith('canvas:')).map((m) => m.slice('canvas:'.length));
  const pathMentions = mentions.filter((m) => !m.startsWith('canvas:'));

  let canvasRefBlock = '';
  if (canvasRefIds.length > 0 && canvasStore) {
    const canvas = canvasStore.findCanvasBySession(sessionId);
    const lines: string[] = [];
    for (const nodeId of canvasRefIds) {
      const node = canvas ? canvasStore.getNode(canvas.id, nodeId) : null;
      if (!node) continue;
      const p = node.params as { prompt?: string; instruction?: string; size?: string };
      lines.push(
        `- ${node.id} [${node.type}, ${node.runState}] ${node.title || ''} ${p.prompt ? `prompt: "${p.prompt.slice(0, 120)}"` : p.instruction ? `task: "${p.instruction.slice(0, 120)}"` : ''}`.trim(),
      );
    }
    if (lines.length > 0) canvasRefBlock = `Referenced canvas nodes:\n${lines.join('\n')}`;
  }

  const extraBlocks = [
    pathMentions.length > 0 ? `Referenced workspace paths:\n${pathMentions.map((m) => `- ${m}`).join('\n')}` : '',
    canvasRefBlock,
    attachments.length > 0
      ? attachments.map((file) => `Attached file ${file.name}:\n\`\`\`\n${file.content.slice(0, 20_000)}\n\`\`\``).join('\n\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  let userMessage: ChatMessage | null = null;
  if (regenerate) {
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return Response.json({ error: 'No user message to regenerate' }, { status: 400 });
    }
    userMessage = lastUser;
  } else {
    userMessage = {
      id: nanoid(),
      role: 'user',
      content: extraBlocks ? `${userText}\n\n${extraBlocks}` : userText,
      createdAt: new Date().toISOString(),
    };
    await sessionStore.appendMessage(sessionId, userMessage);
    session = { ...session, messages: [...session.messages, userMessage] };
  }

  if (!regenerate && artifactStore && attachments.length > 0) {
    await Promise.all(
      attachments.map((file) =>
        artifactStore.create({
          sessionId,
          projectId: session.projectId,
          name: file.name,
          content: file.content,
          source: 'attachment',
        }),
      ),
    );
  }

  if (!regenerate && (session.title === 'New chat' || session.title === '新对话') && userText.trim()) {
    const title = userText.trim().replace(/\s+/g, ' ').slice(0, 60);
    await sessionStore.rename(sessionId, title);
  }

  const workspacePath = settings.workspacePath;
  const memory = workspacePath ? await readWorkspaceMemory(workspacePath) : '';
  let projectInstructions = '';
  let projectName = '';
  if (projectStore && session.projectId) {
    const project = await projectStore.get(session.projectId);
    if (project?.instructions) {
      projectInstructions = project.instructions;
      projectName = project.name;
    }
  }
  // Compact canvas summary (decision 9). Frozen at turn start — use the
  // read_canvas / read_node tools for anything the agent changes mid-turn.
  let canvasSummary = '';
  if (canvasStore) {
    const existing = canvasStore.findCanvasBySession(sessionId);
    const snapshot = existing ? canvasStore.getSnapshot(existing.id) : null;
    if (snapshot && snapshot.nodes.length > 0) {
      const selected = new Set(existing ? getCanvasSelection(existing.id) : []);
      const lines = snapshot.nodes.map((node) => {
        const label =
          node.type === 'image'
            ? `image "${((node.params as CanvasImageParams).prompt ?? '').slice(0, 60)}"`
            : `agent task`;
        const mark = selected.has(node.id) ? ' (selected)' : '';
        return `- ${node.id} [${node.type}, ${node.runState}] ${node.title || label}${mark}`;
      });
      const selNote = selected.size > 0 ? `\nThe user has ${selected.size} node(s) selected (marked "(selected)").` : '';
      canvasSummary = `The session canvas has ${snapshot.nodes.length} node(s):\n${lines.join('\n')}${selNote}`;
    }
  }

  const systemParts = [
    workspacePath
      ? `You are Reizo Studio, a local desktop agent that finishes real work in the user's files. The workspace is at: ${workspacePath}. Prefer tools over guessing. Use list_dir/read_file/find_files/grep to inspect, edit_file/write_file to change files, run_command for tests and git, ask_user when you need a choice, todo_write for a visible plan, and memory_read/memory_write for durable notes in MEMORY.md.`
      : 'You are Reizo Studio, a helpful creative assistant running locally on the user\'s desktop. Use ask_user if you need the user to choose.',
    canvasStore
      ? 'When the user wants to generate or iterate on images, use the canvas: add_node (type "image") to place a node, then run_node to generate. add_node (type "agent") places a read-only research/critique node — wire it downstream of other nodes and run_node to have it comment on their outputs. The canvas panel opens automatically.'
      : '',
    canvasSummary,
    memory ? `Workspace MEMORY.md:\n${memory}` : '',
    skill ? `The user invoked skill "${skill.name}". Follow this skill:\n${skill.body}` : '',
    projectInstructions ? `Project "${projectName}" working rules:\n${projectInstructions}` : '',
  ].filter(Boolean);
  const instructions = systemParts.join('\n\n');

  // `ai` v7 rejects a `system`-role entry in `messages`; the system prompt
  // goes to `instructions`. Preserve completed tool pairs so each new turn
  // knows what was already inspected and does not repeat the same search.
  const history: ModelMessage[] = [];
  for (const message of session.messages) {
    if (message.role === 'user') {
      history.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role !== 'assistant') continue;
    const parts = message.parts ?? [];
    if (parts.length === 0) {
      history.push({ role: 'assistant', content: message.content });
      continue;
    }
    history.push(...assistantTurnToModelMessages(message.content, compactAssistantParts(parts)));
  }

  // `emit` is bound to the live stream once `startAgentTurn` opens it; tools
  // created here need the reference up front (todos / permission side-channel).
  let emit: (event: ChatStreamEvent) => void = () => undefined;
  const todos: TodoItem[] = [];

  const toolset = workspacePath
    ? createWorkspaceTools({
        sessionId,
        workspacePath,
        permissionMode: settings.permissionMode,
        emit: (event) => emit(event),
        todos,
        onFileWritten: artifactStore
          ? async (relativePath, content) => {
              // Same file rewritten in a later turn → append a version tagged
              // with the prompt that caused it, not a fresh row.
              await artifactStore.createOrAddVersion({
                sessionId,
                projectId: session.projectId,
                name: relativePath.split(/[/\\]/).pop() || relativePath,
                content,
                source: 'generated',
                origin: { surface: 'chat', prompt: userText.slice(0, 400) },
              });
            }
          : undefined,
      })
    : undefined;

  const canvasTools =
    canvasStore && dataRoot
      ? createCanvasTools({ sessionId, canvasStore, settingsStore, dataRoot })
      : undefined;

  const tools =
    toolset?.tools || canvasTools
      ? { ...(toolset?.tools ?? {}), ...(canvasTools ?? {}) }
      : undefined;

  const model = createOpenAiModel({ apiKey, modelId, baseUrl });

  const buildStream = (messages: ModelMessage[], signal: AbortSignal) =>
    streamText({
      model,
      instructions,
      messages: compactModelMessages(messages),
      tools,
      stopWhen: tools ? isStepCount(64) : undefined,
      maxRetries: PROVIDER_MAX_RETRIES,
      timeout: PROVIDER_TIMEOUT,
      abortSignal: signal,
      prepareStep: ({ messages: stepMessages }) => ({
        messages: compactModelMessages(stepMessages as ModelMessage[]),
      }),
    });

  return startAgentTurn({
    sessionStore,
    sessionId,
    translate: translateOpenAiChunk,
    largeValues: largeValueStore,
    onReady: (send) => {
      emit = send;
    },
    createStream: (signal) => buildStream(history, signal),
    onAwaitingInteraction: async ({ sessionId: sid, signal, emitToolResult, getAssistant }) => {
      // Suspended: no provider connection is open. Wait for every pending
      // permission / question, run whatever was approved, then resume with a
      // fresh provider pass whose history already has the tool results.
      await waitForInteractions(sid, signal);
      if (signal.aborted) return null;
      for (const item of consumeInteractions(sid)) {
        if (item.kind === 'ask') {
          emitToolResult({
            toolCallId: item.toolCallId,
            name: item.name,
            args: item.args,
            result: JSON.stringify({ answers: item.answers ?? {} }),
          });
          continue;
        }
        if (item.decision === 'deny') {
          emitToolResult({
            toolCallId: item.toolCallId,
            name: item.name,
            args: item.args,
            error: 'User denied this tool call',
          });
          continue;
        }
        const outcome = (await toolset?.executeApproved(item.name, item.args)) ?? {
          error: 'This turn has no workspace tools',
        };
        emitToolResult({
          toolCallId: item.toolCallId,
          name: item.name,
          args: item.args,
          result: outcome.result,
          error: outcome.error,
        });
      }
      if (signal.aborted) return null;
      const snap = getAssistant();
      return buildStream(
        [...history, ...assistantTurnToModelMessages(snap.text, compactAssistantParts(snap.parts))],
        signal,
      );
    },
    onContinuePass: async ({ getAssistant, finishReason, passIndex, signal }) => {
      if (passIndex >= MAX_CONTINUE_PASSES) return null;
      const snap = getAssistant();
      const reason = shouldContinueAgentPass({ text: snap.text, todos, finishReason });
      if (!reason) return null;
      console.info(`[chat] continue pass reason=${reason} pass=${passIndex + 1}`);
      return buildStream(
        [
          ...history,
          ...assistantTurnToModelMessages(snap.text, compactAssistantParts(snap.parts)),
          { role: 'user', content: CONTINUE_USER_MESSAGE },
        ],
        signal,
      );
    },
  });
}

/**
 * One assistant turn (text + tool calls) as the `[assistant, tool]` message
 * pair the model needs to see completed tool work on the next pass.
 */
function assistantTurnToModelMessages(text: string, parts: ToolCallPart[]): ModelMessage[] {
  const assistantContent: Array<Record<string, unknown>> = [];
  if (text) assistantContent.push({ type: 'text', text });
  for (const part of parts) {
    assistantContent.push({
      type: 'tool-call',
      toolCallId: part.id,
      toolName: part.name,
      input: part.args,
    });
  }
  return [
    { role: 'assistant', content: assistantContent } as ModelMessage,
    {
      role: 'tool',
      content: parts.map((part) => ({
        type: 'tool-result',
        toolCallId: part.id,
        toolName: part.name,
        output: parseToolOutput(part.result ?? part.error ?? ''),
      })),
    } as ModelMessage,
  ];
}

function parseToolOutput(value: string): { type: 'json'; value: unknown } | { type: 'text'; value: string } {
  try {
    return { type: 'json', value: JSON.parse(value) };
  } catch {
    return { type: 'text', value };
  }
}
