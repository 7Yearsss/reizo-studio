import { createPresentationTools } from './presentationTools';
import { createVideoEditorTools } from './videoEditorTools';
import { tryVideoApplyTurn } from './videoApplyTurn';
import { parsePresentationReferences, splitPresentationContext, wrapPresentationContext } from '../../../shared/presentationReferences';
import type { ArtifactReviewStore } from '../storage/artifactReviewStore';
import { createDocumentTools } from './documentTools';
import { describeSessionArtifacts } from './sessionArtifactsHint';
import { compactReferenceContext } from '../../../shared/referenceContext';
import { parseDocumentReferences, splitDocumentContext, wrapDocumentContext } from '../../../shared/documentReferences';
import { isStepCount, streamText, type ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { resolveSettingsModel } from '../providerResolver';
import { usageFetch } from './provider/usageFetch';
import type { UsageStore } from '../storage/usageStore';
import { canvasWorkStopped } from '../canvas/workLifecycle';
import { CANVAS_BUDGET_TOOL, type ChatStreamEvent, type MemoryItem, type TodoItem } from '../../../shared/stream';
import { createOpenAiModel, isOfficialOpenAi } from './provider/openai';
import { quotaFetch, llmSchedulerFor } from './provider/quotaFetch';
import { createGenerationScheduler } from '../canvas/generationScheduler';
import { createDeliveryTools } from './deliveryTools';
import { createAskUserTool, createWorkspaceTools } from './workspaceTools';
import { createScheduleTools, runApprovedScheduleTool } from './scheduleTools';
import { createCanvasTools } from './canvasTools';
import { createArtifactTools } from './artifactTools';
import { FILE_GENERATION_INSTRUCTIONS } from './fileTools';
import { buildSheetContext } from './sheetContext';
import { buildDocumentContext } from './documentContext';
import { buildPresentationContext } from './presentationContext';
import { parseSheetReferences, wrapSheetContext } from '../../../shared/sheetReferences';
import { createImageTools } from './imageTools';
import { createVideoTools } from './videoTools';
import { createComputerTools, isComputerUseSupported } from './computerTools';
import { COMPUTER_TOOL_NAME, SCREENSHOT_RETENTION } from '../../../shared/computerUse';
import { readScreenshotSync, screenshotContentOutput } from '../../computerUse/store';
import { getCanvasSelection } from '../canvas/selection';
import type { CanvasStore } from '../storage/canvasStore';
import type { CanvasImageParams } from '../../../shared/canvas';
import { startAgentTurn, abortChatTurn } from './session';
import { drainSteerInbox } from './steerInbox';
import { createToolLoopGuard, hashResult } from './toolLoopGuard';
import { serializeMutatingTools } from './toolSerializer';
import { createCanvasBudget } from './canvasBudget';
import { inlineCanvasRefImages } from './canvasRefImages';
import { consumeInteractions, waitForInteractions, ALWAYS_ASK_TOOLS, COMPUTER_CONFIRM_TOOL } from './permissions';
import { translateOpenAiChunk } from './translators/openai';
import { compactAssistantParts, compactModelMessages } from './modelHistory';
import { CONTINUE_USER_MESSAGE, MAX_AGENT_STEPS, MAX_CONTINUE_PASSES, hitStepCap, shouldContinueAgentPass, hasDeliveredArtifact } from './continuePass';
import { appendHookNote, createHookRunner, loadHooks, wrapToolsWithHooks } from './hooks';
import { connectMcpTools, MCP_TOOL_PREFIX } from './mcpTools';
import { hasReasoningLeak } from './reasoningLeak';
import { createBatchTool, createSubagentTool, loadSubagentRoles, pickReadOnlyTools } from './subagentTools';
import { applyAllHarnessProposals } from './harnessEvolution';
import { loadActiveHarnessRules } from './harnessRules';
import { recordSkillExperience } from './skillRefiner';
import { loadPluginContributions } from '../plugins/pluginStore';
import { createTurnTraceCollector, writeTurnTrace } from './turnTrace';
import { readWorkspaceMemory } from '../../workspaceMemory';
import { formatRules, readRuleSources } from './workspaceRules';
import { createSkillTools } from './skillTools';
import { createAttachmentTools } from './attachmentTools';
import { DEFAULT_CONTEXT_WINDOW_TOKENS, nextOutputCap } from '../../../shared/autoCompact';
import { chatModelCapabilities } from '../../../shared/chatModelCapabilities';
import { createSkillDraftTools, PROPOSE_SKILL_TOOL, runApprovedSkillDraft } from './skillDraftTools';
import { inlineAttachment } from '../../../shared/attachmentText';
import { createWebTools, HTTP_FETCH_TOOL, WEB_SEARCH_TOOL } from './webTools';
import { createWebSearchStore } from '../storage/webSearchStore';
import type { ExpertAgent } from '../../../shared/expertAgent';
import { parseAllowedTools } from '../../../shared/skillToolPolicy';
import { createPersonalMemoryTools, personalMemoryRoot } from './personalMemory';
import { applySkillToolPolicy } from './skillToolFilter';
import { observeRetries } from '../../../shared/retryObserver';
import { messagesForModel } from '../../../shared/compactBoundary';
import { applyRunCeiling, effectiveRunMode, READ_ONLY_RUN_NOTICE } from './runCeiling';
import { ceilingWithPlanMode, PLAN_MODE_NOTICE } from '../../../shared/planMode';
import type { RunPermission } from '../../../shared/schedule';
import type { MemoryEntry } from '../../workspaceMemoryDir';
import {
  formatRecalledMemories,
  markRecalled,
  scheduleMemoryExtraction,
  startMemoryRecall,
  withTimeout,
  RECALL_BUDGET,
} from '../../memoryJobs';
import { redactSecrets } from '../../../shared/redactSecrets';
import { digestSession, parseSessionReferences, wrapSessionContext } from '../../../shared/sessionReference';
import { buildSkillsTriggerIndex, type Skill } from '../../skills';
import type { ChatMessage, SessionStore, ToolCallPart } from '../../../shared/chat';
import type { SettingsStore } from '../storage/settingsStore';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ProjectStore } from '../storage/projectStore';
import type { LargeValueStore } from '../storage/largeValueStore';
import type { MemoryEventsStore } from '../storage/memoryEventsStore';

