import { isStepCount, streamText } from 'ai';
import type { CanvasAgentParams, CanvasNode } from '../../../shared/canvas';
import { resolveSettingsModel } from '../providerResolver';
import { usageFetch } from '../agent/provider/usageFetch';
import { createOpenAiModel } from '../agent/provider/openai';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { broadcastDownstreamDirty } from './imageExecutor';
import { readOnlyCanvasTools, upstreamContext, collectUpstreamImages } from './agentNodeContext';
import { nodeJobsFor, type NodeJobContext, type NodeJobSubmission } from './nodeJobs';
import { llmSchedulerFor } from '../agent/provider/quotaFetch';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { redactSecrets } from '../../../shared/redactSecrets';
import { inputHash } from './graph';
import { canvasWorkStopped } from './workLifecycle';

/** How often streaming text is flushed onto the canvas channel. */
const FLUSH_INTERVAL_MS = 400;
/** Bounded tool loop — this is a read-only sidecar, not the main agent. */
const MAX_STEPS = 12;

function isAgentParams(value: unknown): value is CanvasAgentParams {
  return Boolean(
    value && typeof value === 'object' && typeof (value as CanvasAgentParams).instruction === 'string',
  );
}

/**
 * Run one "agent" canvas node: a headless, isolated sub-agent pass with a
 * read-only toolset (`read_canvas` / `read_node`). It does not see the chat
 * transcript, cannot write files or the canvas, and streams its answer into
 * the node's `output.text` over the canvas channel.
 *
 * Fire-and-forget, same contract as `runImageNode`.
 */
export interface AgentNodeOptions {
  canvasStore: CanvasStore; settingsStore: SettingsStore; canvasId: string; node: CanvasNode;
  providerId?: string; operationId?: string; signal?: AbortSignal; dataRoot?: string;
}

function projectFailure(options: AgentNodeOptions, job: NodeJobContext, message: string) {
  const { canvasStore, canvasId, node } = options;
  const result = job.finish('failed', () => canvasStore.updateNode(canvasId, node.id, {
    runState: 'error', output: { ...canvasStore.getNode(canvasId, node.id)?.output, error: redactSecrets(message) },
  }), { error: redactSecrets(message) });
  if (result) getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
}

export function startAgentNode(options: AgentNodeOptions): NodeJobSubmission {
  const { canvasStore, canvasId } = options;
  const runtime = nodeJobsFor(canvasStore);
  const receipt = runtime.replay(canvasId, options.node.id, options.operationId, options.providerId, 'agent');
  if (receipt) return receipt;
  const node = canvasStore.getNode(canvasId, options.node.id);
  if (!node || node.type !== 'agent') throw new CanvasJobStoreError('Agent node not found', 404);
  const input = structuredClone({ request: { providerId: options.providerId }, node,
    upstream: canvasStore.upstreamNodes(canvasId, node.id) });
  return runtime.start({ canvasId, nodeId: node.id, nodeType: 'agent', operationId: options.operationId,
    signal: options.signal, input, inputHash: inputHash(input.node, input.upstream),
    execute: (job) => executeAgentNode({ ...options, node: input.node }, input.upstream, job),
    onFailure: (error, job) => projectFailure(options, job, error instanceof Error ? error.message : String(error)),
    onCancelled: (reason) => {
      const current = canvasStore.getNode(canvasId, node.id);
      if (!current) return;
      const output = { ...current.output }; delete output.error;
      if (reason === 'interrupted') output.error = 'Agent 因应用退出而中断，请手动重试。';
      const result = canvasStore.updateNode(canvasId, node.id, { runState: reason === 'interrupted' ? 'error' : 'idle', output });
      if (!result) throw new Error('Agent cancellation could not update its node');
      return () => getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
    },
  });
}

export async function runAgentNode(options: AgentNodeOptions): Promise<void> {
  if (canvasWorkStopped(options.canvasStore) || options.signal?.aborted) return;
  await startAgentNode(options).completion;
}

