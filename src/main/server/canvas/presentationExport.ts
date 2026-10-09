import PptxGenJS from 'pptxgenjs';
import { imageSize } from 'image-size';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { CanvasStore } from '../storage/canvasStore';
import type { ArtifactStore } from '../storage/artifactStore';
import type { PresentationExportRequest, PresentationSource } from '../../../shared/canvasPresentation';
import { selectedAsset } from '../../../shared/canvasReferences';
import { createCanvasApplication, CanvasCommandError } from './application';
import { readCanvasAsset } from './assets';
import { nodeJobsFor, type NodeJobContext, type NodeJobSubmission } from './nodeJobs';
import { getCanvasChannel } from './channel';
import { createGenerationScheduler, type GenerationScheduler } from './generationScheduler';
import { canvasWorkSignal } from './workLifecycle';
import { runMediaProcess } from './composition';
import { inputHash } from './graph';
import type { CanvasJobFinish } from '../../../shared/canvasJobs';
import { normalizeGeneratedPresentation } from './presentationValidation';
import { assetAvailableInCanvas } from './assetScope';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const requestSchema = z.object({ title: z.string().trim().min(1).max(160).default('演示稿'), planId: z.string().min(1).optional(),
  pages: z.array(z.object({ nodeId: z.string().min(1).optional(), assetId: z.string().min(1).optional(), expectedPath: z.string().min(1).max(1024).optional() }).refine((page) => Boolean(page.nodeId || page.assetId))).min(1).max(40) });
const pools = new WeakMap<CanvasStore, GenerationScheduler>();
function pool(store: CanvasStore) {
  let value = pools.get(store);
  if (!value) { value = createGenerationScheduler({ globalLimit: 1, providerLimit: 1, signal: canvasWorkSignal(store) }); pools.set(store, value); }
  return value;
}
export function startPresentationExport(options: { store: CanvasStore; artifactStore: ArtifactStore; dataRoot: string; canvasId: string;
  request: PresentationExportRequest; operationId: string; targetNodeId?: string; fixedSources?: PresentationSource[]; signal?: AbortSignal }): NodeJobSubmission {
  const { store, canvasId, operationId } = options;
  nodeJobsFor(store).assertAccepting();
  const parsed = requestSchema.safeParse(options.request);
  if (!parsed.success) throw new CanvasCommandError(parsed.error.message);
  const request = parsed.data;
  const existing = store.jobs.findByOperationId(canvasId, operationId);
  if (existing) {
    const previous = requestSchema.safeParse(existing.input.presentationRequest);
    if (!previous.success || JSON.stringify(previous.data) !== JSON.stringify(request) || options.targetNodeId && existing.nodeId !== options.targetNodeId)
      throw new CanvasCommandError('操作 ID 已用于不同的演示稿导出', 409);
    return nodeJobsFor(store).replay(canvasId, existing.nodeId, operationId, undefined, 'note') ?? { job: existing, completion: Promise.resolve() };
  }
  const canvas = store.getCanvas(canvasId);
  if (!canvas) throw new CanvasCommandError('画布不存在', 404);
  const sources: PresentationSource[] = options.fixedSources ?? request.pages.map((page) => {
    const node = page.nodeId ? store.getNode(canvasId, page.nodeId) : undefined;
    if (page.nodeId && (!node || !['image', 'anchor', 'frameExtractor'].includes(node.type))) throw new CanvasCommandError('演示稿只能选择已有图片页');
    const selected = node ? selectedAsset(node) : undefined;
    const asset = page.assetId ? store.assets.get(page.assetId) : selected ? store.assets.findByPath(selected) : undefined;
    if (page.assetId && (!asset || asset.kind !== 'image' || !assetAvailableInCanvas(store, canvasId, asset))) throw new CanvasCommandError('已选图片版本不在当前画布中');
    if (node && page.assetId && asset.nodeId !== node.id && !node.output?.assets?.includes(asset.path) && (node.params as { assetId?: string }).assetId !== asset.id)
      throw new CanvasCommandError('已选页图版本不属于该节点');
    const file = asset?.path ?? selected;
    if (!file) throw new CanvasCommandError('图片页尚无产物');
    return { nodeId: node?.id, assetId: asset?.id, path: file, contentHash: asset?.contentHash, title: node?.title || asset?.name || '图片页' };
  });
  if (sources.length !== request.pages.length) throw new CanvasCommandError('演示稿来源数量不匹配');
  for (const [index, source] of sources.entries()) {
    if (request.pages[index].expectedPath && request.pages[index].expectedPath !== source.path) throw new CanvasCommandError('已选页图版本已变化，请重新确认导出', 409);
    const registered = source.assetId ? store.assets.get(source.assetId) : null;
    if (source.assetId && (!registered || registered.kind !== 'image' || registered.path !== source.path || registered.contentHash !== source.contentHash || !assetAvailableInCanvas(store, canvasId, registered))) throw new CanvasCommandError('固定页图版本已变化或不在当前画布中');
    if (!source.assetId && !store.getNodes(canvasId).some((node) => node.output?.assets?.includes(source.path))) throw new CanvasCommandError('未登记页图已不在当前画布中');
  }
  if (request.planId) {
    const plan = store.deliveries.get(request.planId);
    if (!plan || plan.canvasId !== canvasId || plan.plan.input.pages !== sources.length || sources.some((source) => !source.assetId))
      throw new CanvasCommandError('交付计划、页数或已登记页图不匹配');
  }
  const app = createCanvasApplication(store);
  return app.batch(canvasId, { kind: 'presentation_export', request }, () => {
    const last = request.pages.at(-1)?.nodeId ? store.getNode(canvasId, request.pages.at(-1).nodeId) : store.getNodes(canvasId).at(-1);
    const node = options.targetNodeId ? store.getNode(canvasId, options.targetNodeId) : app.addNode(canvasId, { type: 'note', x: (last?.x ?? 40) + (last?.w ?? 320) + 80, y: last?.y ?? 40,
      w: 340, h: 240, title: request.title, params: { content: '演示稿导出', localExport: { kind: 'pptx-image-pages', request, sources, artifactId: nanoid() } } }).node;
    const local = (node?.params as { localExport?: { artifactId?: string } })?.localExport;
    if (!node || node.type !== 'note' || !local?.artifactId) throw new CanvasCommandError('本地演示稿节点不存在', 404);
    const input = { presentationRequest: request, sources, artifactId: local.artifactId, node };
    return nodeJobsFor(store).start({ canvasId, nodeId: node.id, nodeType: 'note', operationId, input, signal: options.signal,
      inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      execute: (job) => render(options, input, job),
      onFailure: (error, job) => {
        const message = error instanceof Error ? error.message : String(error);
        const result = job.finish('failed', () => store.updateNode(canvasId, node.id, { runState: 'error', output: { ...store.getNode(canvasId, node.id)?.output, error: message } }), { error: message });
        if (result) getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
      },
      onCancelled: (reason) => {
        const current = store.getNode(canvasId, node.id); if (!current) return;
        const result = store.updateNode(canvasId, node.id, { runState: reason === 'interrupted' ? 'error' : 'idle',
          output: { ...current.output, progress: undefined, error: reason === 'interrupted' ? '本地演示稿导出因应用退出中断' : undefined } });
        if (!result) throw new Error('导出取消状态未保存');
        return () => getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
      },
    });
  });
}

