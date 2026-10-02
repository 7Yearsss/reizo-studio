import type { CanvasAudioParams, CanvasNode } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import type { ProviderStore } from '../storage/providerStore';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { getCanvasChannel } from './channel';
import { broadcastDownstreamDirty } from './imageExecutor';
import { stageCanvasAssets, type StagedCanvasAssets } from './assets';
import type { CanvasJobFinish } from '../../../shared/canvasJobs';
import { resolveMentions } from '../../../shared/resolveMentions';
import { getAudioDriver, type AudioGenerateParams } from './audioDrivers';
import { canvasWorkSignal, canvasWorkStopped } from './workLifecycle';
import { nodeJobsFor, NodeJobsClosedError, type NodeJobContext, type NodeJobSubmission } from './nodeJobs';
import { generationSchedulerFor } from './generationScheduler';
import { inputHash } from './graph';
import { classifyMediaError } from './mediaError';

export interface AudioRunOptions {
  canvasStore: CanvasStore;
  providerStore: ProviderStore;
  dataRoot: string;
  canvasId: string;
  node: CanvasNode;
  providerId?: string;
  signal?: AbortSignal;
  operationId?: string;
}

interface AudioParameters extends CanvasAudioParams {
  providerId?: string;
  voiceId?: string;
  speed?: number;
  pitch?: number;
  vol?: number;
  emotion?: string;
}

interface AudioJobInput {
  request: { providerId?: string };
  node: CanvasNode;
  upstream: CanvasNode[];
  mentions: Array<{ id: string; label: string; assets: string[]; text?: string }>;
  prompt: string;
}

class AudioPreparationError extends Error {}

function canCommit(options: AudioRunOptions, job: NodeJobContext): boolean {
  return !canvasWorkStopped(options.canvasStore) && job.isCurrent();
}

function failureMessage(error: unknown): string {
  return error instanceof AudioPreparationError ? error.message : classifyMediaError(error).message;
}

function failAudioJob(options: AudioRunOptions, job: NodeJobContext, message: string): void {
  if (!canCommit(options, job)) return;
  const { canvasStore: store, canvasId, node } = options;
  const output = { ...(store.getNode(canvasId, node.id)?.output ?? {}), error: message };
  const failed = job.finish('failed', () => store.updateNode(canvasId, node.id, { runState: 'error', output }), { error: message });
  if (failed) {
    getCanvasChannel(canvasId).broadcast(failed.rev, { type: 'node_updated', node: failed.node });
    broadcastDownstreamDirty(store, canvasId, node.id, failed.rev);
  }
}

export function replayAudioJob(store: CanvasStore, canvasId: string, nodeId: string, operationId?: string, providerId?: string): NodeJobSubmission | null {
  const runtime = nodeJobsFor(store);
  if (canvasWorkStopped(store)) throw new NodeJobsClosedError();
  return runtime.replay(canvasId, nodeId, operationId, providerId, 'audio');
}

