import { isStepCount, streamText, tool } from 'ai';
import { z } from 'zod';
import type { CanvasAgentParams, CanvasNode } from '../../../shared/canvas';
import { getProviderPreset } from '../../../shared/providers';
import { createOpenAiModel } from '../agent/provider/openai';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { broadcastDownstreamDirty } from './imageExecutor';
import { readCanvasAsset } from './assets';
import { inputHash } from './graph';
import { canvasWorkSignal, canvasWorkStopped } from './workLifecycle';

const activeAgents = new WeakMap<CanvasStore, Map<string, symbol>>();

/** How often streaming text is flushed onto the canvas channel. */
const FLUSH_INTERVAL_MS = 400;
/** Bounded tool loop — this is a read-only sidecar, not the main agent. */
const MAX_STEPS = 12;

function isAgentParams(value: unknown): value is CanvasAgentParams {
  return Boolean(
    value && typeof value === 'object' && typeof (value as CanvasAgentParams).instruction === 'string',
  );
}

/** Read-only canvas introspection, scoped to one canvas id (no writes, no session). */
function readOnlyCanvasTools(canvasStore: CanvasStore, canvasId: string, canRead: () => boolean) {
  const brief = (node: CanvasNode) => {
    const params = node.params as Record<string, unknown>;
    return {
      id: node.id,
      type: node.type,
      title: node.title || null,
      runState: node.runState,
      prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
      instruction: typeof params.instruction === 'string' ? params.instruction : undefined,
      assetCount: node.output?.assets?.length ?? 0,
      text: node.output?.text,
      error: node.output?.error,
    };
  };
  return {
    read_canvas: tool({
      description: 'List every node on this canvas with its type, run state, prompt/instruction and outputs, plus the edges.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!canRead()) return { error: 'Run stopped' };
        const snap = canvasStore.getSnapshot(canvasId);
        return {
          nodes: (snap?.nodes ?? []).map(brief),
          edges: (snap?.edges ?? []).map((e) => ({ source: e.sourceId, target: e.targetId })),
        };
      },
    }),
    read_node: tool({
      description: 'Read one canvas node in full by id (params, run state, output text/assets/error).',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        if (!canRead()) return { error: 'Run stopped' };
        const node = canvasStore.getNode(canvasId, id);
        return node ? brief(node) : { error: `No canvas node "${id}"` };
      },
    }),
  };
}

/** Compact context describing what feeds this agent node. */
function upstreamContext(canvasStore: CanvasStore, canvasId: string, nodeId: string): string {
  const upstream = canvasStore.upstreamNodes(canvasId, nodeId);
  if (upstream.length === 0) return '';
  const lines = upstream.map((n) => {
    const p = n.params as Record<string, unknown>;
    if (n.type === 'image') {
      const assets = n.output?.assets?.length ?? 0;
      return `- [image node ${n.id}] prompt: "${typeof p.prompt === 'string' ? p.prompt : ''}" (${assets} image(s) generated)`;
    }
    const text = n.output?.text ? `\n  result: ${n.output.text.slice(0, 800)}` : '';
    return `- [agent node ${n.id}] task: "${typeof p.instruction === 'string' ? p.instruction : ''}"${text}`;
  });
  return `Connected input nodes:\n${lines.join('\n')}`;
}

async function collectUpstreamImages(
  canvasStore: CanvasStore,
  dataRoot: string | undefined,
  canvasId: string,
  nodeId: string,
  canRead: () => boolean,
): Promise<Array<{ bytes: Uint8Array; mediaType: string }>> {
  if (!dataRoot || !canRead()) return [];
  const upstream = canvasStore.upstreamNodes(canvasId, nodeId);
  const out: Array<{ bytes: Uint8Array; mediaType: string }> = [];
  for (const node of upstream) {
    if (node.type !== 'image') continue;
    const assets = node.output?.assets ?? [];
    for (const rel of assets.slice(0, 2)) {
      try {
        const buf = await readCanvasAsset(dataRoot, rel);
        if (!canRead()) return [];
        const lower = rel.toLowerCase();
        const mediaType = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
        out.push({ bytes: new Uint8Array(buf), mediaType });
      } catch {
        if (!canRead()) return [];
        /* skip unreadable asset */
      }
    }
  }
  return out;
}