async function render(options: Parameters<typeof startPresentationExport>[0], input: { presentationRequest: z.output<typeof requestSchema>; sources: PresentationSource[]; artifactId: string; node: import('../../../shared/canvas').CanvasNode }, job: NodeJobContext) {
  const { store, artifactStore, dataRoot, canvasId } = options;
  // Keep the one local compute permit until JSZip finishes even if the caller cancels.
  const release = await pool(store).acquire('local:pptx');
  let prepared: Awaited<ReturnType<ArtifactStore['preparePublish']>> | undefined;
  let workDir: string | undefined;
  try {
    if (!job.isCurrent()) return;
    if (!job.markSubmitted({ providerId: 'local', model: 'pptxgenjs-4.0.1' })) return;
    const running = store.updateNode(canvasId, input.node.id, { runState: 'running', output: { ...store.getNode(canvasId, input.node.id)?.output, progress: 0, error: undefined } });
    if (running) getCanvasChannel(canvasId).broadcast(running.rev, { type: 'node_updated', node: running.node });
    const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE'; deck.author = 'Reizo';
    deck.title = Array.from(input.presentationRequest.title).map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('');
    let totalBytes = 0;
    for (let i = 0; i < input.sources.length; i++) {
      if (!job.isCurrent()) return;
      const source = input.sources[i]; let bytes = await readCanvasAsset(dataRoot, source.path);
      if (!job.isCurrent()) return;
      if (source.contentHash && createHash('sha256').update(bytes).digest('hex') !== source.contentHash) throw new Error('已选图片版本的内容已变化');
      totalBytes += bytes.length; if (totalBytes > 128 * 1024 * 1024) throw new Error('演示稿图片总大小超过 128 MB');
      const dimensions = imageSize(bytes);
      if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 32_000_000 || dimensions.width > 12000 || dimensions.height > 12000) throw new Error('页图尺寸无效或超过本地导出上限');
      let type = dimensions.type;
      if (type === 'webp') {
        const tempRoot = path.resolve(os.tmpdir()); workDir ??= await mkdtemp(path.join(tempRoot, 'reizo-pptx-'));
        const original = path.join(workDir, `${i}.webp`); const png = path.join(workDir, `${i}.png`); await writeFile(original, bytes);
        let ffmpeg = process.env.REIZO_FFMPEG_PATH;
        if (!ffmpeg) { const bundled = path.join(process.resourcesPath ?? '', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'); try { await access(bundled); ffmpeg = bundled; } catch { ffmpeg = 'ffmpeg'; } }
        await runMediaProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', original, '-frames:v', '1', png], job.signal);
        bytes = await readFile(png); type = 'png';
      }
      if (!job.isCurrent()) return;
      if (!['png', 'jpg', 'jpeg', 'gif'].includes(type)) throw new Error('演示稿页图格式暂不支持');
      const width = 13.3333333333; const height = 7.5; const scale = Math.min(width / dimensions.width, height / dimensions.height);
      const slide = deck.addSlide(); slide.background = { color: 'FFFFFF' };
      slide.addImage({ data: `image/${type === 'jpg' ? 'jpeg' : type};base64,${bytes.toString('base64')}`, x: (width - dimensions.width * scale) / 2,
        y: (height - dimensions.height * scale) / 2, w: dimensions.width * scale, h: dimensions.height * scale, objectName: `Page ${i + 1}` });
      const progress = store.updateNode(canvasId, input.node.id, { output: { ...store.getNode(canvasId, input.node.id)?.output, progress: Math.round((i + 1) * 80 / input.sources.length) } });
      if (progress && job.isCurrent()) getCanvasChannel(canvasId).broadcast(progress.rev, { type: 'node_updated', node: progress.node });
    }
    const generated = Buffer.from(await deck.write({ outputType: 'nodebuffer', compression: false }) as Uint8Array);
    if (!job.isCurrent()) return;
    const bytes = await normalizeGeneratedPresentation(generated, input.sources.length);
    if (!job.isCurrent()) return;
    const canvas = store.getCanvas(canvasId);
    const metadata = { presentation: { format: 'pptx', ratio: '16:9', pageCount: input.sources.length, editableMode: 'image_pages', textEditable: false,
      planId: input.presentationRequest.planId, sourcePages: input.sources } };
    prepared = await artifactStore.preparePublish({ artifactId: input.artifactId, sessionId: canvas.sessionId, name: `${deck.title.replace(/(?:\.pptx)+$/i, '')}.pptx`, kind: 'binary', renderer: 'raw',
      mimeType: PPTX_MIME, bytes, source: 'manual', origin: { surface: 'canvas', canvasId, canvasNodeId: input.node.id, jobId: job.id, providerId: 'local', model: 'pptxgenjs-4.0.1' }, metadata }, job.signal);
    if (!job.isCurrent()) return;
    prepared.prepareCommit();
    const details: CanvasJobFinish = {};
    const result = job.finish('succeeded', () => {
      const artifact = prepared.commit();
      details.result = { artifactId: artifact.id, artifactVersion: artifact.version, downloadUrl: artifact.rawUrl, contentHash: prepared.digest,
        pageCount: input.sources.length, editableMode: 'image_pages' };
      if (input.presentationRequest.planId) store.deliveryExports.register({ planId: input.presentationRequest.planId, artifactId: artifact.id, artifactVersion: artifact.version,
        format: 'pptx', jobId: job.id, sourceAssetIds: input.sources.map((source) => source.assetId), pageCount: input.sources.length, contentHash: prepared.digest });
      return store.updateNode(canvasId, input.node.id, { runState: 'done', paramsHash: inputHash(input.node, []), output: {
        artifactId: artifact.id, artifactVersion: artifact.version, downloadUrl: artifact.rawUrl, pageCount: input.sources.length, text: `已导出 ${input.sources.length} 页图片演示稿` } });
    }, details);
    if (result) { prepared.keep(); getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node }); }
  } finally {
    release(); await prepared?.discard();
    if (workDir && path.dirname(path.resolve(workDir)) === path.resolve(os.tmpdir())) await rm(workDir, { recursive: true, force: true });
  }
}