/** Freeze the document request and persist its identity before asynchronous provider preparation. */
export function startAudioNode(options: AudioRunOptions): NodeJobSubmission {
  const { canvasStore: store, canvasId, providerId, operationId } = options;
  const receipt = replayAudioJob(store, canvasId, options.node.id, operationId, providerId);
  if (receipt) return receipt;
  const snapshot = store.getSnapshot(canvasId);
  const node = snapshot?.nodes.find((candidate) => candidate.id === options.node.id);
  if (!node) throw new CanvasJobStoreError('Canvas audio node not found', 404);
  if (node.type !== 'audio') throw new CanvasJobStoreError('An audio job requires an audio node');
  if (typeof (node.params as { importedAssetId?: unknown }).importedAssetId === 'string' && !(node.params as AudioParameters).prompt?.trim()) {
    throw new CanvasJobStoreError('已有音频素材可直接引用，请填写文本后再生成。');
  }
  const upstream = store.upstreamNodes(canvasId, node.id);
  const mentions = snapshot.nodes.filter((candidate) => candidate.id !== node.id && candidate.type !== 'anchor').map((candidate) => ({
    id: candidate.id, label: candidate.title, assets: candidate.output?.assets ?? [],
    text: candidate.type === 'note' ? (candidate.params as { content?: string }).content : candidate.type === 'agent' ? candidate.output?.text : undefined,
  }));
  const params = node.params as AudioParameters;
  let prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
  if (!prompt) {
    for (const candidate of upstream) {
      const text = candidate.type === 'note' ? (candidate.params as { content?: string }).content : candidate.type === 'agent' ? candidate.output?.text : undefined;
      if (text?.trim()) { prompt = text.trim(); break; }
    }
  }
  if (prompt.includes('@')) prompt = resolveMentions(prompt, mentions).resolvedPrompt;
  if (!prompt) prompt = '欢迎使用 Reizo 智能多模态创作平台';
  const input: AudioJobInput = structuredClone({ request: { providerId }, node, upstream, mentions, prompt });
  return nodeJobsFor(store).start({
    canvasId, nodeId: node.id, nodeType: 'audio', input: { ...input }, inputHash: inputHash(input.node, input.upstream),
    operationId, signal: options.signal,
    execute: (job) => executeAudioNode({ ...options, node: input.node }, input, job),
    onFailure: (error, job) => failAudioJob(options, job, failureMessage(error)),
    onCancelled: (reason) => {
      const current = store.getNode(canvasId, node.id);
      if (!current) return;
      const output = { ...(current.output ?? {}) };
      delete output.error; delete output.progress;
      if (reason === 'interrupted') output.error = '任务因应用退出而中断，请重试。';
      const cancelled = store.updateNode(canvasId, node.id, { runState: reason === 'interrupted' ? 'error' : 'idle', output });
      if (!cancelled) throw new Error('Audio cancellation could not project its node');
      return () => { getCanvasChannel(canvasId).broadcast(cancelled.rev, { type: 'node_updated', node: cancelled.node }); };
    },
  });
}

export async function runAudioNode(options: AudioRunOptions): Promise<void> {
  // Legacy call sites may finish after host shutdown; admission must not touch their closed database.
  if (canvasWorkStopped(options.canvasStore) || options.signal?.aborted) return;
  await startAudioNode(options).completion;
}

function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

