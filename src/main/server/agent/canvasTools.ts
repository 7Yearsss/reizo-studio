import { tool } from 'ai';
import { createHash } from 'node:crypto';
import { createCanvasApplication } from '../canvas/application';
import { z } from 'zod';
import { CANVAS_IMAGE_MODELS, CANVAS_IMAGE_SIZES, defaultNodeBox } from '../../../shared/canvas';
import { cameraFromPreset } from '../../../shared/cameraMotion';
import { canvasMentionIds, serializeMention } from '../../../shared/resolveMentions';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from '../canvas/channel';
import { startImageNode } from '../canvas/imageExecutor';
import { nodeJobsFor, NodeJobsClosedError, type NodeJobSubmission } from '../canvas/nodeJobs';
import { canvasWorkSignal, canvasWorkStopped } from '../canvas/workLifecycle';
import { isCanvasJobTerminal, type CanvasJob } from '../../../shared/canvasJobs';
import { runAgentNode } from '../canvas/agentExecutor';
import { startVideoNode, replayVideoJob } from '../canvas/videoExecutor';
import { startAudioNode, replayAudioJob } from '../canvas/audioExecutor';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import type { ProviderStore } from '../storage/providerStore';
import { runGraph } from '../canvas/graphExecutor';
import { descendants, isImportedMedia } from '../canvas/graph';
import { readCanvasAsset } from '../canvas/assets';
import { findLikelyGaps } from './canvasGapCheck';
import { watchCanvasNodeJob } from './jobWatch';
import { CANVAS_BUDGET_ALLOW_BATCH, type CanvasBudget } from './canvasBudget';
import { ApprovalRequiredError, CANVAS_BUDGET_TOOL, requestBudgetCheckpoint } from './permissions';
import type { CanvasNode } from '../../../shared/canvas';

function nodeBrief(node: CanvasNode) {
  const params = node.params as Record<string, unknown>;
  return {
    id: node.id,
    type: node.type,
    title: node.title || null,
    runState: node.runState,
    dirty: node.dirty ?? false,
    prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
    instruction: typeof params.instruction === 'string' ? params.instruction : undefined,
    size: typeof params.size === 'string' ? params.size : undefined,
    // group containers: what they hold, so the agent can run / reason about one act
    memberIds: Array.isArray(params.memberIds) ? (params.memberIds as string[]) : undefined,
    // reference anchors: what the pin locks and how strictly
    role: typeof params.role === 'string' ? params.role : undefined,
    strength: typeof params.strength === 'string' ? params.strength : undefined,
    assets: node.output?.assets ?? [],
    activeAssetIndex: node.output?.activeAssetIndex ?? 0,
    versionCount: node.output?.assets?.length ?? 0,
    error: node.output?.error,
  };
}

const RUNNABLE_TYPES = new Set(['image', 'agent', 'video', 'audio']);
const SETTLE_GRACE_MS = 5_000;
const SETTLE_GRACE_POLL_MS = 250;

/** Node ids `runGraph` would execute for the same args (nodeIds whitelist > from-descendants > all runnable). */
function runGraphScope(
  canvasStore: CanvasStore,
  canvasId: string,
  from?: string,
  nodeIds?: string[],
): string[] {
  const snap = canvasStore.getSnapshot(canvasId);
  if (!snap) return [];
  let keep: Set<string>;
  if (nodeIds && nodeIds.length > 0) {
    keep = new Set(nodeIds);
  } else if (from) {
    keep = descendants(snap.edges, from);
    keep.add(from);
  } else {
    keep = new Set(snap.nodes.map((n) => n.id));
  }
  return snap.nodes
    .filter((n) => keep.has(n.id) && RUNNABLE_TYPES.has(n.type) && !isImportedMedia(n))
    .map((n) => n.id);
}

/**
 * Wait for `ids` to reach done/error (or the timeout), while `work` runs.
 * Returns the latest node snapshots — callers report per-node status instead
 * of the agent polling read_canvas in a loop and spamming the message stream.
 */
/**
 * Longest a waiting run_node/run_graph blocks the tool call. The provider
 * stream's chunk timeout (runtime PROVIDER_TIMEOUT.chunkMs, 3 min) keeps
 * ticking while a tool executes, so a wait past it aborts the whole turn.
 * Nodes still running at the deadline are handed to jobWatch instead.
 */
export const MAX_TOOL_WAIT_MS = 150_000;

const STILL_RUNNING_NOTE =
  'Some nodes are still rendering. Do not poll or re-run them — a system notice lands in this turn as each one settles.';

function waitBudget(timeoutMs: number | undefined): number {
  return Math.max(0, Math.min(timeoutMs ?? MAX_TOOL_WAIT_MS, MAX_TOOL_WAIT_MS));
}

/** A completed or aborted wait owns no deadline timer or host listener. */
function waitForWork(work: Promise<unknown>, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(finish, timeoutMs);
    signal.addEventListener('abort', finish, { once: true });
    void work.then(finish, finish);
  });
}

function storyboardImageOperation(base: string, nodeId: string): string {
  const id = `${base}:image:${nodeId}`;
  return id.length <= 256 ? id : `storyboard-image:${createHash('sha256').update(id).digest('hex')}`;
}

async function settleNodes(
  canvasStore: CanvasStore,
  canvasId: string,
  ids: string[],
  timeoutMs: number,
  work: Promise<unknown>,
): Promise<CanvasNode[]> {
  const read = (): CanvasNode[] => {
    if (canvasWorkStopped(canvasStore)) return [];
    const snap = canvasStore.getSnapshot(canvasId);
    const byId = new Map((snap?.nodes ?? []).map((n) => [n.id, n] as const));
    return ids.map((id) => byId.get(id)).filter((n): n is CanvasNode => Boolean(n));
  };
  if (ids.length === 0) return [];
  // Bound by the deadline, not by work — a hung provider must not pin the turn.
  const workSettled = Promise.resolve(work).then(
    () => true,
    () => true,
  );
  let completed = false;
  await waitForWork(workSettled.then(() => { completed = true; }), timeoutMs, canvasWorkSignal(canvasStore));
  const timedOut = !completed;
  if (!timedOut) {
    // Brief grace: a node whose promise just resolved may need a tick for the
    // store write (and any rerun's fresh 'running' state) to land.
    const graceDeadline = Date.now() + SETTLE_GRACE_MS;
    let nodes = read();
    while (nodes.some((n) => n.runState === 'running') && Date.now() < graceDeadline) {
      await waitForWork(new Promise<void>(() => undefined), SETTLE_GRACE_POLL_MS, canvasWorkSignal(canvasStore));
      nodes = read();
    }
    return nodes;
  }
  return read();
}

