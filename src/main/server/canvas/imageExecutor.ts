import { generateImage } from 'ai';
import { DEFAULT_DRAFT_IMAGE_MODEL } from '../../../shared/canvas';
import type { AnchorRole, AnchorStrength, CanvasEdge, CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { buildEditPrompt } from '../../../shared/canvasImageEdit';
import { getProviderPreset } from '../../../shared/providers';
import { createOpenAiProvider } from '../agent/provider/openai';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { inputHash } from './graph';
import { classifyMediaError } from './mediaError';
import { resolveMentions } from '../../../shared/resolveMentions';
import { planAnchors } from '../../../shared/referenceAnchors';
import { CanvasReferenceError, captureReferenceNodes, selectedAsset } from '../../../shared/canvasReferences';
import { nodeJobsFor, type NodeJobContext, type NodeJobSubmission } from './nodeJobs';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { generationSchedulerFor } from './generationScheduler';
import { readCanvasAsset, stageCanvasAssets } from './assets';
import type { CanvasJobFinish } from '../../../shared/canvasJobs';

export { canvasAssetsDir, readCanvasAsset } from './assets';

/**
 * Cap on reference images sent to the model (anchors + @mentions + img2img
 * fallback combined). Most providers reject or ignore more than a handful;
 * Leonardo tops out at 6, we stay conservative.
 */
const MAX_REFERENCE_IMAGES = 4;

/** Gemini image models (nano-banana family) return images through
 * chat/completions with `modalities:[image,text]`, not /images/generations. */
function isChatCompletionsImageModel(modelId: string): boolean {
  return /^gemini-[\w.-]*image/i.test(modelId);
}

interface RawImage {
  uint8Array: Uint8Array;
  mediaType: string;
}

function pushDataUrlImage(dataUrl: string, out: RawImage[]): void {
  const m = /^data:image\/(\w+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return;
  out.push({ uint8Array: new Uint8Array(Buffer.from(m[2], 'base64')), mediaType: `image/${m[1]}` });
}

async function generateImageViaChat(options: {
  baseUrl?: string;
  apiKey: string;
  modelId: string;
  prompt: string;
  images?: Uint8Array[];
  size?: string;
  signal?: AbortSignal;
}): Promise<{ images: RawImage[] }> {
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: options.size ? `${options.prompt}\n\nImage size: ${options.size}` : options.prompt },
  ];
  for (const img of options.images ?? []) {
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(img).toString('base64')}` } });
  }
  const base = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    signal: options.signal,
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.modelId,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
    }),
  });
  if (!res.ok) throw new Error(`image model ${options.modelId} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; images?: Array<{ image_url?: { url?: string } }> } }>;
  };
  const msg = body.choices?.[0]?.message ?? {};
  const images: RawImage[] = [];
  for (const img of msg.images ?? []) {
    if (img.image_url?.url) pushDataUrlImage(img.image_url.url, images);
  }
  if (typeof msg.content === 'string') {
    for (const m of msg.content.matchAll(/data:image\/\w+;base64,[A-Za-z0-9+/=]+/g)) {
      pushDataUrlImage(m[0], images);
    }
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content as Array<{ type?: string; image_url?: { url?: string } }>) {
      if (part.type === 'image_url' && part.image_url?.url) pushDataUrlImage(part.image_url.url, images);
    }
  }
  if (!images.length) throw new Error(`${options.modelId} returned no image`);
  return { images };
}

/** Route to chat/completions for Gemini image models, /images otherwise. */
async function generateOne(
  resolved: { provider: ReturnType<typeof createOpenAiProvider>; providerId: string; modelId: string; apiKey: string; baseUrl?: string },
  prompt: string | { text: string; images: Uint8Array[] },
  size: string,
  job: NodeJobContext,
  canvasStore: CanvasStore,
  taskSignal: AbortSignal = job.signal,
  onFailure?: (error: unknown) => void,
): Promise<{ images: RawImage[] }> {
  return generationSchedulerFor(canvasStore).run(resolved.providerId, async (signal) => {
    try {
      if (!job.markSubmitted({ providerId: resolved.providerId, model: resolved.modelId })) {
        throw new Error('Image job no longer owns provider submission');
      }
      if (isChatCompletionsImageModel(resolved.modelId)) {
        return await generateImageViaChat({
          baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, modelId: resolved.modelId,
          prompt: typeof prompt === 'string' ? prompt : prompt.text,
          images: typeof prompt === 'string' ? [] : prompt.images, size, signal,
        });
      }
      return await generateImage({ model: resolved.provider.image(resolved.modelId), prompt, size: size as `${number}x${number}`, abortSignal: signal, maxRetries: 0 }) as { images: RawImage[] };
    } catch (error) {
      onFailure?.(error); // Revoke sibling permits before this request releases capacity.
      throw error;
    }
  }, taskSignal);
}