async function executeAudioNode(options: AudioRunOptions, input: AudioJobInput, job: NodeJobContext): Promise<void> {
  const { canvasStore: store, providerStore, dataRoot, canvasId, node } = options;
  let staged: StagedCanvasAssets | undefined;
  try {
    if (!canCommit(options, job)) return;
    const previousOutput = { ...(store.getNode(canvasId, node.id)?.output ?? {}) };
    delete previousOutput.error; delete previousOutput.progress;
    const running = store.updateNode(canvasId, node.id, { runState: 'running', output: previousOutput });
    if (!running) throw new AudioPreparationError('音频节点已不存在。');
    getCanvasChannel(canvasId).broadcast(running.rev, { type: 'node_updated', node: running.node });
    const params = input.node.params as AudioParameters;
    const requestedProvider = input.request.providerId !== undefined ? input.request.providerId : params.providerId;
    let provider;
    if (requestedProvider !== undefined) {
      if (!requestedProvider.trim()) throw new AudioPreparationError('指定的音频 Provider 不存在。');
      provider = await providerStore.getByIdWithSecret(requestedProvider);
      if (!canCommit(options, job)) return;
      if (!provider) throw new AudioPreparationError('指定的音频 Provider 不存在。');
    } else {
      const catalog = await providerStore.getPublicCatalog('audio');
      if (!canCommit(options, job)) return;
      const defaultId = catalog.defaultProviderByCategory.audio || catalog.providers.find((candidate) => candidate.category === 'audio' && candidate.enabled)?.id;
      if (!defaultId) throw new AudioPreparationError('未配置可用的音频 Provider。');
      provider = await providerStore.getByIdWithSecret(defaultId);
      if (!canCommit(options, job)) return;
      if (!provider) throw new AudioPreparationError('默认音频 Provider 不存在。');
    }
    if (provider.category !== 'audio' || !provider.enabled || !provider.id) throw new AudioPreparationError('所选 Provider 未启用或不支持音频生成。');
    const prepared = structuredClone(provider);
    let driver: ReturnType<typeof getAudioDriver>;
    try { driver = getAudioDriver(prepared.driverType); }
    catch { throw new AudioPreparationError('音频 Provider 使用了不支持的驱动。'); }
    if (driver.id !== 'mock' && !prepared.credentials?.apiKey?.trim()) throw new AudioPreparationError('音频 Provider 未配置 API Key。');
    const sample = prepared.sampleParams ?? {};
    const format = params.format ?? sample.format ?? 'mp3';
    if (format !== 'mp3' && format !== 'wav') throw new AudioPreparationError('不支持的音频输出格式。');
    const generateParams: AudioGenerateParams = {
      prompt: input.prompt, model: stringValue(params.model) ?? stringValue(sample.model),
      voiceId: stringValue(params.voiceId) ?? stringValue(sample.voice_id) ?? stringValue(sample.voice),
      speed: numberValue(params.speed) ?? numberValue(sample.speed), pitch: numberValue(params.pitch) ?? numberValue(sample.pitch),
      vol: numberValue(params.vol) ?? numberValue(sample.vol), emotion: stringValue(params.emotion) ?? stringValue(sample.emotion),
      format,
    };
    const model = driver.modelForRequest?.(generateParams, prepared.credentials) ?? generateParams.model ?? driver.defaultModel ?? (driver.id === 'mock' ? 'mock-synth-1' : undefined);
    if (!stringValue(model)) throw new AudioPreparationError('音频服务未配置生成模型。');
    generateParams.model = model;
    const signal = AbortSignal.any([job.signal, canvasWorkSignal(store)]);
    const result = await generationSchedulerFor(store).run(prepared.id, async (submittedSignal) => {
      if (!canCommit(options, job) || !job.markSubmitted({ providerId: prepared.id, model })) throw new Error('Audio job lost submission ownership');
      return driver.synthesize(generateParams, prepared.credentials ?? {}, { signal: submittedSignal });
    }, signal);
    if (!canCommit(options, job)) return;
    if (!result || !Buffer.isBuffer(result.audioBuffer) || result.audioBuffer.byteLength === 0) throw new AudioPreparationError('音频服务未返回有效音频数据。');
    if (result.format !== 'mp3' && result.format !== 'wav') throw new AudioPreparationError('音频服务返回了不支持的格式。');
    staged = await stageCanvasAssets(dataRoot, canvasId, [{ name: `${node.id}-${job.id}.${result.format}`, bytes: result.audioBuffer,
      mimeType: result.format === 'wav' ? 'audio/wav' : 'audio/mpeg', kind: 'audio' }], signal);
    if (!canCommit(options, job)) return;
    const details: CanvasJobFinish = {};
    const done = job.finish('succeeded', () => {
      const asset = store.assets.register({ ...staged.files[0], canvasId, nodeId: node.id, jobId: job.id, source: 'generated' });
      const previous = store.getNode(canvasId, node.id)?.output ?? {};
      const output = { ...previous, assets: [asset.path, ...(previous.assets ?? []).filter((path) => path !== asset.path)].slice(0, 10),
        resultSet: [{ asset: asset.path, assetId: asset.id, jobId: asset.jobId, generation: asset.generation,
          providerId: asset.providerId, inputHash: asset.inputHash, createdAt: new Date().toISOString(), prompt: generateParams.prompt, model: asset.model ?? model },
        ...(previous.resultSet ?? []).filter((item) => item.asset !== asset.path)].slice(0, 10), activeAssetIndex: 0 };
      delete output.error; delete output.progress;
      details.result = output;
      return store.updateNode(canvasId, node.id, { runState: 'done', output, paramsHash: inputHash(input.node, input.upstream) });
    }, details);
    if (done) {
      staged.keep();
      getCanvasChannel(canvasId).broadcast(done.rev, { type: 'node_updated', node: done.node });
      broadcastDownstreamDirty(store, canvasId, node.id, done.rev, false);
    }
  } catch (error) {
    if (canCommit(options, job)) failAudioJob(options, job, failureMessage(error));
  } finally {
    await staged?.discard();
  }
}