/**
 * Agent-facing canvas tools (slice C: `add_node`, `run_node`). Structure edits
 * are not gated (decision 10 — same as `todo_write`). `run_node` on an image
 * node is a paid call but agent-initiated inside a user-started turn, so it
 * runs directly here; the UI Run button is the pre-flight-confirmed path.
 */
/** Default placement when the caller gives no x/y: append to the right of
 * the current rightmost node, wrapping to a fresh row past ~2400px. Keeps
 * multiple agent-created nodes from stacking on top of each other. */
function nextFreeSpot(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 40, y: 40 };
  let rightmost = nodes[0];
  for (const n of nodes) if (n.x + n.w > rightmost.x + rightmost.w) rightmost = n;
  const x = rightmost.x + rightmost.w + 40;
  if (x + 360 > 2800) {
    const bottom = Math.max(...nodes.map((n) => n.y + n.h));
    return { x: 40, y: bottom + 40 };
  }
  return { x, y: rightmost.y };
}

export function createCanvasTools(options: {
  sessionId: string;
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  providerStore?: ProviderStore;
  /** Per-turn execution cap — created once per runChatTurn so an approval
   * suspension and resume share the same counters. */
  budget?: CanvasBudget;
}) {
  const { sessionId, canvasStore, settingsStore, dataRoot, providerStore, budget } = options;
  const canvasApp = createCanvasApplication(canvasStore);
  const sessionCanvas = () => {
    if (canvasWorkStopped(canvasStore)) throw new NodeJobsClosedError();
    return canvasStore.ensureCanvas(sessionId);
  };

  /** Options the resume path passes back into a gated execute so an approved
   * call isn't charged twice — it already consumed its slot when it threw. */
  type GateOptions = { toolCallId?: string; approvedReplay?: boolean };

  /** Gate a paid canvas run (image/video/graph). Check-only: if the call
   * would push executions past the ceiling this records a checkpoint prompt
   * and unwinds the step — approving it extends the ceiling so the resumed
   * call passes. `weight` is how many generations the call will burn: 1 for
   * run_node, the runnable scope for run_graph, so a single graph call can't
   * launder a whole batch as "one". Nothing is charged here — charging
   * happens in chargeExecute once the run is actually dispatched. */
  const gateExecute = (toolOptions: GateOptions | undefined, args: Record<string, unknown>, weight = 1): void => {
    if (!budget || toolOptions?.approvedReplay) return;
    if (!budget.wouldExceed('execute', weight)) return;
    const { execute } = budget.counts();
    const checkpointArgs = { ...args, executed: execute, ...(weight > 1 ? { planned: weight } : {}) };
    const ok = requestBudgetCheckpoint({
      sessionId,
      toolCallId: toolOptions?.toolCallId ?? '',
      args: checkpointArgs,
      onAllow: () => budget.extendExecute(weight + CANVAS_BUDGET_ALLOW_BATCH),
    });
    if (!ok) {
      throw new ApprovalRequiredError({
        toolCallId: toolOptions?.toolCallId ?? '',
        name: CANVAS_BUDGET_TOOL,
        args: checkpointArgs,
        kind: 'permission',
      });
    }
  };

  /** Charge the execute budget once a run is actually dispatched, and refund
   * every node that settles to `error` (rejected promise = whole weight back).
   * Failed generations must not eat the quota — a checkpoint should only fire
   * for work that actually ran. */
  const chargeExecute = (canvasId: string, scopeIds: string[], weight: number, running: Promise<unknown>, jobIds?: Map<string, string>): void => {
    if (!budget) return;
    budget.record('execute', weight);
    void running.then(
      () => {
        if (canvasWorkStopped(canvasStore)) return;
        const errs = scopeIds.filter((id) => {
          const jobId = jobIds?.get(id);
          if (!jobId) return canvasStore.getNode(canvasId, id)?.runState === 'error';
          const job = canvasStore.jobs.get(jobId);
          return job?.status === 'failed' || job && !job.submittedAt &&
            (job.status === 'cancelled' || job.status === 'interrupted');
        }).length;
        if (errs > 0) budget.record('execute', -errs);
      },
      () => {
        budget.record('execute', -weight);
      },
    );
  };

  const chargeJob = (submission: NodeJobSubmission): void => {
    if (!budget) return;
    budget.record('execute');
    void submission.completion.then(() => {
      if (canvasWorkStopped(canvasStore)) return;
      const job = canvasStore.jobs.get(submission.job.id);
      if (job?.status === 'failed' || job && !job.submittedAt &&
        (job.status === 'cancelled' || job.status === 'interrupted')) budget.record('execute', -1);
    }, () => { budget.record('execute', -1); });
  };

  const jobOutcome = async (submission: NodeJobSubmission, wait: boolean | undefined, timeoutMs: number | undefined,
    replayed: boolean, repeatNote?: string) => {
    if (wait !== false && !isCanvasJobTerminal(submission.job.status)) {
      await waitForWork(submission.completion, waitBudget(timeoutMs), canvasWorkSignal(canvasStore));
    }
    if (canvasWorkStopped(canvasStore)) {
      return { ok: false, id: submission.job.nodeId, status: 'error', jobId: submission.job.id,
        jobStatus: 'interrupted', error: 'Canvas work stopped' };
    }
    const job: CanvasJob = canvasStore.jobs.get(submission.job.id) ?? submission.job;
    const pending = !isCanvasJobTerminal(job.status);
    if (!replayed && pending && canvasStore.jobs.isCurrent(job.id)) {
      watchCanvasNodeJob(sessionId, job.canvasId, canvasStore, [job.nodeId], job.id);
    }
    const label = job.nodeType === 'video' ? 'Video' : job.nodeType === 'audio' ? 'Audio' : 'Image';
    const error = job.error ?? (job.status === 'cancelled'
      ? job.cancelReason === 'superseded' ? `${label} job was superseded by a newer run.` : `${label} job was cancelled.`
      : job.status === 'interrupted' ? `${label} job was interrupted; check it before retrying.` : undefined);
    const note = pending && replayed ? 'This saved media job is still pending; it was not submitted again.'
      : pending && wait !== false ? STILL_RUNNING_NOTE : repeatNote;
    return {
      ok: pending || job.status === 'succeeded', id: job.nodeId,
      status: pending ? 'running' : job.status === 'succeeded' ? 'done' : 'error',
      jobId: job.id, jobStatus: job.status, error,
      ...(job.result ? { output: job.result } : {}),
      ...(note ? { note } : {}),
    };
  };

  /** Per-turn pipeline dedup: a director model that re-issues the same
   * storyboard after a checkpoint resume must not rebuild the deck — return
   * the ids already on the canvas. */
  const planSigs = new Map<string, { noteId: string; planNodeIds: string[] }>();

  /** Loop fuse: re-running the same node whose params haven't moved is burning
   * a generation for nothing — warn once, then refuse until something changed. */
  const runSigs = new Map<string, { sig: string; repeats: number }>();
  const unchangedRunVerdict = (node: CanvasNode): { note?: string; blocked?: true } => {
    const sig = JSON.stringify(node.params ?? {});
    const prev = runSigs.get(node.id);
    if (prev?.sig !== sig) {
      runSigs.set(node.id, { sig, repeats: 1 });
      return {};
    }
    prev.repeats += 1;
    if (prev.repeats === 2) {
      return {
        note: 'warning: this node was just run with identical parameters — the output will not change unless inputs or params move. Skipping is free; only proceed if the user explicitly asked for a re-roll.',
      };
    }
    return { blocked: true };
  };

  const tools = {
    list_assets: tool({
      description: 'List saved image, video or audio versions available for reuse across canvases. Reuse does not generate new media; choose a specific assetId.',
      inputSchema: z.object({ kind: z.enum(['image', 'video', 'audio']).optional(), limit: z.number().int().min(1).max(100).optional() }),
      execute: async (input) => {
        sessionCanvas();
        return { assets: canvasStore.assets.recent({ kind: input.kind, limit: input.limit ?? 20 }).map((asset) => ({
          assetId: asset.id, kind: asset.kind, source: asset.source, model: asset.model, createdAt: asset.createdAt,
          label: asset.nodeId ? canvasStore.getNode(asset.canvasId, asset.nodeId)?.title || asset.kind : asset.kind,
        })) };
      },
    }),
    reuse_asset: tool({
      description: 'Reuse a saved assetId in this canvas without generation. asReference:true creates a fixed image anchor independent of its original producer; connect it to image/video nodes. Otherwise adds editable imported image/video/audio media.',
      inputSchema: z.object({ assetId: z.string().min(1), asReference: z.boolean().optional(), title: z.string().optional(),
        x: z.number().finite().optional(), y: z.number().finite().optional(), operationId: z.string().optional() }),
      execute: async (input, toolOptions) => {
        const canvas = sessionCanvas();
        const { operationId: explicit, ...placement } = input;
        const operationId = explicit ?? toolOptions?.toolCallId;
        const request = { kind: 'reuse_asset', input: placement };
        const receipt = canvasApp.replay<ReturnType<typeof canvasApp.reuseAsset>>(canvas.id, request, operationId);
        if (receipt) return { ok: true, id: receipt.node.id, canvasId: canvas.id, type: receipt.node.type, assetId: receipt.asset.id };
        const asset = canvasStore.assets.get(input.assetId);
        if (!asset) throw new CanvasJobStoreError('素材不存在，请重新选择', 404);
        const bytes = await readCanvasAsset(dataRoot, asset.path);
        if (createHash('sha256').update(bytes).digest('hex') !== asset.contentHash) throw new CanvasJobStoreError('素材文件已发生变化，请重新导入', 409);
        const result = canvasApp.reuseAsset(canvas.id, placement, operationId);
        budget?.record('structural');
        return { ok: true, id: result.node.id, canvasId: canvas.id, type: result.node.type, assetId: result.asset.id };
      },
    }),
    open_canvas: tool({
      description:
        'Open and display the canvas panel in the user interface. Call this whenever the user asks to see, open, or switch to the canvas.',
      inputSchema: z.object({}),
      execute: async () => {
        const canvas = sessionCanvas();
        return { ok: true, canvasId: canvas.id };
      },
    }),

    add_node: tool({
      description:
        'Add a node to this session\'s canvas. type "image" generates an image from `prompt`; type "agent" is a research/critique sub-task described by `instruction`; type "video" generates video from `prompt`; type "note" is a screenplay/script sticky note; type "anchor" is a reference pin (the user drops an image onto it) whose `role`/`strength` lock a character or style across shots; type "audio" synthesizes a speech (TTS) track from `prompt` — the result is a standalone audio asset; wiring it into a video node\'s `audio_in` handle only marks the association (the video itself stays silent until a merge/export step exists). In an image/video `prompt` you may embed inline references to other canvas nodes as `@[label](canvas:<nodeId>)` — at run time each becomes an ordered reference image (`<<<image 1>>>`, ...) drawn from that node\'s latest output, so you can say e.g. "把 @[主角定妆](canvas:abc123) 放进 @[雨夜街道](canvas:def456)". Each referenced node is also wired in as an upstream edge automatically (returned as `wiredFrom`), so `run_graph` renders it first — no `connect_nodes` needed for those. Returns the new node id. The canvas panel opens automatically.',
      inputSchema: z.object({
        type: z.enum(['image', 'agent', 'video', 'note', 'anchor', 'audio']),
        prompt: z.string().optional().describe('Prompt (type "image", "video", or "note").'),
        size: z.enum(CANVAS_IMAGE_SIZES as [string, ...string[]]).optional(),
        model: z
          .string()
          .optional()
          .describe(
            `type "image": model id. Available: ${CANVAS_IMAGE_MODELS.map((m) => m.id).join(', ')}.`,
          ),
        instruction: z.string().optional().describe('Task description (type "agent").'),
        role: z.enum(['character', 'style', 'content']).optional().describe('type "anchor": what the pin locks.'),
        strength: z.enum(['low', 'mid', 'high']).optional().describe('type "anchor": how strictly to hold it.'),
        title: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        draft: z
          .boolean()
          .optional()
          .describe(
            'type "image": run on the fast draft model for a quick preview the user can upgrade with 精渲. Leave unset for final-quality nodes and consistency anchors (identity sheets, character refs, scenes).',
          ),
        asProposal: z.boolean().optional().describe('When true, marks the node as a Ghost Proposal awaiting user review in ProposalBar.'),
        operationId: z.string().optional().describe('Idempotent operation ID for tracking and batched undo.'),
      }),
      execute: async (input) => {
        budget?.record('structural');
        const canvas = sessionCanvas();
        const result = canvasApp.batch(canvas.id, { kind: 'agent_add_node', input }, () => {
          const box = defaultNodeBox(input.type);
          const params =
            input.type === 'image'
              ? {
                  prompt: input.prompt ?? '',
                  size: input.size ?? '1024x1024',
                  ...(input.model ? { model: input.model } : {}),
                  ...(input.draft ? { draft: true } : {}),
                }
              : input.type === 'video'
                ? { prompt: input.prompt ?? '', duration: '5s', ratio: '16:9', cameraMotion: 'none' }
                : input.type === 'note'
                  ? { content: input.instruction ?? input.prompt ?? '', color: 'amber' }
                  : input.type === 'anchor'
                    ? { role: input.role ?? 'character', strength: input.strength ?? 'mid' }
                    : input.type === 'audio'
                      ? { prompt: input.prompt ?? '', format: 'mp3' }
                      : { instruction: input.instruction ?? '' };
          const existing = canvasStore.getSnapshot(canvas.id).nodes;
          const collides = (x: number, y: number) =>
            existing.some((n) => x < n.x + n.w && x + box.w > n.x && y < n.y + n.h && y + box.h > n.y);
          const spot =
            typeof input.x === 'number' && typeof input.y === 'number' && !collides(input.x, input.y)
              ? { x: input.x, y: input.y }
              : nextFreeSpot(existing);
          const { node } = canvasApp.addNode(canvas.id, {
            type: input.type,
            x: spot.x,
            y: spot.y,
            w: box.w,
            h: box.h,
            title: input.title ?? '',
            params,
          });
          const wiredFrom: string[] = [];
          if (input.type === 'image' || input.type === 'video') {
            for (const sourceId of canvasMentionIds(input.prompt ?? '')) {
              if (!existing.some((n) => n.id === sourceId)) continue;
              const res = canvasApp.addEdge(canvas.id, { sourceId, targetId: node.id });
              if (res.edge && res.rev !== undefined) {
                wiredFrom.push(sourceId);
              }
            }
          }
          return {
            id: node.id,
            canvasId: canvas.id,
            type: node.type,
            asProposal: Boolean(input.asProposal),
            operationId: input.operationId,
            ...(wiredFrom.length > 0 ? { wiredFrom } : {}),
          };
        }, input.operationId);
        if (input.asProposal) {
          getCanvasChannel(canvas.id).broadcast(canvasStore.getCanvas(canvas.id).liveRevision, {
            type: 'proposal_created', nodeIds: [result.id], operationId: input.operationId,
          });
        }
        return result;
      },
    }),

    create_storyboard_pipeline: tool({
      description:
        'Autonomous Director: generate a complete multi-scene cinematic storyboard pipeline on the canvas from a narrative request. Automatically creates an overview script note, sequential keyframe image nodes, camera-motion video nodes, and establishes links between them in a clean horizontal timeline layout.',
      inputSchema: z.object({
        storyTitle: z.string().describe('Title of the storyboard or film concept'),
        ratio: z.enum(['16:9', '9:16', '1:1']).default('16:9').describe('Aspect ratio for the scenes'),
        scenes: z
          .array(
            z.object({
              title: z.string().describe('Scene title e.g. "第 1 幕：雨夜追踪"'),
              script: z.string().describe('Script lines or scene narrative description'),
              imagePrompt: z.string().describe('Visual prompt for the keyframe image'),
              videoPrompt: z.string().describe('Dynamic camera motion and motion description for video'),
              camera: z
                .enum(['none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'orbit'])
                .default('none')
                .describe('Camera motion technique'),
              duration: z.enum(['5s', '10s']).default('5s'),
            }),
          )
          .min(1)
          .max(8)
          .describe('List of scenes in chronological order'),
        autoRunFirstScene: z.boolean().default(false).describe('Whether to immediately trigger generation of the first scene'),
        carryReference: z
          .boolean()
          .default(true)
          .describe(
            'When true, every scene after the first gets an inline @[镜头1关键帧](canvas:<id>) reference appended to its image and video prompts so the character / style stays consistent across shots.',
          ),
        asProposal: z.boolean().default(false).describe('When true, marks all created nodes as Ghost Proposals awaiting user approval in ProposalBar.'),
        operationId: z.string().optional().describe('Idempotent operation ID for tracking and batched undo.'),
      }),
      execute: async (input, toolOptions) => {
        const canvas = sessionCanvas();
        const channel = getCanvasChannel(canvas.id);
        // Same-storyboard re-issue (typically the model retrying right after a
        // checkpoint resume) — don't rebuild; hand back what's already there.
        const planSig = JSON.stringify({
          t: input.storyTitle,
          r: input.ratio,
          s: input.scenes.map((sc) => [sc.title, sc.imagePrompt, sc.videoPrompt]),
        });
        const prevPlan = planSigs.get(planSig);
        if (prevPlan) {
          return {
            ok: true,
            deduped: true,
            storyTitle: input.storyTitle,
            totalScenes: input.scenes.length,
            noteId: prevPlan.noteId,
            planNodeIds: prevPlan.planNodeIds,
            summary: '这套分镜本轮已经铺在画布上了（重复调用检测）——不要再次调用本工具。直接对现有节点用 run_node 逐个执行，或先 update_node 调整参数再跑。',
          };
        }
        // A pipeline call creates many nodes — count them against the loose
        // structural cap so a runaway planner still trips the breaker.
        for (let i = 0; i < input.scenes.length * 2 + 1; i++) budget?.record('structural');
        const mediaModels = (await settingsStore.get()).mediaModels;
        if (canvasWorkStopped(canvasStore)) throw new NodeJobsClosedError();

        const replayed = Boolean(input.operationId && canvasStore.getReceipt(canvas.id, input.operationId));
        const { noteNode, imageNodes, createdSceneNodeIds, allCreated, rNote } = canvasApp.batch(canvas.id, { kind: 'storyboard', input }, () => {
          // 1. Create Overview Note card
          const scriptOverview = `# ${input.storyTitle}\n\n画幅比例: ${input.ratio}\n分镜总数: ${input.scenes.length}\n\n${input.scenes
            .map((s, idx) => `### 分镜 ${idx + 1}: ${s.title}\n${s.script}`)
            .join('\n\n')}`;

          const { rev: rNote, node: noteNode } = canvasApp.addNode(canvas.id, {
            type: 'note',
            x: 40,
            y: 60,
            w: 300,
            h: 420,
            title: `${input.storyTitle} (剧本大纲)`,
            params: { content: scriptOverview, color: 'amber' },
          });


          const createdSceneNodeIds: string[] = [];
          const imageNodes: CanvasNode[] = [];
          const videoNodes: CanvasNode[] = [];

          // 2. Create sequential scenes
          for (let i = 0; i < input.scenes.length; i++) {
            const sc = input.scenes[i];
            const colX = 380 + i * 360;

            // Character / style continuity: point later shots back at shot 1's keyframe.
            const continuity =
              input.carryReference && i > 0 && imageNodes[0]
                ? ` 保持 ${serializeMention('镜头1关键帧', imageNodes[0].id)} 中主体的外形、服装与风格一致。`
                : '';

            // Image Node (Keyframe)
            const imgBox = defaultNodeBox('image');
            const { node: imgNode } = canvasApp.addNode(canvas.id, {
              type: 'image',
              x: colX,
              y: 60,
              w: imgBox.w,
              h: imgBox.h,
              title: `镜头 ${i + 1} · 关键帧`,
              params: {
                prompt: sc.imagePrompt + continuity,
                size: input.ratio === '9:16' ? '1024x1536' : '1536x1024',
                ...(mediaModels?.image ? { model: mediaModels.image } : {}),
              },
            });
            imageNodes.push(imgNode);
            createdSceneNodeIds.push(imgNode.id);

            // Video Node (Motion)
            const vidBox = defaultNodeBox('video');
            const { node: vidNode } = canvasApp.addNode(canvas.id, {
              type: 'video',
              x: colX,
              y: 480,
              w: vidBox.w,
              h: vidBox.h,
              title: `镜头 ${i + 1} · 运镜`,
              params: {
                prompt: sc.videoPrompt + continuity,
                duration: sc.duration,
                ratio: input.ratio,
                cameraMotion: sc.camera,
                camera: cameraFromPreset(sc.camera),
                ...(mediaModels?.video ? { model: mediaModels.video } : {}),
              },
            });
            videoNodes.push(vidNode);
            createdSceneNodeIds.push(vidNode.id);

            // Edge: Image -> Video (start_frame)
            const { edge } = canvasApp.addEdge(canvas.id, {
              sourceId: imgNode.id,
              targetId: vidNode.id,
              targetHandle: 'start_frame',
            });
            if (!edge) throw new Error('Storyboard frame connection failed');

            // If note is next to scene 1, connect note to image 1
            if (i === 0) {
              const noteEdgeResult = canvasApp.addEdge(canvas.id, {
                sourceId: noteNode.id,
                targetId: imgNode.id,
              });
              if (noteEdgeResult.error) throw new Error(`Storyboard connection failed: ${noteEdgeResult.error}`);
            } else {
              // Connect previous video to current image for visual continuity
              const prevVid = videoNodes[i - 1];
              const seqEdgeResult = canvasApp.addEdge(canvas.id, {
                sourceId: prevVid.id,
                targetId: imgNode.id,
              });
              if (seqEdgeResult.error) throw new Error(`Storyboard connection failed: ${seqEdgeResult.error}`);
            }
          }

          const allCreated = [noteNode.id, ...createdSceneNodeIds];
          return { noteNode, imageNodes, createdSceneNodeIds, allCreated, rNote };
        }, input.operationId);
        channel.broadcast(canvasStore.getCanvas(canvas.id).liveRevision, { type: 'phase', label: '编排完成', step: 3, total: 3 });
        planSigs.set(planSig, { noteId: noteNode.id, planNodeIds: allCreated });
        if (!replayed && input.autoRunFirstScene && imageNodes.length > 0) {
          const operationId = storyboardImageOperation(input.operationId ?? toolOptions?.toolCallId ?? noteNode.id, imageNodes[0].id);
          const saved = nodeJobsFor(canvasStore).replay(canvas.id, imageNodes[0].id, operationId);
          if (!saved) gateExecute(toolOptions, {
            tool: 'create_storyboard_pipeline',
            scenes: input.scenes.length,
            planNodeIds: allCreated,
            operationId: input.operationId,
          });
          if (!saved) {
            const accepted = startImageNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node: imageNodes[0], operationId });
            chargeJob(accepted);
          }
        }

        if (input.asProposal) {
          channel.broadcast(rNote, {
            type: 'proposal_created',
            nodeIds: allCreated,
            operationId: input.operationId,
          });
        }

        return {
          ok: true,
          storyTitle: input.storyTitle,
          totalScenes: input.scenes.length,
          noteId: noteNode.id,
          createdNodeIds: createdSceneNodeIds,
          asProposal: Boolean(input.asProposal),
          operationId: input.operationId,
          summary: `已在画布上生成全套分镜编排流水线（包含 1 个剧本大纲卡、${input.scenes.length} 个关键帧图片卡、${input.scenes.length} 个运镜视频卡，并已完成全流水线自动连线）。`,
        };
      },
    }),

    run_node: tool({
      description:
        'Run a canvas node by id. An image or video node generates the media; an audio node synthesizes its speech track; an agent node runs a read-only research/critique pass. By default waits for the node to finish and returns its outcome — pass wait:false for long jobs (video, big batches): the tool returns immediately and a system notice lands in this turn when the node settles.',
      inputSchema: z.object({
        id: z.string(),
        operationId: z.string().optional().describe('Reuse this id only when retrying the same image, video or audio request.'),
        wait: z.boolean().optional().describe('Wait for the run to finish (default true).'),
        timeoutMs: z.number().optional().describe(`Max wait in ms (default and cap ${MAX_TOOL_WAIT_MS}); nodes still running then report back via a system notice.`),
      }),
      execute: async ({ id, wait, timeoutMs, operationId }, toolOptions) => {
        const canvas = sessionCanvas();
        const mediaOperationId = operationId ?? toolOptions?.toolCallId;
        const existing = mediaOperationId ? canvasStore.jobs.findByOperationId(canvas.id, mediaOperationId) : null;
        const saved = existing?.nodeType === 'video'
          ? replayVideoJob(canvasStore, canvas.id, id, mediaOperationId)
          : existing?.nodeType === 'audio' ? replayAudioJob(canvasStore, canvas.id, id, mediaOperationId)
            : nodeJobsFor(canvasStore).replay(canvas.id, id, mediaOperationId);
        if (saved) return jobOutcome(saved, wait, timeoutMs, true);
        const node = canvasStore.getNode(canvas.id, id);
        if (!node) return { error: `No canvas node "${id}"` };
        if (!RUNNABLE_TYPES.has(node.type)) return { ok: false, id, status: node.runState, error: `Node type "${node.type}" cannot run` };
        if (isImportedMedia(node)) return { ok: true, id, status: 'done', output: node.output, note: '已有素材可以直接引用；填写提示词后可生成新版本。' };
        if (node.type === 'audio' && !providerStore) throw new CanvasJobStoreError('Audio provider store is unavailable');
        // A user-approved replay explicitly wants this run — the fuse would
        // refuse an already-twice-seen params set and silently eat the approval.
        const fuse = (toolOptions as GateOptions | undefined)?.approvedReplay ? {} : unchangedRunVerdict(node);
        if (fuse.blocked) {
          return {
            ok: false,
            id,
            status: node.runState,
            error:
              'refused: this node has been re-run repeatedly with identical parameters and no upstream change. Change the prompt/inputs (update_node, connect_nodes) or explain why a re-roll is intended.',
          };
        }
        const repeatNote = fuse.note;
        // Gate after validation + fuse: a refused call must not trip a checkpoint.
        gateExecute(toolOptions, { tool: 'run_node', id, wait, timeoutMs, ...(operationId ? { operationId } : {}) });
        if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
          const start = node.type === 'image' ? startImageNode : node.type === 'video' ? startVideoNode : startAudioNode;
          const accepted = start({ canvasStore, settingsStore, providerStore, dataRoot, canvasId: canvas.id, node, operationId: mediaOperationId });
          chargeJob(accepted);
          return jobOutcome(accepted, wait, timeoutMs, false, repeatNote);
        }
        const running = runAgentNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node });
        chargeExecute(canvas.id, [id], 1, running);
        if (wait === false) {
          void running.catch((): undefined => undefined);
          // Completion lands in this turn as a system note — the agent can
          // keep working and gets told instead of polling read_canvas.
          watchCanvasNodeJob(sessionId, canvas.id, canvasStore, [id]);
          return { ok: true, id, status: 'running', ...(repeatNote ? { note: repeatNote } : {}) };
        }
        const settled = await settleNodes(canvasStore, canvas.id, [id], waitBudget(timeoutMs), running);
        if (canvasWorkStopped(canvasStore)) return { ok: false, id, status: 'error', error: 'Canvas work stopped' };
        const n = settled[0];
        const stillRunning = !n || n.runState === 'running';
        if (stillRunning) watchCanvasNodeJob(sessionId, canvas.id, canvasStore, [id]);
        return {
          ok: n?.runState !== 'error',
          id,
          status: n?.runState ?? 'running',
          error: n?.output?.error,
          ...(stillRunning ? { note: STILL_RUNNING_NOTE } : repeatNote ? { note: repeatNote } : {}),
        };
      },
    }),

    run_graph: tool({
      description:
        'Run the canvas as a pipeline. Independent nodes in the same dependency layer run in parallel; a node starts only after its inputs are done. Pass `from` to run that node and everything downstream, or `nodeIds` to run only an explicit set (e.g. the members of one group). `from` and `nodeIds` are mutually exclusive — `nodeIds` wins. By default waits for the whole run and returns every node\'s outcome — pass wait:false for long jobs: a system notice lands in this turn as each node settles.',
      inputSchema: z.object({
        from: z.string().optional(),
        nodeIds: z
          .array(z.string())
          .optional()
          .describe("Explicit whitelist of node ids to run. Pass a group node's memberIds to run just that group."),
        wait: z.boolean().optional().describe('Wait for the run to finish (default true).'),
        timeoutMs: z.number().optional().describe(`Max wait in ms (default and cap ${MAX_TOOL_WAIT_MS}); nodes still running then report back via a system notice.`),
        intent: z
          .string()
          .optional()
          .describe('One line on what this run should deliver (e.g. "15s 口播广告") — used for a completeness sanity check before dispatch.'),
      }),
      execute: async ({ from, nodeIds, wait, timeoutMs, intent }, toolOptions) => {
        const canvas = sessionCanvas();
        if (from && !canvasStore.getNode(canvas.id, from)) return { error: `No canvas node "${from}"` };
        const missing = (nodeIds ?? []).filter((id) => !canvasStore.getNode(canvas.id, id));
        if (missing.length > 0) return { error: `No canvas node(s) ${missing.join(', ')}` };
        const scope = runGraphScope(canvasStore, canvas.id, from, nodeIds);
        const warnings = findLikelyGaps(canvasStore, canvas.id, scope, intent);
        gateExecute(toolOptions, { tool: 'run_graph', from, nodeIds, wait, timeoutMs }, Math.max(scope.length, 1));
        const jobIds = new Map<string, string>();
        let background = wait === false;
        const running = runGraph({
          canvasStore,
          settingsStore,
          dataRoot,
          canvasId: canvas.id,
          fromNodeId: from,
          nodeIds,
          providerStore,
          onJob: ({ job }) => {
            jobIds.set(job.nodeId, job.id);
            if (background) watchCanvasNodeJob(sessionId, canvas.id, canvasStore, [job.nodeId], job.id);
          },
        });
        if (scope.length > 0) chargeExecute(canvas.id, scope, scope.length, running, jobIds);
        if (wait === false) {
          void running.catch((): undefined => undefined);
          const legacy = scope.filter((id) => {
            const type = canvasStore.getNode(canvas.id, id)?.type;
            return type === 'agent';
          });
          watchCanvasNodeJob(sessionId, canvas.id, canvasStore, legacy);
          return {
            ok: true,
            status: 'running',
            scope: nodeIds ? 'nodeIds' : from ? 'from' : 'all',
            ...(warnings.length > 0 ? { warnings } : {}),
          };
        }
        await waitForWork(running, waitBudget(timeoutMs), canvasWorkSignal(canvasStore));
        if (canvasWorkStopped(canvasStore)) return { ok: false, status: 'error', error: 'Canvas work stopped' };
        background = true;
        const settled = scope.map((id) => {
          const node = canvasStore.getNode(canvas.id, id);
          const jobId = jobIds.get(id);
          const job = jobId ? canvasStore.jobs.get(jobId) : null;
          if (job && !isCanvasJobTerminal(job.status)) watchCanvasNodeJob(sessionId, canvas.id, canvasStore, [id], job.id);
          return { id, title: (job?.input.node as { title?: string } | undefined)?.title ?? node?.title,
            status: job ? !isCanvasJobTerminal(job.status) ? 'running' : job.status === 'succeeded' ? 'done' : 'error' : node?.runState ?? 'error',
            error: job ? job.error ?? (job.status === 'cancelled' ? 'Media job was cancelled or superseded.' : undefined) : node?.output?.error,
            ...(job ? { jobId: job.id, jobStatus: job.status } : {}) };
        });
        const pendingIds = settled.filter((n) => n.status !== 'done' && n.status !== 'error').map((n) => n.id);
        watchCanvasNodeJob(sessionId, canvas.id, canvasStore, pendingIds.filter((id) => !jobIds.has(id)));
        return {
          ok: settled.every((n) => n.status === 'done'),
          status: pendingIds.length > 0 ? 'running' : 'done',
          ...(pendingIds.length > 0 ? { note: STILL_RUNNING_NOTE } : {}),
          results: settled,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      },
    }),

    group_nodes: tool({
      description:
        'Wrap existing canvas nodes in a group container: a labelled, coloured box that can be dragged as a unit, locked, focused, and run on its own. Use it to keep one storyboard act / scene set tidy after building a multi-shot pipeline. Returns the new group node id.',
      inputSchema: z.object({
        nodeIds: z.array(z.string()).min(1).describe('Ids of the nodes to put in the group.'),
        title: z.string().optional().describe('Group label, e.g. "第 1 幕：雨夜追踪".'),
        color: z.string().optional().describe('Hex colour for the container, e.g. "#3b82f6".'),
      }),
      execute: async ({ nodeIds, title, color }) => {
        const canvas = sessionCanvas();
        const members = nodeIds
          .map((id) => canvasStore.getNode(canvas.id, id))
          .filter((n): n is CanvasNode => Boolean(n) && n!.type !== 'group');
        if (members.length === 0) return { error: 'None of those node ids exist on the canvas' };

        const padding = 28;
        const header = 42;
        const minX = Math.min(...members.map((n) => n.x));
        const minY = Math.min(...members.map((n) => n.y));
        const maxX = Math.max(...members.map((n) => n.x + n.w));
        const maxY = Math.max(...members.map((n) => n.y + n.h));

        const { node } = canvasApp.addNode(canvas.id, {
          type: 'group',
          x: Math.round(minX - padding),
          y: Math.round(minY - header),
          w: Math.round(maxX - minX + padding * 2),
          h: Math.round(maxY - minY + header + padding),
          title: title ?? '分镜组',
          params: { memberIds: members.map((n) => n.id), color: color ?? '#3b82f6', locked: false },
        });
        return { id: node.id, memberIds: members.map((n) => n.id) };
      },
    }),

    read_canvas: tool({
      description: 'List every node on this session\'s canvas with its type, run state, prompt/instruction and outputs, plus the edges between them.',
      inputSchema: z.object({}),
      execute: async () => {
        const canvas = canvasStore.findCanvasBySession(sessionId);
        if (!canvas) return { nodes: [], edges: [] };
        const snap = canvasStore.getSnapshot(canvas.id);
        return {
          nodes: (snap?.nodes ?? []).map(nodeBrief),
          edges: (snap?.edges ?? []).map((e) => ({ source: e.sourceId, target: e.targetId })),
        };
      },
    }),

    read_node: tool({
      description: 'Read one canvas node in full (params, run state, output assets/error).',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const canvas = canvasStore.findCanvasBySession(sessionId);
        const node = canvas ? canvasStore.getNode(canvas.id, id) : null;
        return node ? nodeBrief(node) : { error: `No canvas node "${id}"` };
      },
    }),

    update_node: tool({
      description: 'Change a canvas node\'s params. For an image node pass `prompt`, `size`, and/or `model`; for an agent node pass `instruction`; for a video node pass `prompt` and/or `camera` (structured camera motion, each axis −10..10). Also renames via `title`. An image/video `prompt` may embed `@[label](canvas:<nodeId>)` references to other nodes — each resolves to an ordered reference image from that node\'s output at run time. Does not re-run the node.',
      inputSchema: z.object({
        id: z.string(),
        prompt: z.string().optional(),
        size: z.enum(CANVAS_IMAGE_SIZES as [string, ...string[]]).optional(),
        model: z
          .string()
          .optional()
          .describe(
            `type "image": model id. Available: ${CANVAS_IMAGE_MODELS.map((m) => m.id).join(', ')}.`,
          ),
        draft: z
          .boolean()
          .optional()
          .describe('type "image": true = draft model preview tier; false = back to the quality model (精渲).'),
        instruction: z.string().optional(),
        title: z.string().optional(),
        camera: z
          .object({
            horizontal: z.number().min(-10).max(10).optional(),
            vertical: z.number().min(-10).max(10).optional(),
            pan: z.number().min(-10).max(10).optional(),
            tilt: z.number().min(-10).max(10).optional(),
            roll: z.number().min(-10).max(10).optional(),
            zoom: z.number().min(-10).max(10).optional(),
          })
          .optional()
          .describe('Video node only. Camera motion by axis; negative = left/down/out/ccw, positive = right/up/in/cw.'),
        operationId: z.string().optional().describe('Idempotent operation ID.'),
      }),
      execute: async ({ id, prompt, size, model, draft, instruction, title, camera, operationId }) => {
        const canvas = sessionCanvas();
        return canvasApp.batch(canvas.id, { kind: 'agent_update_node', id, prompt, size, model, draft, instruction, title, camera }, () => {
          const node = canvasStore.getNode(canvas.id, id);
          if (!node) return { error: `No canvas node "${id}"` };
          const params = { ...(node.params as Record<string, unknown>) };
          if (prompt !== undefined) params.prompt = prompt;
          if (size !== undefined) params.size = size;
          if (model !== undefined) params.model = model;
          if (draft !== undefined) params.draft = draft;
          if (instruction !== undefined) params.instruction = instruction;
          if (camera !== undefined) params.camera = camera;
          const res = canvasApp.updateNode(canvas.id, id, {
            params,
            ...(title !== undefined ? { title } : {}),
          });
          if (!res) return { error: `No canvas node "${id}"` };
          return { id, params: res.node.params, operationId };
        }, operationId);
      },
    }),

    select_node_version: tool({
      description:
        'Switch which generated version a media node displays, or roll back to the previous version — e.g. "把镜头 3 换回上一版". Pure index switch: no re-run, no cost. Optionally also restore the prompt recorded for that version.',
      inputSchema: z.object({
        nodeId: z.string(),
        versionIndex: z
          .number()
          .optional()
          .describe('0-based index of the version to activate (0 is latest, 1 is previous).'),
        rollbackToPrevious: z
          .boolean()
          .optional()
          .describe('If true, switch to the immediately previous version (activeAssetIndex + 1).'),
        restorePrompt: z
          .boolean()
          .optional()
          .describe('If true and the selected version recorded a prompt in resultSet, restore params.prompt as well.'),
      }),
      execute: async ({ nodeId, versionIndex, rollbackToPrevious, restorePrompt }) => {
        const canvas = sessionCanvas();
        const node = canvasStore.getNode(canvas.id, nodeId);
        if (!node) return { error: `No canvas node "${nodeId}"` };
        const assets = node.output?.assets ?? [];
        if (assets.length === 0) return { error: '该节点还没有已生成的版本可切换' };
        const current = node.output?.activeAssetIndex ?? 0;
        const idx = rollbackToPrevious ? current + 1 : (versionIndex ?? 0);
        if (idx < 0 || idx >= assets.length) {
          return { error: `版本索引越界：该节点共 ${assets.length} 个版本（0-${assets.length - 1}），当前在第 ${current} 版` };
        }

        let restoredPrompt: string | undefined;
        const params = { ...(node.params as Record<string, unknown>) };
        if (restorePrompt) {
          const recorded = node.output?.resultSet?.[idx]?.prompt;
          if (typeof recorded === 'string' && recorded.length > 0) {
            params.prompt = recorded;
            restoredPrompt = recorded;
          }
        }

        const nextOutput = { ...(node.output ?? {}), activeAssetIndex: idx };
        const res = canvasApp.updateNode(canvas.id, nodeId, {
          output: nextOutput,
          ...(restoredPrompt !== undefined ? { params } : {}),
        });
        if (!res) return { error: `No canvas node "${nodeId}"` };
        return {
          ok: true,
          nodeId,
          activeAssetIndex: idx,
          versionCount: assets.length,
          asset: assets[idx],
          ...(restoredPrompt !== undefined ? { restoredPrompt } : {}),
        };
      },
    }),

    connect_nodes: tool({
      description:
        'Wire one canvas node\'s output into another node\'s input (source -> target). Enforces port compatibility (e.g. image -> video start_frame, text -> prompt).',
      inputSchema: z.object({
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().optional().describe('Handle on source node (e.g. "image_out"). Omit to use the node\'s default output.'),
        targetHandle: z.string().optional().describe('Handle on target node (e.g. "prompt", "start_frame", "reference", "ref_1").'),
        operationId: z.string().optional().describe('Idempotent operation ID.'),
      }),
      execute: async ({ source, target, sourceHandle, targetHandle, operationId }) => {
        const canvas = sessionCanvas();
        const res = canvasApp.addEdge(canvas.id, {
          sourceId: source,
          targetId: target,
          sourceHandle: sourceHandle ?? null,
          targetHandle: targetHandle ?? null,
        }, operationId);
        if (res.error === 'incompatible') {
          return {
            error: `Port incompatible: cannot connect "${source}" (${sourceHandle ?? 'default'}) to "${target}" (${targetHandle ?? 'default'})`,
          };
        }
        if (res.error === 'cycle') return { error: 'That connection would create a cycle' };
        if (res.error || !res.edge || res.rev === undefined) return { error: 'source or target node not found' };
        return { edgeId: res.edge.id, operationId };
      },
    }),

    attach_reference: tool({
      description:
        'Wire a reference `anchor` node into one or more image/video nodes so its character/style is held across them. Skips targets already attached. Returns how many edges landed.',
      inputSchema: z.object({
        anchorId: z.string(),
        targetIds: z.array(z.string()).min(1),
        operationId: z.string().optional().describe('Idempotent operation ID.'),
      }),
      execute: async ({ anchorId, targetIds, operationId }) => {
        const canvas = sessionCanvas();
        const anchor = canvasStore.getNode(canvas.id, anchorId);
        if (!anchor || anchor.type !== 'anchor') return { error: `No anchor node "${anchorId}"` };
        const existing = new Set(
          (canvasStore.getSnapshot(canvas.id)?.edges ?? [])
            .filter((e) => e.sourceId === anchorId)
            .map((e) => e.targetId),
        );
        const refSlotCount = (tid: string): number =>
          (canvasStore.getSnapshot(canvas.id)?.edges ?? []).filter(
            (e) => e.targetId === tid && (e.targetHandle ?? '').startsWith('ref_'),
          ).length;
        let attached = 0;
        for (const targetId of targetIds) {
          const target = canvasStore.getNode(canvas.id, targetId);
          if (!target || (target.type !== 'image' && target.type !== 'video') || existing.has(targetId)) continue;
          const slot = refSlotCount(targetId) + 1;
          if (slot > 3) continue;
          const res = canvasApp.addEdge(canvas.id, {
            sourceId: anchorId,
            targetId,
            targetHandle: `ref_${slot}`,
          });
          if (res.error || !res.edge || res.rev === undefined) continue;
          attached += 1;
        }
        return { attached, operationId };
      },
    }),

    delete_node: tool({
      description: 'Remove a canvas node and any edges touching it.',
      inputSchema: z.object({
        id: z.string(),
        operationId: z.string().optional().describe('Idempotent operation ID.'),
      }),
      execute: async ({ id, operationId }) => {
        const canvas = sessionCanvas();
        const res = canvasApp.deleteNode(canvas.id, id, operationId);
        if (!res) return { error: `No canvas node "${id}"` };
        return { ok: true, operationId };
      },
    }),
  };

  /** Resume a canvas_budget checkpoint after approval. The checkpoint args
   * carry the gated call in `args.tool`: run_node / run_graph replay straight
   * into that tool's execute (the gate sees approvedReplay and doesn't charge
   * twice). The pipeline is the exception — its structure was already
   * committed before the checkpoint threw, so re-running it would duplicate
   * the whole storyboard; instead the ghosts go live and the run list is
   * handed back for the model to execute node by node. */
  async function executeApproved(
    args: Record<string, unknown>,
    toolCallId: string,
  ): Promise<{ result?: string; error?: string }> {
    const resumeTool = typeof args.tool === 'string' ? args.tool : '';
    if (resumeTool === 'create_storyboard_pipeline') {
      const canvas = sessionCanvas();
      const rev = canvasStore.getSnapshot(canvas.id)?.canvas.liveRevision ?? 0;
      getCanvasChannel(canvas.id).broadcast(rev, {
        type: 'proposal_accepted',
        operationId: typeof args.operationId === 'string' ? args.operationId : undefined,
      });
      const planNodeIds = Array.isArray(args.planNodeIds) ? args.planNodeIds : [];
      return {
        result: JSON.stringify({
          ok: true,
          approved: true,
          planNodeIds,
          note: '计划已批准，提案节点已转正。不要再次调用 create_storyboard_pipeline——节点已在画布上，直接对 planNodeIds 里的关键帧/视频节点按顺序调用 run_node 逐个生成。',
        }),
      };
    }
    const def = resumeTool === 'run_node' || resumeTool === 'run_graph' ? tools[resumeTool] : undefined;
    if (!def?.execute) {
      return { error: `Cannot resume unknown canvas checkpoint "${resumeTool || CANVAS_BUDGET_TOOL}"` };
    }
    const rest = { ...args };
    delete rest.tool;
    delete rest.executed;
    delete rest.planned;
    delete rest.planNodeIds;
    const run = def.execute as (input: Record<string, unknown>, opts: GateOptions) => Promise<unknown>;
    const out = await run(rest, { toolCallId, approvedReplay: true });
    return { result: JSON.stringify(out ?? null) };
  }

  return { tools, executeApproved };
}