/**
 * Re-broadcast a node and its descendants (annotated) so their `dirty` badge
 * reflects the just-changed inputs. Rides the `rev` of the mutation that
 * triggered it — several envelopes may share a rev. `skipSelf` leaves the
 * origin node alone (used after a param PATCH that already broadcast it).
 */
export function broadcastDownstreamDirty(
  canvasStore: CanvasStore,
  canvasId: string,
  nodeId: string,
  rev: number,
  skipSelf = true,
): void {
  const channel = getCanvasChannel(canvasId);
  for (const node of canvasStore.annotatedFrom(canvasId, nodeId)) {
    if (skipSelf && node.id === nodeId) continue;
    channel.broadcast(rev, { type: 'node_updated', node });
  }
}

async function resolveImageProvider(
  settingsStore: SettingsStore,
  providerId: string | undefined,
  params: CanvasImageParams,
): Promise<{ provider: ReturnType<typeof createOpenAiProvider>; providerId: string; modelId: string; apiKey: string; baseUrl?: string } | { error: string }> {
  const settings = await settingsStore.get();
  let resolvedId = providerId || settings.activeProviderId || 'openai';
  let stored = settings.providers[resolvedId];
  if (!stored?.apiKey) {
    for (const alt of ['reizo', 'openai']) {
      if (alt !== resolvedId && settings.providers[alt]?.apiKey) {
        resolvedId = alt;
        stored = settings.providers[alt];
        break;
      }
    }
  }
  const preset = getProviderPreset(resolvedId);
  if (!preset || !stored?.apiKey) {
    return { error: `No API key configured for ${preset?.name ?? resolvedId}. Add one in Settings.` };
  }
  const baseUrl = stored.baseUrl || preset.baseUrl;
  const isOfficial = !baseUrl || baseUrl.includes('api.openai.com');
  const modelId = params.draft
    ? settings.mediaModels?.draft || DEFAULT_DRAFT_IMAGE_MODEL
    : params.model || settings.mediaModels?.image || (isOfficial ? 'dall-e-3' : 'gpt-image-2');
  const provider = createOpenAiProvider({ apiKey: stored.apiKey, baseUrl, retryTransport: false });
  return { provider, providerId: resolvedId, modelId, apiKey: stored.apiKey, baseUrl };
}

async function writeImageAssetsAndBroadcast(options: {
  canvasStore: CanvasStore;
  dataRoot: string;
  canvasId: string;
  node: CanvasNode;
  upstream: CanvasNode[];
  rawPrompt: string;
  results: Array<{ images: Array<{ mediaType?: string; uint8Array: Uint8Array }> }>;
  forcePng?: boolean;
  job: NodeJobContext;
  model: string;
}): Promise<void> {
  const { canvasStore, dataRoot, canvasId, node, upstream, rawPrompt, results, job } = options;
  const canCommit = () => job.isCurrent() && Boolean(canvasStore.getNode(canvasId, node.id));
  if (!canCommit()) return;
  if (!results.some((result) => result.images.length > 0)) throw new Error('Image provider returned no generated assets');
  if (results.some((result) => result.images.some((image) => image.uint8Array.byteLength === 0))) {
    throw new Error('Image provider returned an empty generated asset');
  }
  const channel = getCanvasChannel(canvasId);
  const staged = await stageCanvasAssets(dataRoot, canvasId, results.flatMap((result) => result.images).map((image, index) => {
    const mimeType = image.mediaType === 'image/jpeg' ? 'image/jpeg' : image.mediaType === 'image/webp' ? 'image/webp' : 'image/png';
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    return { name: `${node.id}-${job.id}-${index}.${extension}`, bytes: image.uint8Array, mimeType, kind: 'image' as const };
  }), job.signal);
  try {
    if (!canCommit()) return;
    const details: CanvasJobFinish = {};
    const done = job.finish('succeeded', () => {
      const registered = staged.files.map((file) => canvasStore.assets.register({ ...file, canvasId, nodeId: node.id, jobId: job.id, source: 'generated' }));
      const paths = registered.map((asset) => asset.path);
      const previous = canvasStore.getNode(canvasId, node.id)?.output ?? {};
      const output = { assets: [...paths, ...(previous.assets ?? []).filter((asset) => !paths.includes(asset))].slice(0, 10),
        resultSet: [...registered.map((asset) => ({ asset: asset.path, assetId: asset.id, jobId: asset.jobId,
          generation: asset.generation, providerId: asset.providerId, inputHash: asset.inputHash,
          createdAt: new Date().toISOString(), prompt: rawPrompt, model: asset.model ?? options.model })),
        ...(previous.resultSet ?? []).filter((item) => !paths.includes(item.asset))].slice(0, 20), activeAssetIndex: 0 };
      details.result = output;
      return canvasStore.updateNode(canvasId, node.id, { runState: 'done', output, paramsHash: inputHash(node, upstream) });
    }, details);
    if (done) {
      staged.keep();
      channel.broadcast(done.rev, {
        type: 'node_output',
        id: node.id,
        output: done.node.output ?? {},
        runState: 'done',
      });
      broadcastDownstreamDirty(canvasStore, canvasId, node.id, done.rev, false);
    }
  } finally {
    await staged.discard();
  }
}