async function executeAgentNode(options: AgentNodeOptions, upstream: CanvasNode[], job: NodeJobContext): Promise<void> {
  const { canvasStore, settingsStore, canvasId, node, dataRoot } = options;
  const signal = job.signal;
  const isCurrent = job.isCurrent;
  const canRun = () => isCurrent() && Boolean(canvasStore.getNode(canvasId, node.id));
  const channel = getCanvasChannel(canvasId);

  const fail = (message: string) => projectFailure(options, job, message);

  if (!isAgentParams(node.params) || !node.params.instruction.trim()) {
    fail('Agent node has no instruction');
    return;
  }
  const instruction = node.params.instruction.trim();

  const running = canvasStore.updateNode(canvasId, node.id, { runState: 'running' });
  if (running) channel.broadcast(running.rev, { type: 'run_state', id: node.id, runState: 'running' });

  let release: (() => void) | undefined;
  try {
    const settings = await settingsStore.get();
    if (!canRun()) return;
    const { providerId, modelId, apiKey, baseUrl } = resolveSettingsModel(settings, { category: 'llm', providerId: options.providerId });

    release = await llmSchedulerFor(canvasStore).acquire(providerId, signal);
    if (!canRun()) return;
    const context = upstreamContext(upstream);
    const model = createOpenAiModel({ apiKey, modelId, baseUrl, fetch: usageFetch(canvasStore.usage, {
      executionId: `job:${job.id}`, jobId: job.id, canvasId, nodeId: node.id, providerId, model: modelId, category: 'llm', accepting: () => !canvasWorkStopped(canvasStore),
    }) });

    const upstreamImages = await collectUpstreamImages(dataRoot, upstream, canRun);
    if (!canRun()) return;
    const textPrompt = context ? `${instruction}\n\n${context}` : instruction;

    type UserPart = { type: 'text'; text: string } | { type: 'image'; image: Uint8Array; mediaType?: string };
    const userContent: string | UserPart[] =
      upstreamImages.length > 0
        ? [
            { type: 'text', text: textPrompt },
            ...upstreamImages.map((img) => ({
              type: 'image' as const,
              image: img.bytes,
              mediaType: img.mediaType,
            })),
          ]
        : textPrompt;

    if (!job.markSubmitted({ providerId, model: modelId })) return;
    const result = streamText({
      maxRetries: 0,
      model,
      instructions:
        'You are a research / critique sidecar attached to a node on a visual canvas. ' +
        'When images are provided in the input, inspect their visual composition, aesthetics, lighting, character details, and style. ' +
        'Do the task the user describes and reply with a concise, directly useful answer ' +
        '(findings, a visual critique, or rewritten prompt/text — no preamble). You can call read_canvas / ' +
        'read_node to inspect other nodes, but you cannot change anything.',
      messages: [
        {
          role: 'user',
          content: userContent as unknown as string,
        },
      ],
      tools: readOnlyCanvasTools(canvasStore, canvasId, canRun),
      stopWhen: isStepCount(MAX_STEPS),
      abortSignal: signal,
    });

    let acc = '';
    let lastFlush = 0;
    for await (const delta of result.textStream) {
      if (!canRun()) return;
      acc += delta;
      const now = Date.now();
      if (now - lastFlush >= FLUSH_INTERVAL_MS) {
        lastFlush = now;
        const patched = canvasStore.updateNode(canvasId, node.id, { output: { text: acc } });
        if (patched) {
          channel.broadcast(patched.rev, {
            type: 'node_output',
            id: node.id,
            output: { text: acc },
            runState: 'running',
          });
        }
      }
    }

    const text = (acc || (await result.text) || '').trim();
    if (!canRun()) return;
    if (!text) {
      fail('The agent returned an empty answer');
      return;
    }
    const done = job.finish('succeeded', () => canvasStore.updateNode(canvasId, node.id, {
      runState: 'done', output: { text }, paramsHash: inputHash(node, upstream),
    }), { result: { text } });
    if (done) {
      channel.broadcast(done.rev, {
        type: 'node_output',
        id: node.id,
        output: done.node.output ?? { text },
        runState: 'done',
      });
      broadcastDownstreamDirty(canvasStore, canvasId, node.id, done.rev, false);
    }
  } catch (err) {
    if (!isCurrent()) return;
    if (signal?.aborted) {
      fail('Run stopped');
      return;
    }
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    if (isCurrent() && signal.aborted) fail('Run stopped');
    release?.();
  }
}