/**
 * Reverse proxies (Cloudflare 524, nginx read timeouts) often fail one
 * Responses API pass after a long wait. A couple of retries recover that
 * pass without re-running tools the user already approved. 0 turned those
 * into a dead `openai_error` with no second chance.
 */
const PROVIDER_MAX_RETRIES = 2;
const standaloneLlmScheduler = createGenerationScheduler({ globalLimit: 4, providerLimit: 4, reservedInteractiveSlots: 1 });
/**
 * These now only ever cover *real generation* plus bounded autonomous tools
 * (read_file, inspect-only git, post-approval tool bodies — the shell path
 * self-limits at 30s). Human approval time is never inside a step: an
 * approval-needing tool unwinds the step immediately and the turn suspends
 * between passes with every one of these timers cleared.
 */
const PROVIDER_TIMEOUT = {
  firstChunkMs: 3 * 60_000,
  // Reasoning models on buffered gateways (grok via new-api relays) can sit
  // silent well past a minute mid-step — upstream buffers the reasoning and
  // flushes it as a burst. Silent thinking is real generation, not a stall.
  chunkMs: 3 * 60_000,
  stepMs: 10 * 60_000,
} as const;

export { abortChatTurn };

export { pushSteer, drainSteerInbox, type SteerItem } from './steerInbox';

/** Prepended to the model-facing copy so the model reads the message as mid-turn steering, not a new request. */
const STEER_PREFIX = '(The user sent this while you were mid-turn — treat it as steering input for the current work.)';
/** For jobWatch notes — a background node settled; acknowledge only if relevant, never treat as a user request. */
const STEER_SYSTEM_PREFIX = '(System notice — a watched background canvas job updated. Not a user request; reply to it only if it changes your current plan.)';

interface CanvasRef {
  id: string;
  region?: { x: number; y: number; w: number; h: number };
}

/** Read-only digest of the conversations the user pointed at with `#`; deleted or trashed ones degrade to a note. */
async function buildSessionRefBlock(sessionStore: SessionStore, currentId: string, ids: string[]): Promise<string> {
  const wanted = ids.filter((id) => id !== currentId);
  if (wanted.length === 0) return '';
  const entries = await Promise.all(wanted.map(async (id) => {
    const found = await sessionStore.get(id).catch((): null => null);
    if (!found) return { id, missing: true as const };
    const { text, omitted } = digestSession(found);
    return { id, title: found.title, text: redactSecrets(text), omitted };
  }));
  return wrapSessionContext(entries);
}

function parseCanvasRefs(mentions: string[]): { refs: CanvasRef[]; paths: string[] } {
  const refs = mentions
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
  return { refs, paths: mentions.filter((m) => !m.startsWith('canvas:')) };
}