/**
 * Run one "agent" canvas node: a headless, isolated sub-agent pass with a
 * read-only toolset (`read_canvas` / `read_node`). It does not see the chat
 * transcript, cannot write files or the canvas, and streams its answer into
 * the node's `output.text` over the canvas channel.
 *
 * Fire-and-forget, same contract as `runImageNode`.
 */
export async function runAgentNode(options: {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  canvasId: string;
  node: CanvasNode;
  providerId?: string;
  signal?: AbortSignal;
  dataRoot?: string;
}): Promise<void> {
  const { canvasStore, settingsStore, canvasId, node, dataRoot } = options;
  if (canvasWorkStopped(canvasStore) || options.signal?.aborted) return;
  let active = activeAgents.get(canvasStore);
  if (!active) { active = new Map(); activeAgents.set(canvasStore, active); }
  const key = `${canvasId}:${node.id}`;
  const token = Symbol('agent');
  active.set(key, token);
  const signal = AbortSignal.any([canvasWorkSignal(canvasStore), ...(options.signal ? [options.signal] : [])]);
  const isCurrent = () => !canvasWorkStopped(canvasStore) && active.get(key) === token;
  const canRun = () => isCurrent() && !signal.aborted;
  const channel = getCanvasChannel(canvasId);

  const fail = (message: string) => {
    if (!isCurrent()) return;
    const res = canvasStore.updateNode(canvasId, node.id, {
      runState: 'error',
      output: { ...(canvasStore.getNode(canvasId, node.id)?.output ?? {}), error: message },
    });
    if (res) {
      channel.broadcast(res.rev, {
        type: 'node_output',
        id: node.id,
        output: res.node.output ?? { error: message },
        runState: 'error',
      });
      broadcastDownstreamDirty(canvasStore, canvasId, node.id, res.rev);
    }
    if (active.get(key) === token) active.delete(key);
  };

  if (!isAgentParams(node.params) || !node.params.instruction.trim()) {
    fail('Agent node has no instruction');
    return;
  }
  const instruction = node.params.instruction.trim();

  const running = canvasStore.updateNode(canvasId, node.id, { runState: 'running', output: null });
  if (running) channel.broadcast(running.rev, { type: 'run_state', id: node.id, runState: 'running' });

  try {
    const settings = await settingsStore.get();
    if (!canRun()) return;
    const providerId = options.providerId || settings.activeProviderId || 'openai';
    const preset = getProviderPreset(providerId);
    const stored = settings.providers?.[providerId];
    if (!preset || !stored?.apiKey) {
      fail(`No API key configured for ${preset?.name ?? providerId}. Add one in Settings.`);
      return;
    }
    const modelId = stored.model || preset.defaultModel;
    const baseUrl = stored.baseUrl || preset.baseUrl;
    if (!modelId || !baseUrl) {
      fail('Provider is missing a base URL or model id.');
      return;
    }

    const upstream = canvasStore.upstreamNodes(canvasId, node.id);
    const context = upstreamContext(canvasStore, canvasId, node.id);
    const model = createOpenAiModel({ apiKey: stored.apiKey, modelId, baseUrl });

    const upstreamImages = await collectUpstreamImages(canvasStore, dataRoot, canvasId, node.id, canRun);
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

    const result = streamText({
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
    const done = canvasStore.updateNode(canvasId, node.id, {
      runState: 'done',
      output: { text },
      paramsHash: inputHash(node, upstream),
    });
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
    if (active.get(key) === token) active.delete(key);
  }
}
