import { isStepCount, streamText, type ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { getProviderPreset } from '../../../shared/providers';
import type { ChatStreamEvent, TodoItem } from '../../../shared/stream';
import { createOpenAiModel } from './provider/openai';
import { createAskUserTool, createWorkspaceTools } from './workspaceTools';
import { createCanvasTools } from './canvasTools';
import { createArtifactTools } from './artifactTools';
import { createImageTools } from './imageTools';
import { createComputerTools, isComputerUseSupported } from './computerTools';
import { COMPUTER_TOOL_NAME, SCREENSHOT_RETENTION } from '../../../shared/computerUse';
import { readScreenshotSync, screenshotContentOutput } from '../../computerUse/store';
import { getCanvasSelection } from '../canvas/selection';
import type { CanvasStore } from '../storage/canvasStore';
import type { CanvasImageParams } from '../../../shared/canvas';
import { startAgentTurn, abortChatTurn } from './session';
import { createToolLoopGuard } from './toolLoopGuard';
import { consumeInteractions, waitForInteractions } from './permissions';
import { translateOpenAiChunk } from './translators/openai';
import { compactAssistantParts, compactModelMessages } from './modelHistory';
import { CONTINUE_USER_MESSAGE, MAX_CONTINUE_PASSES, shouldContinueAgentPass } from './continuePass';
import { readWorkspaceMemory } from '../../workspaceMemory';
import { redactSecrets } from '../../../shared/redactSecrets';
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

export { abortChatTurn };

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

  const canvasRefs = mentions
    .filter((m) => m.startsWith('canvas:'))
    .map((m) => {
      const raw = m.slice('canvas:'.length);
      const [id, regionStr] = raw.split('@r=');
      const region = regionStr?.split(',').map(Number);
      return {
        id,
        region:
          region && region.length === 4 && region.every((v) => Number.isFinite(v))
            ? { x: region[0], y: region[1], w: region[2], h: region[3] }
            : undefined,
      };
    });
  const pathMentions = mentions.filter((m) => !m.startsWith('canvas:'));

  let canvasRefBlock = '';
  if (canvasRefs.length > 0 && canvasStore) {
    const canvas = canvasStore.findCanvasBySession(sessionId);
    const lines: string[] = [];
    let hasRegion = false;
    for (const ref of canvasRefs) {
      const node = canvas ? canvasStore.getNode(canvas.id, ref.id) : null;
      if (!node) continue;
      const p = node.params as { prompt?: string; instruction?: string; size?: string };
      let line =
        `- ${node.id} [${node.type}, ${node.runState}] ${node.title || ''} ${p.prompt ? `prompt: "${p.prompt.slice(0, 120)}"` : p.instruction ? `task: "${p.instruction.slice(0, 120)}"` : ''}`.trim();
      if (ref.region) {
        hasRegion = true;
        const r = ref.region;
        line += ` — user marked region: x ${(r.x * 100).toFixed(0)}%–${((r.x + r.w) * 100).toFixed(0)}%, y ${(r.y * 100).toFixed(0)}%–${((r.y + r.h) * 100).toFixed(0)}%`;
      }
      lines.push(line);
    }
    if (lines.length > 0) {
      canvasRefBlock =
        `Referenced canvas nodes:\n${lines.join('\n')}` +
        (hasRegion
          ? '\n(Marked regions are normalized rects the user drew on that node\'s image — they are pointing at that specific area, so treat it as the subject of the message.)'
          : '');
    }
  }

  const extraBlocks = [
    pathMentions.length > 0 ? `Referenced workspace paths:\n${pathMentions.map((m) => `- ${m}`).join('\n')}` : '',
    canvasRefBlock,
    attachments.length > 0
      ? attachments
          .map(
            (file) =>
              `Attached file ${file.name}:\n\`\`\`\n${redactSecrets(file.content.slice(0, 20_000))}\n\`\`\``,
          )
          .join('\n\n')
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

  const computerEnabled =
    Boolean(dataRoot) && settings.computerUse === true && isComputerUseSupported();

  const systemParts = [
    workspacePath
      ? `You are Reizo Studio, a local desktop agent that finishes real work in the user's files. The workspace is at: ${workspacePath}. Prefer tools over guessing. Use list_dir/read_file/find_files/grep to inspect, edit_file/write_file to change files, run_command for tests and git, ask_user when you need a choice, todo_write for a visible plan, and memory_read/memory_write for durable notes in MEMORY.md.`
      : 'You are Reizo Studio, a helpful creative assistant running locally on the user\'s desktop. Use ask_user if you need the user to choose.',
    'Image Generation Rules:\n' +
    '- When the user asks to generate, draw, or paint an image (e.g., "生图", "画一张...", "生成图片", "设计海报", "绘制插画"), ALWAYS call the `generate_image` tool directly within this chat conversation. The image will be generated and rendered inline for the user.\n' +
    '- The `generate_image` tool automatically uses the configured provider (such as Reizo key with gpt-image-2). Never refuse or tell the user that OpenAI API Key is missing. Just invoke `generate_image` directly.\n' +
    '- DO NOT touch the canvas or call `add_node(type: "image")` or `open_canvas` for standard image generation requests. Standard image generation belongs 100% in this chat conversation.\n' +
    '- Canvas Rules: The canvas is for complex multi-step node graphs and workflows. Only call canvas tools (`add_node`, `run_node`, `open_canvas`, etc.) when the user explicitly asks to build or edit a canvas node workflow, wire nodes, or explicitly mentions "在画布上" / "工作流节点". Otherwise, leave the canvas alone so the user can open it manually without distraction.\n' +
    '- Never expose internal identifiers in user-facing text — no node ids, `canvas:<id>` strings, or tool names. Refer to canvas items by their title/label (e.g. "水彩那张", "方向 B") so the conversation reads naturally.\n' +
    '- Keep reply text concise — never narrate polling, retries, waiting, or tool mechanics ("我会再检查一次", "继续等待结果", "重新提交"). Live status is already shown by the UI; your reply carries only the outcome and facts the user needs.\n' +
    '- ask_user cards already render the question and every option to the user — never restate the question or enumerate the options in your reply, before or after they answer. Respond directly to what they picked (e.g. "好的，扩展画布边缘 —— 我来处理"). When a card collected several answers at once, a single short recap clause is enough.',
    canvasSummary,
    'When a request needs a visual direction (mood, palette, typography) before you generate or design something, call ask_user with kind:"direction" and 2-4 `directions` cards (title, palette hex list, displayFont/bodyFont stacks, one-line mood, real-world references) so the user picks by looking. If a direction maps to a node already on the canvas (e.g. a draft image the user can inspect), set the card\'s `nodeId` so the card shows that node\'s real thumbnail. To show real draft images on the cards: add the draft nodes directly (never asProposal — proposals need manual acceptance and stay idle), call run_node on each, and wait until their outputs land before sending the direction question. When a skill mentions preset sample images, set the card\'s `imageUrl` to the given `skill-asset:` URL instead.',
    artifactStore
      ? 'When the user asks for a flowchart, sequence diagram, system architecture diagram, or mind map, call generate_diagram with Mermaid syntax to produce an interactive Excalidraw canvas artifact in the right panel. When the user asks for a spreadsheet, budget, financial report, or table calculation, call generate_sheet with rows, columns, and formulas to render a full-featured Excel sheet artifact in the right panel.'
      : '',
    computerEnabled
      ? 'Computer control is available via the `computer` tool — you can screenshot the screen and move/click/drag the mouse, scroll, type text, and press keys on THIS machine. ' +
        'Use it only when the task genuinely needs the GUI (a desktop app with no CLI, a visual check). Prefer workspace tools for files, `run_command` for anything a shell can do. ' +
        'Workflow: call `computer {action:"screenshot"}` first, decide from the image, act with pixel coordinates from that screenshot (top-left origin), then screenshot again to verify. Work in small steps. ' +
        'The user approves once at the start of the session. Never type passwords, card numbers, or other secrets — ask the user to do that themselves.'
      : '',
    memory ? `Workspace MEMORY.md:\n${redactSecrets(memory)}` : '',
    skill
      ? `The user invoked skill "${skill.name}". Follow this skill:\n${skill.body}\n\n` +
        'If this skill declares a "提问"/"Questions" section, collect each missing input through `ask_user` question cards (concrete options + free text) before producing output — never ask those questions as plain chat text. Ask each question at most once; an input the user already answered is never re-asked.'
      : '',
    projectInstructions ? `Project "${projectName}" working rules:\n${projectInstructions}` : '',
  ].filter(Boolean);
  const instructions = systemParts.join('\n\n');

  // `ai` v7 rejects a `system`-role entry in `messages`; the system prompt
  // goes to `instructions`. Preserve completed tool pairs so each new turn
  // knows what was already inspected and does not repeat the same search.
  // Which `computer` tool results get their screenshot re-sent to the model as
  // an image (vs. a one-line text stub). Only the most recent few, so a long
  // GUI session can't blow the context window.
  const screenshotCtx =
    computerEnabled && dataRoot
      ? { dataRoot, inlineIds: recentComputerResultIds(session.messages, SCREENSHOT_RETENTION) }
      : undefined;

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
    history.push(
      ...assistantTurnToModelMessages(message.content, compactAssistantParts(parts), screenshotCtx),
    );
  }

  // `emit` is bound to the live stream once `startAgentTurn` opens it; tools
  // created here need the reference up front (todos / permission side-channel).
  let emit: (event: ChatStreamEvent) => void = () => undefined;
  const todos: TodoItem[] = [];
  const loopGuard = createToolLoopGuard();

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

  const artifactTools = artifactStore
    ? createArtifactTools({ sessionId, projectId: session.projectId, artifactStore })
    : undefined;

  const imageTools = dataRoot
    ? createImageTools({ settingsStore, dataRoot, sessionId, canvasStore })
    : undefined;

  const computerTools =
    computerEnabled && dataRoot
      ? createComputerTools({
          sessionId,
          dataRoot,
          permissionMode: settings.permissionMode,
          emit: (event) => emit(event),
        })
      : undefined;

  // ask_user is a chat-interaction tool, not a workspace one — include it even
  // when no workspace is configured so the agent can always ask questions.
  const askTool = createAskUserTool(sessionId);

  const tools =
    toolset?.tools || canvasTools || artifactTools || imageTools || computerTools || askTool
      ? {
          ask_user: askTool,
          ...(toolset?.tools ?? {}),
          ...(canvasTools ?? {}),
          ...(artifactTools ?? {}),
          ...(imageTools ?? {}),
          ...(computerTools?.tools ?? {}),
        }
      : undefined;

  const model = createOpenAiModel({ apiKey, modelId, baseUrl });

  let lastSeenNodeCount = -1;
  const initialCanvas = canvasStore ? canvasStore.findCanvasBySession(sessionId) : null;
  const initialSnap = initialCanvas && canvasStore ? canvasStore.getSnapshot(initialCanvas.id) : null;
  if (initialSnap) lastSeenNodeCount = initialSnap.nodes.length;

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
      prepareStep: ({ messages: stepMessages }) => {
        const compacted = compactModelMessages(stepMessages as ModelMessage[]);
        if (canvasStore && lastSeenNodeCount >= 0) {
          const canvas = canvasStore.findCanvasBySession(sessionId);
          const snap = canvas ? canvasStore.getSnapshot(canvas.id) : null;
          if (snap && snap.nodes.length !== lastSeenNodeCount) {
            const diff = snap.nodes.length - lastSeenNodeCount;
            lastSeenNodeCount = snap.nodes.length;
            const deltaNote: ModelMessage = {
              // Not a system message — several providers reject mid-prompt
              // system entries; a bracketed user note reads the same to the model.
              role: 'user',
              content: `[画布状态增量: 当前共有 ${snap.nodes.length} 个节点 (${diff > 0 ? `+${diff}` : diff})，最新: ${snap.nodes.slice(-2).map((n) => `「${n.title || n.id}」(${n.type})`).join(', ')}]`,
            };
            compacted.push(deltaNote);
          }
        }
        return { messages: compacted };
      },
    });

  return startAgentTurn({
    sessionStore,
    sessionId,
    translate: translateOpenAiChunk,
    largeValues: largeValueStore,
    onReady: (send) => {
      // Watch completed tool calls for a stuck-agent loop. `warn` surfaces a
      // banner; `halt` also aborts the turn (it settles as `interrupted` — the
      // tool_loop event carries the reason).
      emit = (event) => {
        if (
          event.type === 'tool' &&
          (event.result !== undefined || event.error !== undefined)
        ) {
          const verdict = loopGuard.record({
            name: event.name,
            args: event.args,
            ok: event.error === undefined,
          });
          if (verdict && verdict.tier !== 'ok') {
            send({ type: 'tool_loop', tier: verdict.tier, reason: verdict.reason });
            if (verdict.tier === 'halt') setTimeout(() => abortChatTurn(sessionId), 0);
          }
        }
        send(event);
      };
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
            result: JSON.stringify({
              answers: item.answers ?? {},
              note: 'The user answered on the card. Respond to their pick directly — do not restate the question or re-list the options.',
            }),
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
        const outcome =
          item.name === COMPUTER_TOOL_NAME
            ? ((await computerTools?.executeApproved(item.args)) ?? {
                error: 'Computer control is not enabled for this turn',
              })
            : ((await toolset?.executeApproved(item.name, item.args)) ?? {
                error: 'This turn has no workspace tools',
              });
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
        [
          ...history,
          ...assistantTurnToModelMessages(
            snap.text,
            compactAssistantParts(snap.parts),
            screenshotCtx
              ? {
                  dataRoot: screenshotCtx.dataRoot,
                  inlineIds: recentComputerResultIdsFromParts(snap.parts, SCREENSHOT_RETENTION),
                }
              : undefined,
          ),
        ],
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
          ...assistantTurnToModelMessages(
            snap.text,
            compactAssistantParts(snap.parts),
            screenshotCtx
              ? {
                  dataRoot: screenshotCtx.dataRoot,
                  inlineIds: recentComputerResultIdsFromParts(snap.parts, SCREENSHOT_RETENTION),
                }
              : undefined,
          ),
          { role: 'user', content: CONTINUE_USER_MESSAGE },
        ],
        signal,
      );
    },
  });
}

