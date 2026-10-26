import { Hono } from 'hono';
import { CanvasCommandError, createCanvasApplication } from '../canvas/application';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SessionStore } from '../../../shared/chat';
import { defaultNodeBox, type CanvasNodeType } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ProviderStore } from '../storage/providerStore';
import { getCanvasChannel } from '../canvas/channel';
import { startImageNode } from '../canvas/imageExecutor';
import { readCanvasAsset, stageCanvasAssets } from '../canvas/assets';
import type { CanvasAssetKind, CanvasAssetSummary } from '../../../shared/canvasAssets';
import { CanvasAssetStoreError } from '../storage/canvasAssetStore';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { NodeJobsClosedError } from '../canvas/nodeJobs';
import { canvasWorkSignal, canvasWorkStopped } from '../canvas/workLifecycle';
import type { CanvasJob } from '../../../shared/canvasJobs';
import { isCanvasRunning, runGraph, stopCanvasRun } from '../canvas/graphExecutor';
import { nodeJobsFor } from '../canvas/nodeJobs';
import { cancelVideoJob, recoverVideoJob, latestVideoQueryJob, videoJobObservation } from '../canvas/asyncJobManager';
import { isImportedMedia } from '../../../shared/canvasGraph';
import { startAgentNode } from '../canvas/agentExecutor';
import { startComposition } from '../canvas/composition';
import { startVideoNode } from '../canvas/videoExecutor';
import { startAudioNode } from '../canvas/audioExecutor';
import { setCanvasSelection } from '../canvas/selection';
import { exportWorkflowZip } from '../canvas/exportWorkflow';
import { importWorkflowZip } from '../canvas/importWorkflow';
import { generateText } from 'ai';
import { createOpenAiModel } from '../agent/provider/openai';
import { resolveSettingsModel } from '../providerResolver';
import { usageFetch } from '../agent/provider/usageFetch';
import { quotaFetch, llmSchedulerFor } from '../agent/provider/quotaFetch';
import { startPresentationExport } from '../canvas/presentationExport';
import { isPresentationExportNode } from '../../../shared/canvasPresentation';

const NODE_TYPES = new Set<CanvasNodeType>([
  'image',
  'agent',
  'video',
  'audio',
  'note',
  'group',
  'anchor',
  'reroute',
  'frameExtractor',
  'section',
  'subgraph',
]);
const IMPORT_MAX_BYTES = 12 * 1024 * 1024;
const WORKFLOW_MAX_BYTES = 256 * 1024 * 1024;
const MEDIA_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/mp4', flac: 'audio/flac',
};
const SAFE_MEDIA_MIMES = new Set(Object.values(MEDIA_MIMES));
const mimeForExtension = (extension: string) => MEDIA_MIMES[extension] || 'application/octet-stream';
const kindForMime = (mime: string): Exclude<CanvasAssetKind, 'mask'> => mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'image';
const reuseRequest = z.object({
  assetId: z.string().min(1).optional(), sourceNodeId: z.string().min(1).optional(), sourceCanvasId: z.string().min(1).optional(),
  assetIndex: z.number().int().nonnegative().optional(), expectedPath: z.string().max(1000).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(),
  title: z.string().optional(), asReference: z.boolean().optional(),
}).refine((input) => Boolean(input.assetId) !== Boolean(input.sourceNodeId));

const REFINEMENT_PROMPTS: Record<'image' | 'video', string> = {
  image:
    '你是专业的 AI 图像提示词专家。请对用户提供的提示词草稿进行润色与丰富。' +
    '必须保留用户明确指定的主体、核心意图、画幅风格与场景元素。' +
    '补充画面主体细节、构图视角、光影氛围、色彩搭配与材质质感。' +
    '严禁无端编造用户未提及的文字、人名、商标或品牌。' +
    '只输出一段可直接提交给生图模型的最终提示词文本，严禁包含任何解释、前缀、列表、引号或 Markdown 标记。',
  video:
    '你是专业的 AI 视频提示词专家。请对用户提供的提示词草稿进行润色与丰富。' +
    '必须保留用户明确指定的主体、核心动作与风格意图。' +
    '补充主体动态轨迹、镜头运动（如缓慢推近、跟随运镜）、运镜节奏、光影色彩与场景空间感，确保动作连续可信。' +
    '严禁无端编造用户未提及的文字、人名、商标或品牌。' +
    '只输出一段可直接提交给视频生成模型的最终提示词文本，严禁包含任何解释、前缀、列表、引号或 Markdown 标记。',
};