function buildCanvasRefBlock(
  canvasStore: CanvasStore | undefined,
  sessionId: string,
  refs: CanvasRef[],
): string {
  if (refs.length === 0 || !canvasStore) return '';
  const canvas = canvasStore.findCanvasBySession(sessionId);
  const lines: string[] = [];
  let hasRegion = false;
  for (const ref of refs) {
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
  if (lines.length === 0) return '';
  return (
    `Referenced canvas nodes:\n${lines.join('\n')}` +
    (hasRegion
      ? '\n(Marked regions are normalized rects the user drew on that node\'s image — they are pointing at that specific area, so treat it as the subject of the message.)'
      : '')
  );
}

/**
 * Content persisted for a steered message — same shape as a normal user
 * message (text + ref blocks) so the renderer's canvas chips work on it.
 */
export function buildSteerContent(
  canvasStore: CanvasStore | undefined,
  sessionId: string,
  text: string,
  mentions: string[],
): string {
  const presentationRefs = parsePresentationReferences(mentions);
  const documentRefs = parseDocumentReferences(presentationRefs.rest);
  const sheetRefs = parseSheetReferences(documentRefs.rest);
  const { refs, paths } = parseCanvasRefs(sheetRefs.rest);
  const blocks = [
    paths.length > 0 ? `Referenced workspace paths:\n${paths.map((m) => `- ${m}`).join('\n')}` : '',
    buildCanvasRefBlock(canvasStore, sessionId, refs),
    documentRefs.refs.length ? wrapDocumentContext(documentRefs.refs) : '',
    presentationRefs.refs.length ? wrapPresentationContext(presentationRefs.refs) : '',
    sheetRefs.refs.length ? wrapSheetContext(sheetRefs.refs.map((ref) => ({ ...ref, name: 'Excel 工作簿' })), 'Use read_sheet with the referenced artifactId before editing. Preserve the referenced sheet and range.') : '',
  ].filter(Boolean);
  return blocks.length > 0 ? `${text}\n\n${blocks.join('\n\n')}` : text;
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
  artifactStore?: ArtifactStore;
  artifactReviews?: ArtifactReviewStore;
  projectStore?: ProjectStore;
  truncateAfterId?: string;
  regenerate?: boolean;
  largeValueStore?: LargeValueStore;
  canvasStore?: CanvasStore;
  canvasProviderStore?: import('../storage/providerStore').ProviderStore;
  usageStore?: UsageStore;
  dataRoot?: string;
  memoryEventsStore?: MemoryEventsStore;
  scheduleStore?: import('../storage/scheduleStore').ScheduleStore;
  /** Unattended-run ceiling (automations). Only ever tightens the global permission mode and toolset. */
  runCeiling?: RunPermission;
  /** Plan mode: read-only until the user confirms the plan (forces the read-only ceiling for this turn). */
  planMode?: boolean;
  /** Id the client chose for this send; stamped on the user row so a retry can be recognised. */
  clientTurnId?: string;
  /** Every skill on disk; the model may start the auto-invokable ones with `use_skill`. */
  availableSkills?: Skill[];
  /** The expert the message was addressed to with `@name`, if any. */
  expert?: ExpertAgent | null;
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
    memoryEventsStore,
    scheduleStore,
    planMode = false,
    clientTurnId,
    runCeiling: requestedCeiling,
    availableSkills = [],
    expert = null,
  } = options;

  const turnOriginAt = Date.now();
  // Plan mode is a read-only run until the user confirms; it only ever tightens.
  const runCeiling = ceilingWithPlanMode(requestedCeiling, planMode);
  let session = await sessionStore.get(sessionId);
  if (skill?.contractError) return Response.json({ error: skill.contractError }, { status: 400 });
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const localVideoTurn = await tryVideoApplyTurn(options);
  if (localVideoTurn) return localVideoTurn;

  const settings = await settingsStore.get();
  let resolved: ReturnType<typeof resolveSettingsModel>;
  try { resolved = resolveSettingsModel(settings, { category: 'llm', providerId: options.providerId, model: options.model }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
  const { providerId, modelId, apiKey, baseUrl } = resolved;

  if (truncateAfterId) {
    const idx = session.messages.findIndex((m) => m.id === truncateAfterId);
    if (idx < 0) {
      return Response.json({ error: 'truncateAfterId not found' }, { status: 400 });
    }
    session = await sessionStore.setMessages(sessionId, session.messages.slice(0, idx));
  }

  const presentationRefs = parsePresentationReferences(mentions);
  const documentRefs = parseDocumentReferences(presentationRefs.rest);
  const sheetRefs = parseSheetReferences(documentRefs.rest);
  const sessionRefs = parseSessionReferences(sheetRefs.rest);
  const { refs: canvasRefs, paths: pathMentions } = parseCanvasRefs(sessionRefs.rest);
  const sessionRefBlock = await buildSessionRefBlock(sessionStore, sessionId, sessionRefs.ids);
  const canvasRefBlock = buildCanvasRefBlock(canvasStore, sessionId, canvasRefs);
  const sheetRefBlock = await buildSheetContext(artifactStore, sessionId, sheetRefs.refs);
  const documentContext = await buildDocumentContext(artifactStore, sessionId, documentRefs.refs);
  const presentationContext = await buildPresentationContext(artifactStore, sessionId, presentationRefs.refs);

  const extraBlocks = [
    pathMentions.length > 0 ? `Referenced workspace paths:\n${pathMentions.map((m) => `- ${m}`).join('\n')}` : '',
    canvasRefBlock,
    sessionRefBlock,
    sheetRefBlock,
    documentRefs.refs.length ? wrapDocumentContext(documentRefs.refs, documentContext) : '',
    presentationRefs.refs.length ? wrapPresentationContext(presentationRefs.refs, presentationContext) : '',
    attachments.length > 0
      ? attachments
          .map(
            (file) =>
              `Attached file ${file.name}:\n\`\`\`\n${redactSecrets(inlineAttachment(file.name, file.content))}\n\`\`\``,
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
      ...(clientTurnId ? { clientId: clientTurnId } : {}),
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
  const runPermissionMode = effectiveRunMode(settings.permissionMode, runCeiling);
  const memory = workspacePath ? await readWorkspaceMemory(workspacePath) : '';
  // The user's own memory follows them into every workspace, and works with none open.
  const personalMemory = dataRoot ? await readWorkspaceMemory(personalMemoryRoot(dataRoot)) : '';
  const standingRules = formatRules(await readRuleSources({ workspacePath, userRulesDir: dataRoot }));
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

  const sessionArtifactsHint = artifactStore && options.artifactReviews ? await describeSessionArtifacts(artifactStore, sessionId) : '';
  const activeHarnessRules = await loadActiveHarnessRules(dataRoot);

  const systemParts = [
    workspacePath
      ? `You are Reizo Studio, a local desktop agent that finishes real work in the user's files. The workspace is at: ${workspacePath}. For workspace tasks prefer tools over guessing: use list_dir/read_file/find_files/grep to inspect, edit_file/write_file to change files, run_command for tests and git, ask_user when you need a choice, todo_write for a visible plan, and memory_read/memory_write/memory_delete for durable memory files (indexed in MEMORY.md). Greetings, small talk, and questions you can answer from this prompt get a direct reply with no tool calls; the memory index below is already loaded, so only memory_read a file whose description matters for the current task.`
      : 'You are Reizo Studio, a helpful creative assistant running locally on the user\'s desktop. Use ask_user if you need the user to choose.',
    activeHarnessRules.systemPromptAddon,
    activeHarnessRules.guardrails,
    artifactStore ? FILE_GENERATION_INSTRUCTIONS : '',
    'Response formatting: Use Markdown for readable replies. Use **bold** sparingly for key conclusions or important values, real lists for parallel items, and fenced code blocks with a language for code. Do not wrap an entire reply in a code block. When a workspace file has actually been produced, link it as [descriptive filename](relative/path.ext) so the user can preview it. Keep existing canvas node links as canvas:<nodeId>. Never invent a downloadable file or a successful output before a tool confirms it.',
    'Image Generation Rules:\n' +
    '- When the user asks to generate, draw, or paint an image (e.g., "生图", "画一张...", "生成图片", "设计海报", "绘制插画"), ALWAYS call the `generate_image` tool directly within this chat conversation. The image will be generated and rendered inline for the user.\n' +
    '- The `generate_image` tool resolves image credentials and model defaults independently of the text model. Omit its model argument unless the user explicitly selected an image model; never infer an image model from the text provider or invent a model id. Never refuse or tell the user that OpenAI API Key is missing before invoking the tool.\n' +
    '- DO NOT touch the canvas or call `add_node(type: "image")` or `open_canvas` for standard image generation requests. Standard image generation belongs 100% in this chat conversation.\n' +
    '- Video Generation Rules: Before a standard video request, call `get_video_models` to read actual available models and known capabilities. If the user has not explicitly selected a video model for this request, use `ask_user` with the returned model question so they can choose; preselect the configured model when recommended. Reuse already answered choices and never ask the same input twice. Collect missing visual direction with direction cards, and missing ratio/duration with choice questions, offering only values supported by the selected model and this client (5s/10s; 16:9/9:16/1:1). Do not guess prices, quality, speed or capabilities. Unknown capabilities stay unspecified; if there are no available models, explain how to configure them instead of submitting. Then call `generate_video` in chat with BOTH the selected model id and providerId; these are video settings, independent of the chat text model. Its durable task card shows loading and then the playable result, even after your reply ends. Do not call add_node/run_node/open_canvas for these requests. A queued/running receipt is not a completed video or upstream submission confirmation. Do not poll, resubmit, or tell the user to go to the canvas; they may explicitly take the result there themselves.\n' +
    (settings.directorSessions?.[sessionId]
      ? '- Canvas Rules (导演模式 ON): You are the director of the session canvas. When a request implies producing multiple assets, a series, or a multi-step creative workflow (e.g. 一套物料, 分镜, 系列图, A/B 方向), proactively plan it on the canvas: lay out the whole plan first using `add_node`/`create_storyboard_pipeline` with `asProposal: true` so the user sees ghost nodes before anything generates. After the user accepts the proposal, run nodes — prefer batching several per pass. For single one-off images, `generate_image` in chat is still correct.\n' +
        '- Before calling `run_graph` / `create_storyboard_pipeline` for a multi-node pipeline, `read_canvas` and check whether the node set covers every deliverable the request implies (e.g. "广告" implies voiceover/subtitle nodes, "九宫格" implies nine distinct compositions rather than nine repeats). If something is missing, either add the nodes first or ask the user — do not run first and discover the gap afterwards.\n'
      : '- Canvas Rules: The canvas is for complex multi-step node graphs and workflows. Only call canvas tools (`add_node`, `run_node`, `open_canvas`, etc.) when the user explicitly asks to build or edit a canvas node workflow, wire nodes, or explicitly mentions "在画布上" / "工作流节点". Otherwise, leave the canvas alone so the user can open it manually without distraction.\n') +
    '- Canvas Output Rules (HARD): image/video/audio node outputs (assets/*.png etc.) are rendered directly on the canvas UI for the user to see. After `run_graph` / `run_node` completes, NEVER use `read_file` or write shell/python/powershell scripts via `write_file`/`run_command` to read, inspect, QA, OCR, resize, or convert binary media files. `read_file` only supports UTF-8 text and CANNOT read binary files. Once `run_graph` reports done, the generation round is finished: reply with a short summary of what was produced and tell the user to review the results on the canvas.\n' +
    '- Never expose internal identifiers in user-facing text — no node ids, `canvas:<id>` strings, or tool names. Refer to canvas items by their title/label (e.g. "水彩那张", "方向 B") so the conversation reads naturally.\n' +
    '- Keep reply text concise — never narrate polling, retries, waiting, or tool mechanics ("我会再检查一次", "继续等待结果", "重新提交"). Live status is already shown by the UI; your reply carries only the outcome and facts the user needs.\n' +
    '- ask_user cards already render the question and every option to the user — never restate the question or enumerate the options in your reply, before or after they answer. Respond directly to what they picked (e.g. "好的，扩展画布边缘 —— 我来处理"). When a card collected several answers at once, a single short recap clause is enough.',
    'When a request needs a visual direction (mood, palette, typography) before you generate or design something, call ask_user with kind:"direction" and 2-4 `directions` cards (title, palette hex list, displayFont/bodyFont stacks, one-line mood, real-world references) so the user picks by looking. If a direction maps to a node already on the canvas (e.g. a draft image the user can inspect), set the card\'s `nodeId` so the card shows that node\'s real thumbnail. To show real draft images on the cards: add the draft nodes directly (never asProposal — proposals need manual acceptance and stay idle), call run_node on each, and wait until their outputs land before sending the direction question. When a skill mentions preset sample images, set the card\'s `imageUrl` to the given `skill-asset:` URL instead.',
    options.artifactReviews ? 'For editable PPT decks use generate_presentation. When the message carries <presentation-context> with `current` content, propose_presentation_edits straight from its version and slide/element IDs without read_presentation first; otherwise read existing slide and element IDs with read_presentation, then propose_presentation_edits. Keep edits within referenced pages/elements and wait for user review. Never bypass review through shell, files, or HTTP.' : '',
    options.artifactReviews ? 'For Excel workbooks use generate_sheet only to create new ones. To change an existing workbook call read_sheet, then propose_sheet_edits with the current version; the original stays unchanged until the user accepts in the Excel panel. Keep each operation to its own non-overlapping range. Keep formulas live: never replace a formula with its computed value unless the user asks, and write new calculations as formulas. If the tool result carries warnings, tell the user plainly and, unless they are intended, re-propose with formulas. To audit a workbook (errors, formulas that differ from their column, hand-typed numbers inside formula columns, SUM ranges that stop short, numbers stored as text, stray spaces, hard-coded constants) call check_sheet, then propose_sheet_edits for the findings that have a fix; do not invent problems it did not report. For pivot tables, group-by summaries, or cross-tabs use an upsertPivot operation (live formulas, refreshable) instead of computing totals yourself. For charts use upsertChart, preferably bound to a pivot via pivotId (propose the chart after the pivot is accepted). Never bypass review through shell, files, or HTTP.' : '',
    options.artifactReviews ? 'For editable documents use generate_document. When the message carries <document-context> with `current` content, edit straight from it: call propose_document_edits with that version and those block IDs, without read_document first. Otherwise call read_document before modifying an existing Doc, then propose_document_edits with the current version and stable block IDs. Proposals do not change the original. Only the user may accept or reject, on the suggestion card in chat or in the Doc panel. After proposing, reply with one short sentence at most: the card already shows the before/after, so never repeat, quote or re-explain the new text. Never use file writes, shell commands, or HTTP calls to bypass document review. Respect referenced selected ranges. To audit a Doc for consistency (numbering, punctuation, date and number formats, stray spaces, repeated words or paragraphs, terminology) call check_document, then propose_document_edits for the findings that have a replacement; do not invent problems it did not report. For a whole-document task on a long Doc (translate, unify tone, fix every occurrence) go through it in order: read a page with read_document, propose its edits (up to 40 operations per call, one call per page), then continue with nextOffset until the last block; every batch becomes its own review and the user can accept them all at once, so never stop early or skip sections.' : '',
    artifactStore
      ? 'When the user asks for a flowchart, sequence diagram, system architecture diagram, or mind map, call generate_diagram with Mermaid syntax to produce an interactive Excalidraw canvas artifact in the right panel. When the user asks for a spreadsheet, budget, financial report, or table calculation, call generate_sheet with rows, columns, and formulas to render a full-featured Excel sheet artifact in the right panel.'
      : '',
    computerEnabled
      ? 'Computer control is available via the `computer` tool — you can screenshot the screen and move/click/drag the mouse, scroll, type text, and press keys on THIS machine. ' +
        'Use it only when the task genuinely needs the GUI (a desktop app with no CLI, a visual check). Prefer workspace tools for files, `run_command` for anything a shell can do. ' +
        'Workflow: call `computer {action:"screenshot"}` first, decide from the image, act with pixel coordinates from that screenshot (top-left origin), then screenshot again to verify. Work in small steps. ' +
        'The user approves once at the start of the session. Never type passwords, card numbers, or other secrets — ask the user to do that themselves.'
      : '',
    skill ? '' : buildSkillsTriggerIndex(availableSkills),
    // Per-turn dynamic parts go last so the long static prefix above stays identical across turns (provider prefix caching).
    canvasSummary,
    sessionArtifactsHint,
    personalMemory
      ? 'Personal memory index (about the USER, applies in every workspace — each line points at an entry, read it with personal_memory_read):\n' + redactSecrets(personalMemory)
      : '',
    memory
      ? 'Workspace memory index (MEMORY.md — each line points at a file in memory/, read it with memory_read):\n' +
          redactSecrets(memory)
      : '',
    workspacePath
      ? 'Memory rules: when the user states a lasting preference, corrects you, or shares a non-obvious project fact, save it with memory_write (one file per fact — check the index first and update in place rather than duplicating). Delete wrong or outdated memories with memory_delete. Do NOT save anything derivable from the workspace itself: code structure, git history, existing file contents, or things already in MEMORY.md.'
      : '',
    skill
      ? `The user invoked skill "${skill.name}". Follow this skill:\n${skill.body}\n\n` +
        (skill.experience ? `Accumulated experience for "${skill.name}" (EXPERIENCE.md):\n${skill.experience}\n\n` : '') +
        'If this skill declares a "提问"/"Questions" section, collect each missing input through `ask_user` question cards (concrete options + free text) before producing output — never ask those questions as plain chat text. Ask each question at most once; an input the user already answered is never re-asked.'
      : '',
    projectInstructions ? `Project "${projectName}" working rules:\n${projectInstructions}` : '',
    standingRules,
    expert
      ? `The user addressed this message to the expert "${expert.name}"${expert.description ? ` (${expert.description})` : ''}. For this reply act as that expert, following these instructions:
${expert.instructions}`
      : '',
    planMode ? PLAN_MODE_NOTICE : runCeiling === 'readonly' ? READ_ONLY_RUN_NOTICE : '',
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
  // Reference blocks (sheet data, selections) are only fresh for the turn they
  // were sent in; older ones collapse to an identity line so history stays small.
  // A compaction boundary swaps everything before it for a summary; the full transcript stays in the session.
  const modelMessages = messagesForModel(session.messages);
  const currentUserIndex = modelMessages.findLastIndex((m) => m.role === 'user');
  for (const [index, message] of modelMessages.entries()) {
    if (message.role === 'user') {
      history.push({ role: 'user', content: index === currentUserIndex ? message.content : compactReferenceContext(message.content) });
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
  await inlineCanvasRefImages(history, { canvasStore, sessionId, dataRoot });

  // `emit` is bound to the live stream once `startAgentTurn` opens it; tools
  // created here need the reference up front (todos / permission side-channel).
  let emit: (event: ChatStreamEvent) => void = () => undefined;
  const todos: TodoItem[] = [];
  const loopGuard = createToolLoopGuard();
  const trace = createTurnTraceCollector({ sessionId, model: modelId, originAt: turnOriginAt });

  const toolset = workspacePath
    ? createWorkspaceTools({
        sessionId,
        workspacePath,
        permissionMode: runPermissionMode,
        emit: (event) => {
          emit(event);
          // Tool-path memory writes/deletes persist to the activity log the
          // same way the recall/extraction paths do.
          if (event.type === 'memory') {
            void memoryEventsStore?.append(sessionId, event.action, event.items);
          }
        },
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

  // One budget per product turn — lives on the stack of this runChatTurn
  // call, so a permission suspension + resumed pass share the same counters
  // (the resume happens inside session.startTurn, inside this call).
  const canvasBudget = createCanvasBudget();
  const canvasTools =
    canvasStore && dataRoot
      ? createCanvasTools({ sessionId, canvasStore, settingsStore, dataRoot, artifactStore, providerStore: options.canvasProviderStore, budget: canvasBudget })
      : undefined;

  const artifactTools = artifactStore
    ? createArtifactTools({ sessionId, projectId: session.projectId, artifactStore, reviews: options.artifactReviews })
    : undefined;

  const imageTools = dataRoot
    ? createImageTools({ settingsStore, dataRoot, sessionId, projectId: session.projectId, canvasStore, artifactStore })
    : undefined;

  const videoTools = canvasStore && dataRoot
    ? createVideoTools({ sessionId, canvasStore, settingsStore, dataRoot, providerStore: options.canvasProviderStore })
    : undefined;

  const computerTools =
    computerEnabled && dataRoot
      ? createComputerTools({
          sessionId,
          dataRoot,
          permissionMode: runPermissionMode,
          emit: (event) => emit(event),
        })
      : undefined;

  // ask_user is a chat-interaction tool, not a workspace one — include it even
  // when no workspace is configured so the agent can always ask questions.
  const askTool = createAskUserTool(sessionId);

  // Automations live outside any workspace — the agent can always schedule
  // recurring or one-shot follow-up work (paseo-style heartbeat).
  const personalMemoryTools = dataRoot && runCeiling !== 'readonly'
    ? createPersonalMemoryTools({ sessionId, dataRoot, permissionMode: runPermissionMode, emit: (event) => emit(event) })
    : undefined;
  const webTools = runCeiling === 'readonly' ? undefined : createWebTools({ sessionId, permissionMode: runPermissionMode, getSearchConfig: dataRoot ? () => createWebSearchStore(dataRoot).get() : undefined });
  const scheduleTools = scheduleStore ? createScheduleTools({ scheduleStore, sessionId, permissionMode: runPermissionMode }) : undefined;

  let currentPresentationRefs = regenerate ? splitPresentationContext(userMessage?.content ?? '').refs : presentationRefs.refs;
  let currentDocumentRefs = regenerate ? splitDocumentContext(userMessage?.content ?? '').refs : documentRefs.refs;
  // Enabled extension packs add hooks and MCP servers (their skills reach the shared skills-dir list separately).
  const pluginPack = await loadPluginContributions(dataRoot);
  const hookRunner = createHookRunner({ hooks: [...(await loadHooks(dataRoot)), ...pluginPack.hooks], sessionId, cwd: workspacePath ?? dataRoot ?? process.cwd() });
  const rawTools =
    toolset?.tools || canvasTools || artifactTools || imageTools || computerTools || scheduleTools || askTool
      ? {
          ask_user: askTool,
          ...(toolset?.tools ?? {}),
          ...(canvasTools?.tools ?? {}),
          ...(artifactTools ?? {}),
          ...(dataRoot ? createVideoEditorTools(sessionId, dataRoot, canvasStore) : {}),
          ...(artifactStore && options.artifactReviews ? createPresentationTools({ sessionId, projectId: session.projectId, artifacts: artifactStore, reviews: options.artifactReviews, getReferences: () => currentPresentationRefs }) : {}),
          ...(artifactStore && options.artifactReviews ? createDocumentTools({ sessionId, projectId: session.projectId, artifacts: artifactStore, reviews: options.artifactReviews, getReferences: () => currentDocumentRefs }) : {}),
          ...(imageTools ?? {}),
          ...(videoTools ?? {}),
          ...(computerTools?.tools ?? {}),
          ...(scheduleTools ?? {}),
          ...(personalMemoryTools ? personalMemoryTools.tools : {}),
          ...(webTools ? webTools.tools : {}),
          ...(skill ? {} : createSkillTools({ skills: availableSkills })),
          ...(artifactStore ? createAttachmentTools({ sessionId, artifacts: artifactStore }) : {}),
          ...(dataRoot && !skill ? createSkillDraftTools({ dataRoot, getSkills: () => availableSkills, sessionId, permissionMode: runPermissionMode }) : {}),
          ...(skill?.contract && canvasStore && dataRoot ? createDeliveryTools({ skill, canvasStore, sessionId, dataRoot, artifactStore }) : {}),
        }
      : undefined;
  // MCP servers (user-level mcp.json): their tools join the set behind approval; clients are pooled per-session.
  const mcp = dataRoot && runCeiling !== 'readonly' ? await connectMcpTools({ dataRoot, sessionId, permissionMode: runPermissionMode, extraServers: pluginPack.mcpServers }) : undefined;
  trace.mark('mcpConnected');
  const hasMcpTools = mcp !== undefined && Object.keys(mcp.tools).length > 0;
  // Read-only research sub-agent: only the read tools, hook-wrapped like the main agent's. `model` is built below, hence the getters.
  const subagentRoleDirs = [workspacePath, dataRoot].filter((d): d is string => Boolean(d));
  const subagentRoles = subagentRoleDirs.length ? await loadSubagentRoles(subagentRoleDirs) : [];
  const subagentTools = toolset
    ? {
        ...createSubagentTool({
          getModel: () => model,
          tools: wrapToolsWithHooks(pickReadOnlyTools(toolset.tools), hookRunner),
          getProviderOptions: () => providerOptions,
          roles: subagentRoles,
        }),
        ...createBatchTool({
          getModel: () => model,
          tools: wrapToolsWithHooks(pickReadOnlyTools(toolset.tools), hookRunner),
          getProviderOptions: () => providerOptions,
          roles: subagentRoles,
          emit: (event) => emit(event),
        }),
      }
    : undefined;
  const tools = rawTools || hasMcpTools
    ? applySkillToolPolicy(applySkillToolPolicy(applyRunCeiling(serializeMutatingTools(wrapToolsWithHooks({ ...(rawTools ?? {}), ...(subagentTools ?? {}), ...(mcp?.tools ?? {}) } as NonNullable<typeof rawTools>, hookRunner)), runCeiling), skill?.allowedTools), parseAllowedTools(expert?.allowedTools))
    : undefined;

  const accounting = options.usageStore ?? canvasStore?.usage;
  const model = createOpenAiModel({ apiKey, modelId, baseUrl,
    fetch: observeRetries(quotaFetch(canvasStore ? llmSchedulerFor(canvasStore) : standaloneLlmScheduler, providerId,
      accounting ? usageFetch(accounting, { sessionId, providerId, model: modelId, category: 'llm', accepting: canvasStore ? () => !canvasWorkStopped(canvasStore) : undefined }) : undefined, true,
      () => trace.startModelCall()), { maxRetries: PROVIDER_MAX_RETRIES, announce: (text) => emit({ type: 'notice', tone: 'info', text }) }) });
  trace.mark('modelReady');

  // Reasoning models on gateways can burn 10-90s "thinking" before the first
  // token (measured: gpt-5.6-sol 12-98s default vs ~3s at effort=low). Send the
  // user-set effort; skip models that reject the param (official non-reasoning
  // gpt-4o/3.5 family 400s on unknown fields — gateways pass it through safely).
  const effort = settings.reasoningEffort;
  const official = isOfficialOpenAi(baseUrl);
  const reasoningUnsafe = /^gpt-(4o|4\.|3)/i.test(modelId);
  const providerOptions =
    effort && !(official && reasoningUnsafe)
      ? official
        ? { openai: { reasoningEffort: effort } }
        : { openaiCompatible: { reasoningEffort: effort } }
      : undefined;

  // Semantic memory recall: kicked off in parallel with stream setup, then
  // injected at the first step boundary so it never delays the first token.
  const recallPromise = Promise.all([
    workspacePath ? startMemoryRecall({ sessionId, workspaceRoot: workspacePath, model, query: userText }) : Promise.resolve([] as MemoryEntry[]),
    dataRoot ? startMemoryRecall({ sessionId, workspaceRoot: personalMemoryRoot(dataRoot), model, query: userText }) : Promise.resolve([] as MemoryEntry[]),
  ]).then(([fromWorkspace, fromPersonal]) => [...fromPersonal, ...fromWorkspace]);
  let recallInjected = false;
  let recallSettled: MemoryEntry[] | null = null;
  void withTimeout(recallPromise, RECALL_BUDGET.timeoutMs, []).then((entries) => {
    trace.mark('recallSettled');
    recallSettled = entries;
  });

  let lastSeenNodeCount = -1;
  const initialCanvas = canvasStore ? canvasStore.findCanvasBySession(sessionId) : null;
  const initialSnap = initialCanvas && canvasStore ? canvasStore.getSnapshot(initialCanvas.id) : null;
  if (initialSnap) lastSeenNodeCount = initialSnap.nodes.length;

  // A skill may set its own step limit (`max-turns`); otherwise the global one applies.
  const stepLimit = expert?.maxTurns ?? skill?.maxTurns ?? settings.agentStepLimit ?? MAX_AGENT_STEPS;
  // After a reply is cut off by the provider's output limit, later passes ask for a higher limit and keep it.
  let outputCap: number | undefined;
  const buildStream = (messages: ModelMessage[], signal: AbortSignal) =>
    streamText({
      model,
      ...(outputCap ? { maxOutputTokens: outputCap } : {}),
      instructions: mcp?.warnings?.length ? `${instructions}\n\n[MCP Notice]\n${mcp.warnings.map((w) => `- ${w}`).join('\n')}` : instructions,
      messages: compactModelMessages(messages),
      tools,
      stopWhen: tools ? isStepCount(stepLimit) : undefined,
      maxRetries: PROVIDER_MAX_RETRIES,
      timeout: PROVIDER_TIMEOUT,
      providerOptions,
      abortSignal: signal,
      prepareStep: async ({ messages: stepMessages, stepNumber }) => {
        if (stepNumber === 0 && mcp && mcp.warnings.length > 0) {
          const withheld = mcp.warnings.filter((w) => w.includes('withheld'));
          if (withheld.length > 0) {
            emit({
              type: 'notice',
              tone: 'warn',
              text: '已拦截发生变更的 MCP 工具：检测到工具定义自首次信任后被修改。可在「设置 → 扩展」中重新信任。',
            });
          }
        }
        trace.mark(`step${stepNumber}Prepare`);
        const compacted = compactModelMessages(stepMessages as ModelMessage[]);
        // Recall never holds the first token hostage: the first step waits a
        // short grace, later steps pick it up once it has settled.
        if (!recallInjected && recallSettled === null && stepNumber === 0) {
          const early = await withTimeout<MemoryEntry[] | null>(recallPromise, RECALL_BUDGET.firstStepGraceMs, null);
          if (early) recallSettled = early;
          trace.mark('recallFirstStepWaitDone');
        }
        if (!recallInjected && recallSettled !== null) {
          recallInjected = true;
          const recalled: MemoryEntry[] = recallSettled;
          if (recalled.length > 0) {
            compacted.push({ role: 'user', content: formatRecalledMemories(recalled) });
            // Mark seen only now — a recall that lost the timeout race stays
            // eligible for the next turn.
            markRecalled(
              sessionId,
              recalled.map((m) => m.fileName),
            );
            const items: MemoryItem[] = recalled.map((m) => ({
              file: m.fileName,
              name: m.name,
              description: m.description,
              type: m.type,
            }));
            emit({ type: 'memory', action: 'recalled', items });
            void memoryEventsStore?.append(sessionId, 'recalled', items);
          }
        }
        // Steer inbox drains at every step boundary (the AI SDK carries the
        // appended user messages forward through the rest of this pass).
        const steers = drainSteerInbox(sessionId);
        for (const steer of steers) {
          const steeredPresentation = splitPresentationContext(steer.content).refs;
          if (steeredPresentation.length) currentPresentationRefs = steeredPresentation;
          const steeredDocs = splitDocumentContext(steer.content).refs;
          if (steeredDocs.length) currentDocumentRefs = steeredDocs;
          const message: ChatMessage = {
            id: steer.id,
            role: 'user',
            content: steer.content,
            createdAt: new Date().toISOString(),
          };
          try {
            await sessionStore.appendMessage(sessionId, message);
          } catch (err) {
            console.warn(`[chat] steer persist failed session=${sessionId}: ${(err as Error).message}`);
          }
          emit({ type: 'user_message', id: message.id, content: message.content, createdAt: message.createdAt });
          const modelMessage: ModelMessage = {
            role: 'user',
            content: `${steer.system ? STEER_SYSTEM_PREFIX : STEER_PREFIX}\n${steer.content}`,
          };
          // `history` feeds any later continuation pass in this same turn.
          history.push(modelMessage);
          compacted.push(modelMessage);
        }
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
        trace.mark(`step${stepNumber}PrepareDone`);
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
            error: event.error !== undefined ? String(event.error) : undefined,
            resultHash: event.error === undefined ? hashResult(event.result) : undefined,
          });
          if (verdict && verdict.tier !== 'ok') {
            send({ type: 'tool_loop', tier: verdict.tier, reason: verdict.reason });
            if (verdict.tier === 'halt') setTimeout(() => abortChatTurn(sessionId), 0);
          }
        }
        send(event);
      };
    },
    createStream: (signal) => { trace.mark('streamCreated'); return buildStream(history, signal); },
    onEvent: (event) => trace.onEvent(event),
    onTurnTerminal: ({ outcome, text }) => {
      const reasoningLeak = hasReasoningLeak({ userText, reply: text });
      if (reasoningLeak) console.warn(`[chat] reasoning leaked into the reply session=${sessionId} model=${modelId}`);
      const turnTrajectory = trace.toTrajectoryMarkdown();
      if (dataRoot) {
        void writeTurnTrace(dataRoot, trace.finish({ outcome, text, reasoningLeak })).then(() => {
          if (settings.autoApplyHarnessLessons) void applyAllHarnessProposals(dataRoot);
        });
      }
      if (outcome !== 'completed') return;
      if (skill && dataRoot) {
        void (async () => {
          try {
            const latest = await sessionStore.get(sessionId);
            if (!latest) return;
            await recordSkillExperience({ dataRoot, skill, messages: latest.messages });
          } catch (err) {
            console.warn(`[skillRefiner] experience record failed skill=${skill.id}: ${(err as Error).message}`);
          }
        })();
      }
      if (!workspacePath) return;
      scheduleMemoryExtraction({
        workspaceRoot: workspacePath,
        model,
        userText,
        assistantText: text,
        turnTrajectory,
        onChanged: (wrote, deleted) => {
          if (wrote.length > 0) {
            emit({ type: 'memory', action: 'wrote', items: wrote });
            void memoryEventsStore?.append(sessionId, 'wrote', wrote);
          }
          if (deleted.length > 0) {
            emit({ type: 'memory', action: 'deleted', items: deleted });
            void memoryEventsStore?.append(sessionId, 'deleted', deleted);
          }
        },
      });
    },
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
        // canvas_budget checkpoints aren't real tool calls — args.tool names
        // the gated call (run_node / run_graph / pipeline) so the result lands
        // under the name the model actually invoked.
        const resultName =
          item.name === CANVAS_BUDGET_TOOL && typeof item.args.tool === 'string' ? item.args.tool : item.name;
        if (item.decision === 'deny') {
          emitToolResult({
            toolCallId: item.toolCallId,
            name: resultName,
            args: item.args,
            error: 'User denied this tool call',
          });
          continue;
        }
        const outcome =
          item.name === PROPOSE_SKILL_TOOL
            ? dataRoot ? await runApprovedSkillDraft({ dataRoot, getSkills: () => availableSkills }, item.args, item.toolCallId) : { error: 'Skills cannot be saved in this turn' }
          : ALWAYS_ASK_TOOLS.has(item.name) && item.name !== COMPUTER_CONFIRM_TOOL && item.name !== 'computer_app'
            ? await runApprovedScheduleTool(scheduleStore, sessionId, item.name, item.args, item.toolCallId)
            : item.name === COMPUTER_TOOL_NAME || item.name === COMPUTER_CONFIRM_TOOL || item.name === 'computer_app'
            ? ((await computerTools?.executeApproved(item.args)) ?? {
                error: 'Computer control is not enabled for this turn',
              })
            : item.name === HTTP_FETCH_TOOL || item.name === WEB_SEARCH_TOOL
              ? ((await webTools?.executeApproved(item.name, item.args)) ?? { error: 'Web access is not available in this turn' })
            : item.name.startsWith('personal_memory_')
              ? ((await personalMemoryTools?.executeApproved(item.name, item.args)) ?? { error: 'Personal memory is not available in this turn' })
            : item.name.startsWith(MCP_TOOL_PREFIX)
              ? ((await mcp?.executeApproved(item.name, item.args, item.toolCallId)) ?? {
                  error: 'This turn has no MCP tools',
                })
              : item.name === CANVAS_BUDGET_TOOL
                ? ((await canvasTools?.executeApproved(item.args, item.toolCallId)) ?? {
                    error: 'This turn has no canvas tools',
                  })
                : ((await toolset?.executeApproved(item.name, item.args)) ?? {
                    error: 'This turn has no workspace tools',
                  });
        // PreToolUse already ran when the model made the call; PostToolUse fires once the approved run finished.
        const hookNote = hookRunner && !outcome.error && resultName !== CANVAS_BUDGET_TOOL
          ? await hookRunner.post(resultName, item.args, outcome.result, signal)
          : undefined;
        emitToolResult({
          toolCallId: item.toolCallId,
          name: resultName,
          args: item.args,
          result: hookNote && outcome.result !== undefined ? (appendHookNote(outcome.result, hookNote) as string) : outcome.result,
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
      if (hitStepCap(finishReason)) {
        emit({ type: 'notice', tone: 'warn', text: `本轮已达到 ${stepLimit} 步上限而停止，任务可能未完成。`, action: 'continue' });
      }
      if (passIndex >= MAX_CONTINUE_PASSES) return null;
      const snap = getAssistant();
      const reason = shouldContinueAgentPass({
        text: snap.text,
        todos,
        finishReason,
        userText,
        delivered: hasDeliveredArtifact(snap.parts),
      });
      if (!reason) return null;
      if (reason === 'truncated') outputCap = nextOutputCap(outputCap, chatModelCapabilities(modelId).contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS);
      console.info(`[chat] continue pass reason=${reason} pass=${passIndex + 1}`);
      trace.onContinue(reason);
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
          parseToolOutput(sanitizeToolOutput(part.result ?? part.error ?? '')),
      })),
    } as ModelMessage,
  ];
}

/** The ApprovalRequiredError sentinel is internal — if it ever lands on a persisted part, the model must not see it (it narrates it as English reasoning text). */
function sanitizeToolOutput(value: string): string {
  return value.includes('REIZO_INTERACTION_REQUIRED')
    ? '(This tool paused for user input; the answer follows.)'
    : value;
}

function parseToolOutput(value: string): { type: 'json'; value: unknown } | { type: 'text'; value: string } {
  try {
    return { type: 'json', value: JSON.parse(value) };
  } catch {
    return { type: 'text', value };
  }
}