interface ScreenshotCtx {
  dataRoot: string;
  inlineIds: Set<string>;
}

/** Ids of the last `limit` completed `computer` tool results across all messages. */
function recentComputerResultIds(messages: ChatMessage[], limit: number): Set<string> {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts ?? []) {
      if (part.name === COMPUTER_TOOL_NAME && part.result) ids.push(part.id);
    }
  }
  return new Set(ids.slice(-limit));
}

/** Same, but over a single in-flight part list (used on resume / continue passes). */
function recentComputerResultIdsFromParts(parts: ToolCallPart[], limit: number): Set<string> {
  const ids = parts.filter((p) => p.name === COMPUTER_TOOL_NAME && p.result).map((p) => p.id);
  return new Set(ids.slice(-limit));
}

/** The `computer` tool-result screenshot as an image content part, or null. */
function computerScreenshotOutput(part: ToolCallPart, ctx: ScreenshotCtx) {
  if (part.name !== COMPUTER_TOOL_NAME || !part.result || !ctx.inlineIds.has(part.id)) return null;
  let parsed: {
    screenshotFile?: string;
    summary?: string;
    cursor?: { x: number; y: number } | null;
    screenSize?: { width: number; height: number };
  };
  try {
    parsed = JSON.parse(part.result);
  } catch {
    return null;
  }
  if (!parsed.screenshotFile) return null;
  const png = readScreenshotSync(ctx.dataRoot, parsed.screenshotFile);
  if (!png) return null;
  const caption = `${parsed.summary ?? 'computer action'}. cursor=${
    parsed.cursor ? `(${parsed.cursor.x},${parsed.cursor.y})` : 'unknown'
  } screen=${parsed.screenSize ? `${parsed.screenSize.width}x${parsed.screenSize.height}` : '?'}`;
  return screenshotContentOutput(caption, png);
}

/**
 * One assistant turn (text + tool calls) as the `[assistant, tool]` message
 * pair the model needs to see completed tool work on the next pass. When
 * `screenshotCtx` is supplied, recent `computer` results carry their screenshot
 * back as an actual image.
 */
function assistantTurnToModelMessages(
  text: string,
  parts: ToolCallPart[],
  screenshotCtx?: ScreenshotCtx,
): ModelMessage[] {
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
        output:
          (screenshotCtx && computerScreenshotOutput(part, screenshotCtx)) ||
          parseToolOutput(part.result ?? part.error ?? ''),
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