export function createCanvasRouter(
  canvasStore: CanvasStore,
  settingsStore: SettingsStore,
  sessionStore: SessionStore,
  dataRoot: string,
  artifactStore?: ArtifactStore,
  providerStore?: ProviderStore,
) {
  const router = new Hono();
  const canvasApp = createCanvasApplication(canvasStore);
  router.onError((err, c) => {
    if (err instanceof CanvasCommandError) return c.json({ error: err.message }, err.status);
    if (err instanceof CanvasJobStoreError || err instanceof NodeJobsClosedError || err instanceof CanvasAssetStoreError) return c.json({ error: err.message }, err.status);
    console.error('[canvas] request failed', err);
    return c.json({ error: 'Canvas request failed' }, 500);
  });

  router.post('/:canvasId/edits', async (c) => {
    const body = await c.req.json().catch((): null => null);
    const operationId = c.req.header('Idempotency-Key');
    if (!operationId || !body || !Array.isArray(body.edits)) return c.json({ error: 'edits and Idempotency-Key are required' }, 400);
    const canvasId = c.req.param('canvasId');
    if (body.uploads === undefined) return c.json({ snapshot: canvasApp.edit(canvasId, body.edits, operationId, body.expectedRevision) });
    const parsed = z.array(z.object({ nodeId: z.string().min(1), name: z.string().min(1).max(160),
      dataBase64: z.string().min(1).max(IMPORT_MAX_BYTES * 1.4), mimeType: z.string(), role: z.enum(['output', 'mask']).default('output') })).min(1).max(32).safeParse(body.uploads);
    if (!parsed.success) return c.json({ error: '上传清单无效' }, 400);
    const uploads = parsed.data;
    const identities = uploads.map((file) => `${file.nodeId}:${file.role}`);
    if (new Set(identities).size !== identities.length) return c.json({ error: '同一节点不能重复上传同类文件' }, 400);
    const files = uploads.map((file) => ({ ...file, bytes: Buffer.from(file.dataBase64, 'base64') }));
    if (files.some((file) => !file.bytes.length || file.bytes.length > IMPORT_MAX_BYTES || !SAFE_MEDIA_MIMES.has(file.mimeType) || file.role === 'mask' && file.mimeType !== 'image/png') ||
      files.reduce((total, file) => total + file.bytes.length, 0) > 64 * 1024 * 1024) return c.json({ error: '文件类型或大小无效，单次最多 64 MB' }, 400);
    const request = { kind: 'edit_with_assets', edits: body.edits, expectedRevision: body.expectedRevision,
      files: files.map((file) => ({ nodeId: file.nodeId, name: file.name, mimeType: file.mimeType, role: file.role,
        hash: createHash('sha256').update(file.bytes).digest('hex') })) };
    const replay = canvasApp.replay<unknown>(canvasId, request, operationId);
    if (replay) return c.json({ snapshot: canvasStore.getSnapshot(canvasId) });
    const extensionFor = (mimeType: string) => Object.entries(MEDIA_MIMES).find(([, mime]) => mime === mimeType)?.[0];
    const staged = await stageCanvasAssets(dataRoot, canvasId, files.map((file) => ({
      name: `${nanoid()}.${extensionFor(file.mimeType)}`, bytes: file.bytes, mimeType: file.mimeType,
      kind: file.role === 'mask' ? 'mask' : kindForMime(file.mimeType),
    })), AbortSignal.any([canvasWorkSignal(canvasStore), c.req.raw.signal]));
    try {
      staged.prepareCommit();
      canvasApp.batch(canvasId, request, () => {
        canvasApp.edit(canvasId, body.edits, undefined, body.expectedRevision);
        files.forEach((file, index) => {
          const node = canvasStore.getNode(canvasId, file.nodeId);
          if (!node || !['image', 'video', 'audio', 'anchor', 'frameExtractor'].includes(node.type)) throw new CanvasCommandError('素材节点不存在或类型不支持', 400);
          const asset = canvasStore.assets.register({ ...staged.files[index], canvasId, nodeId: node.id, source: file.role === 'mask' ? 'mask' : 'imported' });
          canvasStore.assets.updateMetadata(asset.id, { name: file.name });
          if (file.role === 'mask') {
            const params = node.params as Record<string, unknown>;
            if (!params.edit || typeof params.edit !== 'object') throw new CanvasCommandError('蒙版需要图片编辑节点');
            canvasApp.updateNode(canvasId, node.id, { params: { ...params, edit: { ...params.edit, maskAsset: asset.path } } });
          } else canvasApp.updateNode(canvasId, node.id, { runState: 'done', output: { assets: [asset.path], activeAssetIndex: 0,
            resultSet: [{ asset: asset.path, assetId: asset.id, createdAt: asset.createdAt }] } });
        });
        canvasApp.afterCommit(() => staged.keep());
        return { revision: canvasStore.getCanvas(canvasId).liveRevision };
      }, operationId);
      return c.json({ snapshot: canvasStore.getSnapshot(canvasId) });
    } finally { await staged.discard(); }
  });

  /** 轻量级 Prompt 润色（不走完整 Agent Turn 与消息历史） */
  router.post('/refine-prompt', async (c) => {
    const body = await c.req.json().catch((): null => null);
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!rawPrompt) {
      return c.json({ error: '提示词内容不能为空' }, 400);
    }
    const mode: 'image' | 'video' = body?.mode === 'video' ? 'video' : 'image';

    let resolved: ReturnType<typeof resolveSettingsModel>;
    try { resolved = resolveSettingsModel(await settingsStore.get(), { category: 'llm' }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
    const { providerId, modelId, apiKey, baseUrl } = resolved;

    try {
      const model = createOpenAiModel({ apiKey, modelId, baseUrl, fetch: quotaFetch(llmSchedulerFor(canvasStore), providerId,
        usageFetch(canvasStore.usage, { providerId, model: modelId, category: 'llm', accepting: () => !canvasWorkStopped(canvasStore) }), true) });
      const { text } = await generateText({
        model,
        system: REFINEMENT_PROMPTS[mode],
        prompt: rawPrompt,
        abortSignal: AbortSignal.any([c.req.raw.signal, canvasWorkSignal(canvasStore)]),
      });

      const refined = text
        .trim()
        .replace(/^```[^\n]*\n?/, '')
        .replace(/\n?```$/, '')
        .replace(/^["'“”]/, '')
        .replace(/["'“”]$/, '')
        .trim();

      return c.json({ refined: refined || rawPrompt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `提示词润色失败: ${msg}` }, 500);
    }
  });

  /** Snapshot (creates the canvas row lazily on first read). */
  router.get('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = await sessionStore.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(canvasStore.getSnapshotBySession(sessionId));
  });

  /** v2 replays durable transaction commits; v1 remains available for existing clients. */
  router.get('/:canvasId/stream', (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const after = Number(c.req.query('after') ?? '-1');
    const cursor = Number.isSafeInteger(after) && after >= -1 ? after : -1;
    const channel = getCanvasChannel(canvasId);
    const signal = AbortSignal.any([c.req.raw.signal, canvasWorkSignal(canvasStore)]);
    return c.req.query('protocol') === '2'
      ? channel.streamCommits(canvasStore, cursor, signal)
      : channel.stream(cursor, signal);
  });

  router.get('/:canvasId/jobs', (c) => {
    const id = c.req.param('canvasId');
    if (!canvasStore.getCanvas(id)) return c.json({ error: 'Canvas not found' }, 404);
    const limit = Number(c.req.query('limit') ?? 100);
    const page = canvasStore.jobs.page(id, { limit, status: c.req.query('status'), search: c.req.query('search'), cursor: c.req.query('cursor') });
    const jobs = page.jobs.map((job) => {
      const node = canvasStore.getNode(id, job.nodeId);
      return { ...job, nodeTitle: node?.title, nodeExists: Boolean(node), isCurrent: canvasStore.jobs.current(id, job.nodeId)?.id === job.id };
    });
    return c.json({ ...page, jobs });
  });

  router.post('/:canvasId/jobs/:jobId/cancel', (c) => {
    const canvasId = c.req.param('canvasId');
    const job = canvasStore.jobs.get(c.req.param('jobId'));
    if (!job || job.canvasId !== canvasId) return c.json({ error: 'Job not found' }, 404);
    if (!['queued', 'running'].includes(job.status)) return c.json({ job });
    if (canvasStore.jobs.current(canvasId, job.nodeId)?.id !== job.id) return c.json({ error: '此任务已被新的执行替代' }, 409);
    const cancelled = (job.nodeType === 'video' && cancelVideoJob(canvasId, job.nodeId, canvasStore)) || nodeJobsFor(canvasStore).cancelNode(canvasId, job.nodeId);
    if (!cancelled) return c.json({ error: '任务状态已变化，请刷新后重试' }, 409);
    const result = canvasStore.jobs.get(job.id);
    if (result.status !== 'cancelled') return c.json({ error: '取消未能保存，请重试' }, 500);
    return c.json({ job: result });
  });

  router.post('/:canvasId/jobs/:jobId/retry', async (c) => {
    const canvasId = c.req.param('canvasId');
    const job = canvasStore.jobs.get(c.req.param('jobId'));
    if (!job || job.canvasId !== canvasId) return c.json({ error: 'Job not found' }, 404);
    const operationId = c.req.header('Idempotency-Key');
    if (!operationId) return c.json({ error: 'Idempotency-Key is required' }, 400);
    // A retry receipt is checked before the latest-generation guard, so a lost response is safe to retry.
    const previous = canvasStore.jobs.findByOperationId(canvasId, operationId);
    if (previous && previous.nodeId !== job.nodeId) return c.json({ error: 'Retry identity belongs to another node' }, 409);
    if (!previous && (!['failed', 'interrupted', 'cancelled'].includes(job.status) || canvasStore.jobs.current(canvasId, job.nodeId)?.id !== job.id))
      return c.json({ error: '只能重试该节点最新的失败、中断或取消任务' }, 409);
    const body = await c.req.json().catch((): null => null);
    if (job.input.presentationRequest) {
      if (!artifactStore) return c.json({ error: 'Artifact store is unavailable' }, 400);
      const accepted = startPresentationExport({ store: canvasStore, artifactStore, dataRoot, canvasId, operationId, targetNodeId: job.nodeId,
        request: job.input.presentationRequest as import('../../../shared/canvasPresentation').PresentationExportRequest, fixedSources: job.input.sources as import('../../../shared/canvasPresentation').PresentationSource[] });
      return c.json({ jobId: accepted.job.id, nodeId: accepted.job.nodeId, status: accepted.job.status }, 202);
    }
    if (job.input.compositionRequest) {
      const accepted = startComposition(canvasStore, dataRoot, canvasId, job.input.compositionRequest, operationId, job.nodeId);
      return c.json({ jobId: accepted.job.id, nodeId: accepted.job.nodeId, status: accepted.job.status }, 202);
    }
    return router.request(`/${canvasId}/nodes/${job.nodeId}/run`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify(body ?? {}) });
  });

  router.get('/:canvasId/jobs/:jobId', (c) => {
    const job = canvasStore.jobs.get(c.req.param('jobId'));
    if (!job || job.canvasId !== c.req.param('canvasId')) return c.json({ error: 'Job not found' }, 404);
    const latest = latestVideoQueryJob(canvasStore, job);
    const observed = { ...latest, observation: videoJobObservation(canvasStore, latest.id) };
    return c.json({ job: latest.id === job.id ? observed : job, ...(latest.id !== job.id ? { recoveryJob: observed } : {}) });
  });

  router.post('/:canvasId/jobs/:jobId/query', (c) => {
    const job = canvasStore.jobs.get(c.req.param('jobId'));
    if (!job || job.canvasId !== c.req.param('canvasId')) return c.json({ error: 'Job not found' }, 404);
    const recovered = recoverVideoJob({ canvasStore, settingsStore, dataRoot, providerStore }, job);
    return c.json({ job: recovered.job }, 202);
  });

  router.get('/:canvasId/deliveries', (c) => {
    if (!canvasStore.getCanvas(c.req.param('canvasId'))) return c.json({ error: 'Canvas not found' }, 404);
    return c.json({ deliveries: canvasStore.deliveries.list(c.req.param('canvasId')) });
  });
  router.get('/:canvasId/deliveries/:planId/exports', (c) => {
    const plan = canvasStore.deliveries.get(c.req.param('planId'));
    if (!plan || plan.canvasId !== c.req.param('canvasId')) return c.json({ error: 'Plan not found' }, 404);
    return c.json({ exports: canvasStore.deliveryExports.list(plan.id) });
  });
  router.post('/:canvasId/presentation-export', async (c) => {
    if (!artifactStore) return c.json({ error: 'Artifact store is unavailable' }, 400);
    const operationId = c.req.header('Idempotency-Key');
    if (!operationId) return c.json({ error: 'Idempotency-Key is required' }, 400);
    const accepted = startPresentationExport({ store: canvasStore, artifactStore, dataRoot, canvasId: c.req.param('canvasId'), operationId,
      request: await c.req.json().catch((): null => null) });
    return c.json({ jobId: accepted.job.id, nodeId: accepted.job.nodeId, status: accepted.job.status }, 202);
  });

  router.post('/:canvasId/compose', async (c) => {
    const operationId = c.req.header('Idempotency-Key');
    if (!operationId) return c.json({ error: 'Idempotency-Key is required' }, 400);
    const accepted = startComposition(canvasStore, dataRoot, c.req.param('canvasId'), await c.req.json().catch((): null => null), operationId);
    return c.json({ jobId: accepted.job.id, nodeId: accepted.job.nodeId, status: accepted.job.status }, 202);
  });

  router.get('/:canvasId/assets', (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    return c.json({ assets: canvasStore.assets.list(canvasId) });
  });

  router.get('/assets/library', (c) => {
    const kind = c.req.query('kind');
    if (kind !== undefined && !['image', 'video', 'audio'].includes(kind)) return c.json({ error: 'Unknown media kind' }, 400);
    const page = canvasStore.assets.page({ kind: kind as 'image' | 'video' | 'audio' | undefined,
      limit: Number(c.req.query('limit') ?? 80), search: c.req.query('search'), folder: c.req.query('folder'),
      tag: c.req.query('tag'), cursor: c.req.query('cursor') });
    const assets = page.assets.map((asset): CanvasAssetSummary => {
      const source = asset.nodeId ? canvasStore.getNode(asset.canvasId, asset.nodeId) : null;
      const summary = { ...asset, label: asset.name || source?.title || (asset.kind === 'audio' ? '音频素材' : asset.kind === 'video' ? '视频素材' : '图片素材') };
      Reflect.deleteProperty(summary, 'inputHash');
      return summary;
    });
    return c.json({ ...page, assets });
  });

  router.patch('/assets/library/:assetId', async (c) => {
    return c.json({ asset: canvasStore.assets.updateMetadata(c.req.param('assetId'), await c.req.json().catch((): null => null)) });
  });

  router.post('/:canvasId/assets/reuse', async (c) => {
    const canvasId = c.req.param('canvasId');
    const parsed = reuseRequest.safeParse(await c.req.json().catch((): null => null));
    if (!parsed.success) return c.json({ error: '请指定一个有效的素材或来源版本' }, 400);
    const input = parsed.data;
    const request = { kind: 'reuse_asset', input };
    const operationId = c.req.header('Idempotency-Key');
    type Reused = ReturnType<typeof canvasApp.reuseAsset>;
    const replay = canvasApp.replay<Reused>(canvasId, request, operationId);
    if (replay) return c.json(replay, 201);
    let asset = input.assetId ? canvasStore.assets.get(input.assetId) : null;
    let legacy: { path: string; canvasId: string; nodeId: string } | undefined;
    if (input.assetId && !asset) return c.json({ error: '素材不存在，请重新选择' }, 404);
    if (!input.assetId) {
      const sourceCanvasId = input.sourceCanvasId ?? canvasId;
      const source = canvasStore.getNode(sourceCanvasId, input.sourceNodeId);
      if (!source) return c.json({ error: '来源节点不存在' }, 404);
      const index = input.assetIndex ?? source.output?.activeAssetIndex ?? 0;
      const selectedPath = source.output?.assets?.[index];
      if (!selectedPath) return c.json({ error: '所选版本不可用' }, 400);
      if (input.expectedPath && input.expectedPath !== selectedPath) return c.json({ error: '素材版本已变化，请重新选择' }, 409);
      asset = canvasStore.assets.findByPath(selectedPath);
      legacy = { path: selectedPath, canvasId: sourceCanvasId, nodeId: source.id };
    }
    const path = asset?.path ?? legacy.path;
    let bytes: Buffer;
    try { bytes = await readCanvasAsset(dataRoot, path); }
    catch { return c.json({ error: '素材文件不可用，请重新选择' }, 404); }
    if (asset && createHash('sha256').update(bytes).digest('hex') !== asset.contentHash) return c.json({ error: '素材文件已发生变化，请重新导入' }, 409);
    const result = canvasApp.batch(canvasId, request, () => {
      if (!asset) {
        const mimeType = mimeForExtension(path.split('.').pop()?.toLowerCase() || '');
        asset = canvasStore.assets.findByPath(path) ?? canvasStore.assets.register({ id: nanoid(), path, canvasId: legacy.canvasId,
          nodeId: legacy.nodeId, source: 'imported', kind: kindForMime(mimeType), mimeType,
          byteSize: bytes.byteLength, contentHash: createHash('sha256').update(bytes).digest('hex') });
      }
      return canvasApp.reuseAsset(canvasId, { assetId: asset.id, x: input.x, y: input.y, title: input.title, asReference: input.asReference });
    }, operationId);
    return c.json(result, 201);
  });

  router.get('/:canvasId/assets/:assetId', (c) => {
    const asset = canvasStore.assets.get(c.req.param('assetId'));
    if (!asset || asset.canvasId !== c.req.param('canvasId')) return c.json({ error: 'Asset not found' }, 404);
    return c.json({ asset });
  });

  router.get('/assets/:canvasId/:file', async (c) => {
    const rel = `${c.req.param('canvasId')}/${c.req.param('file')}`;
    try {
      const metadata = canvasStore.assets.findByPath(rel);
      const bytes = await readCanvasAsset(dataRoot, rel);
      const type = metadata?.mimeType ?? mimeForExtension(rel.split('.').pop()?.toLowerCase() || '');
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': SAFE_MEDIA_MIMES.has(type) ? type : 'application/octet-stream', 'cache-control': 'private, max-age=31536000', 'x-content-type-options': 'nosniff' },
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  router.post('/:canvasId/nodes', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    const type = body?.type as CanvasNodeType;
    if (!NODE_TYPES.has(type)) {
      return c.json({ error: `type must be one of ${[...NODE_TYPES].join(', ')}` }, 400);
    }
    const box = defaultNodeBox(type);
    const { node } = canvasApp.addNode(canvasId, {
      id: body.id,
      type,
      x: typeof body.x === 'number' ? body.x : 0,
      y: typeof body.y === 'number' ? body.y : 0,
      w: typeof body.w === 'number' ? body.w : box.w,
      h: typeof body.h === 'number' ? body.h : box.h,
      title: typeof body.title === 'string' ? body.title : '',
      params: body.params && typeof body.params === 'object' ? body.params : {},
    }, c.req.header('Idempotency-Key'));
    return c.json({ node }, 201);
  });

  router.patch('/:canvasId/nodes/:id', async (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const body = await c.req.json().catch((): null => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'body required' }, 400);
    const patch: Record<string, unknown> = {};
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      if (typeof body[key] === 'number') patch[key] = body[key];
    }
    if (typeof body.title === 'string') patch.title = body.title;
    const paramsChanged = body.params && typeof body.params === 'object';
    if (paramsChanged) patch.params = body.params;
    if (body.output && typeof body.output === 'object') patch.output = body.output;
    const result = canvasApp.updateNode(canvasId, id, patch, c.req.header('Idempotency-Key'));
    if (!result) return c.json({ error: 'Node not found' }, 404);
    return c.json({ node: result.node });
  });

  router.delete('/:canvasId/nodes/:id', (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const result = canvasApp.deleteNode(canvasId, id, c.req.header('Idempotency-Key'));
    if (!result) return c.json({ error: 'Node not found' }, 404);
    return c.body(null, 204);
  });

  router.post('/:canvasId/edges', async (c) => {
    const canvasId = c.req.param('canvasId');
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.sourceId !== 'string' || typeof body?.targetId !== 'string') {
      return c.json({ error: 'sourceId and targetId are required' }, 400);
    }
    const result = canvasApp.addEdge(canvasId, {
      sourceId: body.sourceId,
      sourceHandle: typeof body.sourceHandle === 'string' ? body.sourceHandle : null,
      targetId: body.targetId,
      targetHandle: typeof body.targetHandle === 'string' ? body.targetHandle : null,
    }, c.req.header('Idempotency-Key'));
    if (result.error === 'cycle') {
      return c.json({ error: 'That connection would create a cycle' }, 409);
    }
    if (result.error === 'incompatible') {
      return c.json({ error: 'Port incompatible between source and target' }, 400);
    }
    if (result.error || !result.edge || result.rev === undefined) {
      return c.json({ error: 'source or target node not found' }, 404);
    }
    return c.json({ edge: result.edge }, 201);
  });

  router.delete('/:canvasId/edges/:id', (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const result = canvasApp.deleteEdge(canvasId, id, c.req.header('Idempotency-Key'));
    if (!result) return c.json({ error: 'Edge not found' }, 404);
    return c.body(null, 204);
  });

  /**
   * Run one node. Image generation is a paid call, so the renderer must send
   * `confirmedSpend: true` (a pre-flight dialog, not the chat permission
   * system — see docs/canvas-plan.md R3). Fire-and-forget: the executor
   * broadcasts run-state / output on the channel.
   */
  router.post('/:canvasId/nodes/:id/run', async (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const node = canvasStore.getNode(canvasId, id);
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));

    if (isPresentationExportNode(node)) {
      if (!artifactStore) return c.json({ error: 'Artifact store is unavailable' }, 400);
      const local = (node.params as any).localExport;
      const accepted = startPresentationExport({ store: canvasStore, artifactStore, dataRoot, canvasId, request: local.request, fixedSources: local.sources,
        operationId: c.req.header('Idempotency-Key') ?? nanoid(), targetNodeId: node.id });
      return c.json({ jobId: accepted.job.id, nodeId: node.id, status: accepted.job.status }, 202);
    }
    if (isImportedMedia(node)) return c.json({ ok: true, status: 'done', node, note: '已有素材可以直接引用；填写提示词后可生成新版本。' });

    if (node.type === 'image') {
      if (body?.confirmedSpend !== true) {
        return c.json({ error: 'confirmedSpend required for a paid generation' }, 402);
      }
      const accepted = startImageNode({
        canvasStore,
        settingsStore,
        dataRoot,
        canvasId,
        node,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        operationId: c.req.header('Idempotency-Key') ?? (typeof body.operationId === 'string' ? body.operationId : undefined),
      });
      void accepted.completion.catch((err: unknown) => console.error('[canvas] accepted image job failed', err));
      return c.json({ ok: true, jobId: accepted.job.id, status: accepted.job.status }, 202);
    }

    if (node.type === 'video') {
      if (body?.confirmedSpend !== true) {
        return c.json({ error: 'confirmedSpend required for a paid generation' }, 402);
      }
      const accepted = startVideoNode({
        canvasStore,
        settingsStore,
        providerStore,
        dataRoot,
        canvasId,
        node,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        operationId: c.req.header('Idempotency-Key') ?? (typeof body.operationId === 'string' ? body.operationId : undefined),
      });
      void accepted.completion.catch((error) => console.error('[canvas] accepted video job failed', error));
      return c.json({ ok: true, jobId: accepted.job.id, status: accepted.job.status }, 202);
    }

    if (node.type === 'audio') {
      if (body?.confirmedSpend !== true) {
        return c.json({ error: 'confirmedSpend required for a paid generation' }, 402);
      }
      if (!providerStore) return c.json({ error: 'Audio provider store is unavailable' }, 400);
      const accepted = startAudioNode({
        canvasStore, providerStore, dataRoot, canvasId, node,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        operationId: c.req.header('Idempotency-Key') ?? (typeof body.operationId === 'string' ? body.operationId : undefined),
      });
      void accepted.completion.catch((error) => console.error('[canvas] accepted audio job failed', error));
      return c.json({ ok: true, jobId: accepted.job.id, status: accepted.job.status }, 202);
    }

    if (node.type !== 'agent') return c.json({ error: '此节点类型不支持执行' }, 400);
    const accepted = startAgentNode({ canvasStore, settingsStore, dataRoot, canvasId, node,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      operationId: c.req.header('Idempotency-Key') ?? (typeof body.operationId === 'string' ? body.operationId : undefined) });
    void accepted.completion.catch((error) => console.error('[canvas] accepted Agent job failed', error));
    return c.json({ ok: true, jobId: accepted.job.id, status: accepted.job.status }, 202);
  });

  /**
   * Run the graph in topological order. `?from=<nodeId>` restricts it to that
   * node and its descendants. Paid (image nodes) -> `confirmedSpend` required.
   */
  router.post('/:canvasId/run', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    if (body?.confirmedSpend !== true) {
      return c.json({ error: 'confirmedSpend required for a paid run' }, 402);
    }
    const fromNodeId = typeof body.from === 'string' ? body.from : undefined;
    if (fromNodeId && !canvasStore.getNode(canvasId, fromNodeId)) {
      return c.json({ error: 'from node not found' }, 404);
    }
    const nodeIds = Array.isArray(body.nodeIds)
      ? body.nodeIds.filter((id: unknown): id is string => typeof id === 'string')
      : undefined;
    void runGraph({
      canvasStore,
      settingsStore,
      dataRoot,
      canvasId,
      fromNodeId,
      nodeIds,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      providerStore,
      artifactStore,
    });
    return c.json({ ok: true }, 202);
  });

  router.post('/:canvasId/run/stop', (c) => {
    const stopped = stopCanvasRun(c.req.param('canvasId'), canvasStore);
    return c.json({ stopped, running: isCanvasRunning(c.req.param('canvasId')) });
  });

  /** Import a dropped image file as a `done` image node. */
  router.post('/:canvasId/import', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.dataBase64 !== 'string' || typeof body?.name !== 'string') {
      return c.json({ error: 'name and dataBase64 are required' }, 400);
    }
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > IMPORT_MAX_BYTES) {
      return c.json({ error: `Image must be 1 byte – ${IMPORT_MAX_BYTES} bytes` }, 413);
    }
    const ext = (body.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const isAudioExt = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext);
    const nodeType: CanvasNodeType =
      body.type === 'anchor'
        ? 'anchor'
        : body.type === 'audio' || isAudioExt
          ? 'audio'
          : body.type === 'video' || ['mp4', 'webm'].includes(ext) ? 'video' : 'image';
    const box = defaultNodeBox(nodeType);
    const defaultParams =
      nodeType === 'anchor'
        ? { role: 'character', strength: 'mid' }
        : nodeType === 'audio'
          ? { prompt: '' }
          : { prompt: '', size: '1024x1024' };
    const nodeInput = {
      type: nodeType,
      x: typeof body.x === 'number' ? body.x : 40,
      y: typeof body.y === 'number' ? body.y : 40,
      w: box.w,
      h: box.h,
      title: body.name.slice(0, 80),
      params: body.params && typeof body.params === 'object' ? { ...defaultParams, ...body.params } : defaultParams,
    };
    const mimeType = mimeForExtension(ext);
    const staged = await stageCanvasAssets(dataRoot, canvasId, [{ name: `import-${nanoid(6)}.${ext}`, bytes, kind: kindForMime(mimeType), mimeType }],
      AbortSignal.any([c.req.raw.signal, canvasWorkSignal(canvasStore)]));
    try {
      staged.prepareCommit();
      const file = staged.files[0];
      const imported = canvasApp.batch(canvasId, { kind: 'import_asset', nodeInput, contentHash: file.contentHash, mimeType }, () => {
        const { node } = canvasApp.addNode(canvasId, nodeInput);
        const asset = canvasStore.assets.register({ ...file, canvasId, nodeId: node.id, source: 'imported' });
        const withAsset = canvasApp.updateNode(canvasId, node.id, {
          runState: 'done', output: { assets: [asset.path], resultSet: [{ asset: asset.path, assetId: asset.id, createdAt: asset.createdAt }] },
        });
        if (!withAsset) throw new Error('Imported asset could not update its node');
        canvasApp.afterCommit(() => staged.keep());
        return withAsset.node;
      }, c.req.header('Idempotency-Key'));
      return c.json({ node: imported }, 201);
    } finally { await staged.discard(); }
  });

  /** Attach an asset (e.g. extracted video frame) directly to a node's output. */
  router.post('/:canvasId/nodes/:id/asset', async (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const node = canvasStore.getNode(canvasId, id);
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    if (!body || typeof body.dataBase64 !== 'string') {
      return c.json({ error: 'dataBase64 is required' }, 400);
    }
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (!bytes.byteLength || bytes.byteLength > IMPORT_MAX_BYTES) return c.json({ error: `Asset must be 1 byte – ${IMPORT_MAX_BYTES} bytes` }, 413);
    const ext = (typeof body.name === 'string' ? body.name.split('.').pop() || 'png' : 'png')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'png';
    const mimeType = mimeForExtension(ext);
    const staged = await stageCanvasAssets(dataRoot, canvasId, [{ name: `${id}-frame-${nanoid(6)}.${ext}`, bytes, kind: kindForMime(mimeType), mimeType }],
      AbortSignal.any([c.req.raw.signal, canvasWorkSignal(canvasStore)]));
    try {
      staged.prepareCommit();
      const file = staged.files[0];
      const attached = canvasApp.batch(canvasId, { kind: 'attach_asset', id, contentHash: file.contentHash, mimeType }, () => {
        const asset = canvasStore.assets.register({ ...file, canvasId, nodeId: id, source: 'imported' });
        if (node.type === 'anchor' && asset.kind !== 'image' && asset.kind !== 'mask') throw new CanvasCommandError('参考锚点仅支持图片素材');
        const params = node.type === 'anchor' ? { ...node.params, assetId: asset.id }
          : typeof (node.params as { importedAssetId?: unknown }).importedAssetId === 'string' ? { ...node.params, importedAssetId: asset.id } : undefined;
        const result = canvasApp.updateNode(canvasId, id, { runState: 'done', ...(params ? { params } : {}), output: {
          assets: [asset.path], resultSet: [{ asset: asset.path, assetId: asset.id, createdAt: asset.createdAt }],
        } });
        if (!result) throw new CanvasCommandError('Node not found', 404);
        canvasApp.afterCommit(() => staged.keep());
        return result.node;
      }, c.req.header('Idempotency-Key'));
      return c.json({ node: attached }, 200);
    } finally { await staged.discard(); }
  });

  /** Upload a mask PNG for an edit node. Does not mutate node output. */
  router.post('/:canvasId/nodes/:id/mask', async (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    if (!canvasStore.getNode(canvasId, id)) return c.json({ error: 'Node not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    if (!body || typeof body.dataBase64 !== 'string') return c.json({ error: 'dataBase64 is required' }, 400);
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (!bytes.byteLength || bytes.byteLength > IMPORT_MAX_BYTES) return c.json({ error: `Mask must be 1 byte – ${IMPORT_MAX_BYTES} bytes` }, 413);
    const staged = await stageCanvasAssets(dataRoot, canvasId, [{ name: `${id}-mask-${nanoid(6)}.png`, bytes, kind: 'mask', mimeType: 'image/png' }],
      AbortSignal.any([c.req.raw.signal, canvasWorkSignal(canvasStore)]));
    try {
      staged.prepareCommit();
      const file = staged.files[0];
      const asset = canvasApp.batch(canvasId, { kind: 'upload_mask', id, contentHash: file.contentHash }, () => {
        const saved = canvasStore.assets.register({ ...file, canvasId, nodeId: id, source: 'mask' });
        canvasApp.afterCommit(() => staged.keep());
        return saved;
      }, c.req.header('Idempotency-Key'));
      return c.json({ maskAsset: asset.path, assetId: asset.id }, 201);
    } finally { await staged.discard(); }
  });

  /** Download the whole canvas as a portable `.reizo.zip` (workflow.json + assets). */
  router.get('/:canvasId/workflow/export', async (c) => {
    const canvasId = c.req.param('canvasId');
    const canvas = canvasStore.getCanvas(canvasId);
    if (!canvas) return c.json({ error: 'Canvas not found' }, 404);
    const session = await sessionStore.get(canvas.sessionId).catch((): null => null);
    try {
      const zip = await exportWorkflowZip({
        canvasStore,
        dataRoot,
        canvasId,
        title: session?.title || 'canvas',
      });
      return new Response(new Uint8Array(zip), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="reizo-canvas-${canvasId.slice(0, 8)}.reizo.zip"`,
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'export failed' }, 500);
    }
  });

  /** Merge a `.reizo.zip` into this canvas with fresh ids. Body: `{ zipBase64 }`. */
  router.post('/:canvasId/workflow/import', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.zipBase64 !== 'string') {
      return c.json({ error: 'zipBase64 is required' }, 400);
    }
    const zip = Buffer.from(body.zipBase64, 'base64');
    if (zip.byteLength === 0 || zip.byteLength > WORKFLOW_MAX_BYTES) {
      return c.json({ error: `zip must be 1 byte – ${WORKFLOW_MAX_BYTES} bytes` }, 413);
    }
    try {
      const result = await importWorkflowZip({
        canvasStore,
        dataRoot,
        canvasId,
        zip: new Uint8Array(zip),
      });
      return c.json(result, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'import failed' }, 422);
    }
  });

  /** Copy one of a node's output images into the session's Artifacts. */
  router.post('/:canvasId/nodes/:id/save-asset', async (c) => {
    if (!artifactStore) return c.json({ error: 'Artifacts unavailable' }, 501);
    const canvasId = c.req.param('canvasId');
    const node = canvasStore.getNode(canvasId, c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    const index = typeof body.assetIndex === 'number' ? body.assetIndex : 0;
    const rel = node.output?.assets?.[index];
    if (!rel) return c.json({ error: 'No such asset' }, 404);
    const canvas = canvasStore.getCanvas(canvasId);
    const mediaAsset = canvasStore.assets.findByPath(rel);
    const resultVersion = node.output?.resultSet?.find((item) => item.asset === rel);
    let bytes: Buffer;
    try {
      bytes = await readCanvasAsset(dataRoot, rel);
    } catch {
      return c.json({ error: 'Asset missing on disk' }, 404);
    }
    const session = canvas ? await sessionStore.get(canvas.sessionId) : null;
    const ext = (rel.split('.').pop() || 'png').toLowerCase();
    // Stable per-node name so re-saving a re-run of the same node appends a
    // version to one artifact instead of piling up rows (IM3 — regenerate
    // history via the version rail).
    const name = `${(node.title || 'canvas-media').replace(/[^\w.-]+/g, '-').slice(0, 48)}-${node.id.slice(0, 6)}.${ext}`;
    const p = node.params as { prompt?: string; model?: string };
    const artifact = await artifactStore.createOrAddVersion({
      sessionId: canvas?.sessionId ?? '',
      projectId: session?.projectId ?? null,
      name,
      kind: (mediaAsset?.kind === 'audio' || mediaAsset?.kind === 'video') ? mediaAsset.kind : kindForMime(mimeForExtension(ext)),
      bytes,
      mimeType: mediaAsset?.mimeType ?? mimeForExtension(ext),
      source: mediaAsset?.source === 'imported' || mediaAsset?.source === 'mask' ? 'attachment' : 'generated',
      origin: {
        surface: 'canvas',
        canvasNodeId: node.id,
        canvasId,
        prompt: (resultVersion?.prompt ?? (mediaAsset ? undefined : p.prompt))?.slice(0, 400),
        model: mediaAsset ? mediaAsset.model : resultVersion?.model ?? p.model,
        canvasAssetId: mediaAsset?.id,
        jobId: mediaAsset?.jobId,
        generation: mediaAsset?.generation,
        providerId: mediaAsset?.providerId,
        inputHash: mediaAsset?.inputHash,
        contentHash: mediaAsset?.contentHash,
      },
    });
    return c.json({ artifact }, 201);
  });

  /** Record the user's current node selection (feeds the agent's canvas summary). */
  router.put('/:canvasId/selection', async (c) => {
    const body = await c.req.json().catch((): null => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === 'string') : [];
    setCanvasSelection(c.req.param('canvasId'), ids);
    return c.json({ ok: true });
  });

  return router;
}