async function upstreamImageBytes(
  upstream: CanvasNode[],
  dataRoot: string,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const seen = new Set<string>();
  for (const node of upstream) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const rel = selectedAsset(node);
    if (!rel) continue;
    try {
      out.push(new Uint8Array(await readCanvasAsset(dataRoot, rel)));
    } catch {
      /* skip a missing legacy asset */
    }
    if (out.length === 2) break;
  }
  return out.slice(0, 2);
}

/**
 * Run one image node: resolve the OpenAI-compatible provider from settings,
 * call `generateImage` (img2img when an upstream image node is wired in),
 * write the PNG(s) under `<dataRoot>/canvas/<canvasId>/`, and broadcast the
 * run-state / output transitions on the canvas channel.
 *
 * Fire-and-forget: the route returns before this resolves.
 */
export interface ImageRunOptions {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  canvasId: string;
  node: CanvasNode;
  providerId?: string;
  signal?: AbortSignal;
  operationId?: string;
}

interface ImageJobInput {
  request: { providerId?: string };
  node: CanvasNode;
  upstream: CanvasNode[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  requiredAssetPaths: string[];
}

function failImageJob(options: ImageRunOptions, job: NodeJobContext, message: string): void {
  const { canvasStore, canvasId } = options;
  if (!job.isCurrent()) return;
  const merged = { ...(canvasStore.getNode(canvasId, options.node.id)?.output ?? {}), error: message };
  const result = job.finish('failed', () => canvasStore.updateNode(canvasId, options.node.id, { runState: 'error', output: merged }), { error: message });
  if (result) {
    getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_output', id: options.node.id, output: result.node.output ?? merged, runState: 'error' });
    broadcastDownstreamDirty(canvasStore, canvasId, options.node.id, result.rev);
  }
}

/** Synchronous durable admission; accepted identity is available before HTTP 202. */
export function startImageNode(options: ImageRunOptions): NodeJobSubmission {
  const { canvasStore, canvasId } = options;
  const runtime = nodeJobsFor(canvasStore);
  runtime.assertAccepting();
  const receipt = runtime.replay(canvasId, options.node.id, options.operationId, options.providerId);
  if (receipt) return receipt;
  const node = canvasStore.getNode(canvasId, options.node.id);
  if (!node || node.type !== 'image') throw new CanvasJobStoreError('Image node not found', 404);
  const snapshot = canvasStore.getSnapshot(canvasId);
  if (!snapshot) throw new CanvasJobStoreError('Canvas not found', 404);
  let references: ReturnType<typeof captureReferenceNodes>;
  try {
    references = captureReferenceNodes(canvasStore.upstreamNodes(canvasId, node.id), (id) => canvasStore.assets.get(id));
  } catch (error) {
    throw new CanvasJobStoreError(error instanceof Error ? error.message : String(error));
  }
  const capturedById = new Map(references.nodes.map((reference) => [reference.id, reference]));
  const input: ImageJobInput = structuredClone({ request: { providerId: options.providerId }, node,
    upstream: references.nodes, nodes: snapshot.nodes.map((candidate) => capturedById.get(candidate.id) ?? candidate),
    edges: snapshot.edges, requiredAssetPaths: references.requiredAssetPaths });
  return runtime.start({
    canvasId, nodeId: node.id, nodeType: 'image', signal: options.signal, operationId: options.operationId,
    input: { ...input }, inputHash: inputHash(input.node, input.upstream),
    execute: (job) => executeImageNode({ ...options, node: input.node, input, job }),
    onFailure: (error, job) => failImageJob(options, job, classifyMediaError(error).message),
    onCancelled: (reason) => {
      const current = canvasStore.getNode(canvasId, node.id);
      if (!current) return;
      const output = { ...(current.output ?? {}) };
      delete output.error;
      delete output.progress;
      if (reason === 'interrupted') output.error = '任务因应用退出而中断，请重试。';
      const result = canvasStore.updateNode(canvasId, node.id, { runState: reason === 'interrupted' ? 'error' : 'idle', output });
      if (!result) throw new Error('Image job cancellation could not update its node');
      return () => { getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node }); };
    },
  });
}

export async function runImageNode(options: ImageRunOptions): Promise<void> {
  await startImageNode(options).completion;
}

async function executeImageNode(options: ImageRunOptions & { input: ImageJobInput; job: NodeJobContext }): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, node } = options;
  const channel = getCanvasChannel(canvasId);
  const canCommit = () => options.job.isCurrent() && Boolean(canvasStore.getNode(canvasId, node.id));

  // Keep the existing output so previous versions' assets/resultSet survive
  // the rerun — output is replaced wholesale on write, not merged.
  if (!canCommit()) return;
  const running = canvasStore.updateNode(canvasId, node.id, { runState: 'running' });
  if (!running) throw new Error('Image job could not start its node');
  channel.broadcast(running.rev, { type: 'run_state', id: node.id, runState: 'running' });

  const fail = (message: string) => {
    failImageJob(options, options.job, message);
  };

  try {
    const upstream = options.input.upstream;
    const fixedImages = new Map<string, Uint8Array>();
    for (const rel of options.input.requiredAssetPaths) {
      try {
        fixedImages.set(rel, new Uint8Array(await readCanvasAsset(dataRoot, rel)));
      } catch (error) {
        throw new CanvasReferenceError(`固定参考图无法读取：${rel}`, { cause: error });
      }
    }
    const params = (node.params || {}) as CanvasImageParams;
    let rawPrompt = (typeof params.prompt === 'string' ? params.prompt : '').trim();

    const edit = params.edit;
    if (edit) {
      rawPrompt = buildEditPrompt(edit);
      const snap = options.input;
      const srcEdge = snap.edges.find((e) => e.targetId === node.id && e.targetHandle === 'edit_src');
      const srcNode =
        (srcEdge && snap.nodes.find((n) => n.id === srcEdge.sourceId)) ||
        upstream.find((u) => (u.output?.assets?.length ?? 0) > 0);
      const srcRel = srcNode ? selectedAsset(srcNode) : undefined;
      if (!srcRel) {
        fail('编辑节点缺少源图输入');
        return;
      }
      const imgs: Uint8Array[] = [fixedImages.get(srcRel) ?? new Uint8Array(await readCanvasAsset(dataRoot, srcRel))];
      if (edit.maskAsset) {
        try {
          imgs.push(new Uint8Array(await readCanvasAsset(dataRoot, edit.maskAsset)));
        } catch {
          /* ignore missing mask file */
        }
      }
      const resolved = await resolveImageProvider(settingsStore, options.providerId, params);
      if ('error' in resolved) {
        fail(resolved.error);
        return;
      }
      const srcParams = (srcNode?.params || {}) as CanvasImageParams;
      const size = params.size ?? srcParams.size ?? '1024x1024';
      if (!canCommit()) return;
      const result = await generateOne(resolved, { text: rawPrompt, images: imgs }, size, options.job, canvasStore);
      await writeImageAssetsAndBroadcast({
        canvasStore,
        dataRoot,
        canvasId,
        node,
        upstream,
        rawPrompt,
        results: [result],
        forcePng: edit.kind === 'matting',
        job: options.job,
        model: resolved.modelId,
      });
      return;
    }

    if (!rawPrompt) {
      for (const u of upstream) {
        if (u.type === 'note') {
          const np = u.params as { content?: string } | undefined;
          if (np?.content?.trim()) {
            rawPrompt = np.content.trim();
            break;
          }
        } else if (u.type === 'agent') {
          const ap = u.output as { text?: string } | undefined;
          if (ap?.text?.trim()) {
            rawPrompt = ap.text.trim();
            break;
          }
        }
      }
    }

    if (!rawPrompt) {
      fail('图片节点缺少提示词，请在卡片中填写或连入上游便签/Agent');
      return;
    }

    const resolved = await resolveImageProvider(settingsStore, options.providerId, params);
    if ('error' in resolved) {
      fail(resolved.error);
      return;
    }
    let images: Uint8Array[] = [];

    const readRefBytes = async (rel: string): Promise<void> => {
      try {
        images.push(fixedImages.get(rel) ?? new Uint8Array(await readCanvasAsset(dataRoot, rel)));
      } catch (error) {
        if (options.input.requiredAssetPaths.includes(rel)) throw new CanvasReferenceError(`固定参考图无法读取：${rel}`, { cause: error });
        /* ignore unreadable asset */
      }
    };

    // Reference anchors: attached `anchor` nodes are ordered first (character →
    // style → content) and described by a semantic prefix. NOT IP-Adapter —
    // just an ordered pile + wording (see referenceAnchors.ts / docs).
    // Within a role, honour the `ref_N` slot number the edge carries.
    const slotByAnchor = new Map<string, number>();
    for (const e of options.input.edges) {
      if (e.targetId !== node.id) continue;
      const m = /^ref_(\d+)$/.exec(e.targetHandle ?? '');
      if (m) slotByAnchor.set(e.sourceId, Number(m[1]));
    }
    const anchorNodes = upstream
      .filter((u) => u.type === 'anchor')
      .sort((a, b) => (slotByAnchor.get(a.id) ?? 99) - (slotByAnchor.get(b.id) ?? 99));
    const { orderedAssetRefs: anchorRefs, promptPrefix } = planAnchors(
      anchorNodes.map((a) => {
        const ap = a.params as { role?: AnchorRole; strength?: AnchorStrength; note?: string };
        const asset = selectedAsset(a);
        return {
          id: a.id,
          role: ap.role ?? 'character',
          strength: ap.strength ?? 'mid',
          note: ap.note,
          title: a.title || '',
          assets: asset ? [asset] : [],
        };
      }),
      1,
    );
    for (const rel of anchorRefs) await readRefBytes(rel);
    if (promptPrefix) rawPrompt = `${promptPrefix}\n${rawPrompt}`;

    if (rawPrompt.includes('@')) {
      // @-mentions resolve against the whole canvas by id (the chip picker and
      // the agent can both reference a node that is not wired in as an edge).
      const candidates = options.input.nodes
        .filter((u) => u.id !== node.id && u.type !== 'anchor')
        .map((u) => {
          const asset = selectedAsset(u);
          let text: string | undefined;
          if (u.type === 'note') {
            text = (u.params as { content?: string } | undefined)?.content;
          } else if (u.type === 'agent') {
            text = (u.output as { text?: string } | undefined)?.text;
          }
          return {
            id: u.id,
            label: u.title || '',
            assets: asset ? [asset] : [],
            text,
          };
        });
      const { resolvedPrompt, orderedAssetRefs } = resolveMentions(rawPrompt, candidates, anchorRefs.length + 1);
      rawPrompt = resolvedPrompt;
      for (const rel of orderedAssetRefs) await readRefBytes(rel);
    }

    if (images.length === 0) {
      images = await upstreamImageBytes(upstream, dataRoot);
    }

    images = images.slice(0, MAX_REFERENCE_IMAGES);
    const prompt = images.length > 0 ? { text: rawPrompt, images } : rawPrompt;

    const requestedCount = Number(params.count ?? 1);
    if (!Number.isFinite(requestedCount) || requestedCount < 1) {
      fail('图片数量参数无效，请重新选择生成数量。');
      return;
    }
    const variationsCount = Math.min(4, Math.floor(requestedCount));

    if (!canCommit()) return;
    const batchAbort = new AbortController();
    const batchSignal = AbortSignal.any([options.job.signal, batchAbort.signal]);
    const genPromises = Array.from({ length: variationsCount }, () =>
      generateOne(resolved, prompt, params.size ?? '1024x1024', options.job, canvasStore, batchSignal, (error) => batchAbort.abort(error)),
    );
    const results = await Promise.all(genPromises);
    await writeImageAssetsAndBroadcast({
      canvasStore,
      dataRoot,
      canvasId,
      node,
      upstream,
      rawPrompt,
      results,
      job: options.job,
      model: resolved.modelId,
    });
  } catch (err) {
    if (!canCommit()) return;
    if (err instanceof CanvasReferenceError) { fail(err.message); return; }
    const classified = classifyMediaError(err);
    if (classified.raw !== classified.message) {
      console.warn(`[canvas] image node ${node.id} failed: ${classified.raw}`);
    }
    fail(classified.message);
  }
}
