import type { CanvasNode, CanvasNodeOutput } from '../../../shared/canvas';
import type { CanvasJob, CanvasJobFinish, CanvasJobTerminalStatus } from '../../../shared/canvasJobs';
import type { CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { getCanvasChannel } from './channel';
import { broadcastDownstreamDirty } from './imageExecutor';
import { stageCanvasAssets, type StagedCanvasAssets } from './assets';
import { getVideoDriver, type VideoGenerateParams, VideoPollError } from './videoDrivers';
import { canvasWorkSignal, canvasWorkStopped } from './workLifecycle';
import { generationSchedulerFor } from './generationScheduler';
import type { NodeJobSubmission } from './nodeJobs';
import { NodeJobsClosedError } from './nodeJobs';
import { inputHash } from './graph';

interface ActiveJob {
  store: CanvasStore; job: CanvasJob; canvasId: string; nodeId: string; taskId: string; driverId: string; operationId?: string;
  controller: AbortController; signal: AbortSignal; detached: boolean; polling: boolean; timer?: ReturnType<typeof setInterval>;
  releasePermit?: () => void; unlisten: () => void; completion: Promise<void>; submitted: Promise<void>;
  resolveCompletion: () => void; resolveSubmitted: () => void;
}
export interface VideoJobSubmission extends NodeJobSubmission { submitted: Promise<void> }
export interface VideoRuntimeOptions { canvasStore: CanvasStore; settingsStore: SettingsStore; dataRoot: string }
const activeJobs = new Map<string, ActiveJob>();
const byId = new Map<string, ActiveJob>();
const storeIds = new WeakMap<CanvasStore, number>();
let nextStoreId = 0;
function scope(store: CanvasStore): number {
  let id = storeIds.get(store);
  if (id === undefined) { id = ++nextStoreId; storeIds.set(store, id); }
  return id;
}
const keyFor = (canvasId: string, nodeId: string, store: CanvasStore) => JSON.stringify([scope(store), canvasId, nodeId]);
const jobKey = (store: CanvasStore, id: string) => JSON.stringify([scope(store), id]);

export function isRecoverableVideoJob(job: CanvasJob): boolean {
  if (job.nodeType !== 'video' || job.status !== 'running' || !job.remoteTask?.taskId?.trim()) return false;
  const driver = getVideoDriver(job.remoteTask.driverId);
  return driver.id === job.remoteTask.driverId && driver.supportsRecovery === true &&
    Boolean(driver.validateRemoteContext?.(job.remoteTask.taskId, job.remoteTask.context));
}
export function getActiveJob(canvasId: string, nodeId: string, store?: CanvasStore): ActiveJob | undefined {
  return store ? activeJobs.get(keyFor(canvasId, nodeId, store)) : [...activeJobs.values()].reverse().find((entry) => entry.canvasId === canvasId && entry.nodeId === nodeId);
}

function detach(entry: ActiveJob): void {
  if (entry.detached) return;
  entry.detached = true;
  entry.unlisten();
  if (entry.timer) clearInterval(entry.timer);
  if (activeJobs.get(keyFor(entry.canvasId, entry.nodeId, entry.store)) === entry) activeJobs.delete(keyFor(entry.canvasId, entry.nodeId, entry.store));
  if (byId.get(jobKey(entry.store, entry.job.id)) === entry) byId.delete(jobKey(entry.store, entry.job.id));
  entry.releasePermit?.();
  entry.controller.abort();
  entry.resolveSubmitted();
  entry.resolveCompletion();
}
function canAccess(entry: ActiveJob): boolean {
  return !entry.detached && !canvasWorkStopped(entry.store) && activeJobs.get(keyFor(entry.canvasId, entry.nodeId, entry.store)) === entry;
}
function isCurrent(entry: ActiveJob): boolean {
  if (canAccess(entry)) {
    if (!entry.signal.aborted && entry.store.jobs.isCurrent(entry.job.id)) return true;
    entry.store.jobs.finish(entry.job.id, 'cancelled', { cancelReason: 'ownership_lost' });
  }
  detach(entry);
  return false;
}

/** Terminal history and node projection either both commit or neither does. */
function finish(entry: ActiveJob, status: CanvasJobTerminalStatus, details: CanvasJobFinish = {}, output?: CanvasNodeOutput | (() => CanvasNodeOutput), afterCommit?: () => void): boolean {
  if (!canAccess(entry)) { detach(entry); return false; }
  const store = entry.store;
  let updated: { rev: number; node: CanvasNode } | null = null;
  let accepted = false;
  let committedOutput: CanvasNodeOutput | undefined;
  store.transaction(() => {
    if (store.jobs.isCurrent(entry.job.id)) {
      const current = store.getNode(entry.canvasId, entry.nodeId);
      committedOutput = typeof output === 'function' ? output() : output;
      const merged = committedOutput ?? { ...(current?.output ?? {}) };
      delete merged.progress;
      if (status === 'cancelled') delete merged.error;
      else if (status !== 'succeeded') merged.error = details.error || 'Video generation interrupted';
      updated = store.updateNode(entry.canvasId, entry.nodeId, {
        runState: status === 'succeeded' ? 'done' : status === 'cancelled' ? 'idle' : 'error', output: merged,
        ...(status === 'succeeded' && entry.job.inputHash ? { paramsHash: entry.job.inputHash } : {}),
      });
      if (!updated) throw new Error('Video job projection did not update its node');
    }
    accepted = store.jobs.finish(entry.job.id, status, { ...details, ...(committedOutput ? { result: committedOutput } : {}) });
    if (!accepted && updated) throw new Error('Video job lost terminal ownership');
  }, { canvasId: entry.canvasId, mutationId: entry.operationId });
  if (accepted) afterCommit?.();
  detach(entry);
  if (updated) {
    const channel = getCanvasChannel(entry.canvasId);
    try {
      channel.broadcast(updated.rev, { type: 'node_updated', node: updated.node, operationId: entry.operationId });
      channel.broadcast(updated.rev, { type: 'node_output', id: entry.nodeId, output: updated.node.output ?? {}, runState: updated.node.runState, operationId: entry.operationId });
      if (!canvasWorkStopped(store)) broadcastDownstreamDirty(store, entry.canvasId, entry.nodeId, updated.rev, status !== 'succeeded');
    } catch (error) { console.error('[canvas] committed video broadcast failed', error); }
  }
  return accepted;
}

export function cancelVideoJob(canvasId: string, nodeId: string, store?: CanvasStore): boolean {
  const entry = getActiveJob(canvasId, nodeId, store);
  if (!entry || (store && entry.store !== store)) return false;
  try { finish(entry, 'cancelled', { cancelReason: 'user_cancelled' }); } finally { detach(entry); }
  return true;
}
export function cancelVideoJobsForCanvas(store: CanvasStore, canvasId: string): boolean {
  const entries = [...activeJobs.values()].filter((entry) => entry.store === store && entry.canvasId === canvasId);
  for (const entry of entries) cancelVideoJob(entry.canvasId, entry.nodeId, store);
  return entries.length > 0;
}
/** Graceful exit retains known query handles. POSTs with uncertain acceptance are never retried. */
export function stopVideoJobsForStore(store: CanvasStore): void {
  for (const entry of [...activeJobs.values()].filter((entry) => entry.store === store)) {
    try {
      if (!canvasWorkStopped(store)) {
        const saved = store.jobs.get(entry.job.id);
        if (!saved || !isRecoverableVideoJob(saved)) finish(entry, 'interrupted', { error: '视频生成因应用退出而中断，未自动重新提交。', cancelReason: 'shutdown' });
      }
    } finally { detach(entry); }
  }
}
export function awaitVideoJob(canvasId: string, nodeId: string, store?: CanvasStore): Promise<void> { return getActiveJob(canvasId, nodeId, store)?.completion ?? Promise.resolve(); }

export function replayVideoJob(store: CanvasStore, canvasId: string, nodeId: string, operationId?: string, providerId?: string): VideoJobSubmission | null {
  if (canvasWorkStopped(store)) throw new NodeJobsClosedError();
  if (!operationId) return null;
  const job = store.jobs.findByOperationId(canvasId, operationId);
  if (!job) return null;
  if (job.nodeId !== nodeId || job.nodeType !== 'video' || (job.input.request as { providerId?: string } | undefined)?.providerId !== providerId) throw new CanvasJobStoreError('operationId was already used for a different video request', 409);
  const active = byId.get(jobKey(store, job.id));
  return { job, completion: active?.completion ?? Promise.resolve(), submitted: active?.submitted ?? Promise.resolve() };
}

function attach(job: CanvasJob, options: VideoRuntimeOptions, signal?: AbortSignal): ActiveJob {
  const controller = new AbortController();
  let resolveCompletion: () => void;
  let resolveSubmitted: () => void;
  const entry: ActiveJob = {
    store: options.canvasStore, job, canvasId: job.canvasId, nodeId: job.nodeId, taskId: job.remoteTask?.taskId ?? '',
    driverId: job.remoteTask?.driverId ?? String(job.input.driverId || 'mock'), operationId: job.operationId,
    controller, signal: AbortSignal.any([controller.signal, canvasWorkSignal(options.canvasStore)]), detached: false, polling: false, unlisten: () => undefined,
    completion: new Promise<void>((resolve) => { resolveCompletion = resolve; }), submitted: new Promise<void>((resolve) => { resolveSubmitted = resolve; }),
    resolveCompletion: () => resolveCompletion(), resolveSubmitted: () => resolveSubmitted(),
  };
  const previous = getActiveJob(job.canvasId, job.nodeId, options.canvasStore);
  activeJobs.set(keyFor(job.canvasId, job.nodeId, options.canvasStore), entry);
  byId.set(jobKey(options.canvasStore, job.id), entry);
  if (previous) detach(previous);
  const cancel = () => cancelVideoJob(job.canvasId, job.nodeId, options.canvasStore);
  signal?.addEventListener('abort', cancel, { once: true });
  entry.unlisten = () => signal?.removeEventListener('abort', cancel);
  if (signal?.aborted) cancel();
  return entry;
}

function launch(entry: ActiveJob, options: VideoRuntimeOptions, loadParams?: (signal?: AbortSignal) => Promise<VideoGenerateParams>): void {
  const { canvasStore: store, settingsStore, dataRoot } = options;
  const fail = (error: unknown, status: CanvasJobTerminalStatus = 'failed') => {
    if (!canAccess(entry)) { detach(entry); return; }
    try { finish(entry, status, { error: error instanceof Error ? error.message : String(error), ...(status === 'interrupted' ? { cancelReason: 'query_uncertain' } : {}) }); }
    catch (failure) { console.error('[canvas] video terminal projection failed', failure); detach(entry); }
  };
  void Promise.resolve().then(async () => {
    let submitting = false;
    try {
      if (!isCurrent(entry)) return;
      const settings = await settingsStore.get();
      if (!isCurrent(entry)) return;
      const driver = getVideoDriver(entry.driverId);
      const requested = (entry.job.input.request as { providerId?: string } | undefined)?.providerId;
      const providerId = entry.job.providerId || (requested && settings.providers?.[requested] ? requested : driver.id);
      const stored = settings.providers?.[providerId];
      if (driver.id !== 'mock' && !stored?.apiKey) throw new Error(`No video API key configured for ${providerId}`);
      entry.releasePermit = await generationSchedulerFor(store).acquire(providerId, entry.signal);
      if (!isCurrent(entry)) return;
      const credentialOptions = { apiKey: stored?.apiKey, baseUrl: stored?.baseUrl, signal: entry.signal };
      if (!entry.job.remoteTask) {
        const params = loadParams ? await loadParams(entry.signal) : entry.job.input.params as unknown as VideoGenerateParams;
        if (!isCurrent(entry)) return;
        const actualModel = driver.modelForRequest?.(params, credentialOptions) || params.model || driver.defaultModel || driver.id;
        if (!store.jobs.markSubmitted(entry.job.id, { providerId, model: actualModel })) {
          if (isCurrent(entry)) fail('视频提交状态不确定，未重新提交。', 'interrupted');
          return;
        }
        submitting = true;
        const submitted = await driver.submit(params, credentialOptions);
        if (!isCurrent(entry)) return;
        if (!submitted.taskId?.trim()) throw new Error('Video provider returned no task identifier');
        if (driver.supportsRecovery && !driver.validateRemoteContext?.(submitted.taskId, submitted.context)) throw new Error('Video provider returned an invalid recovery context');
        if (!store.jobs.recordRemoteTask(entry.job.id, { driverId: driver.id, taskId: submitted.taskId, ...(submitted.context ? { context: submitted.context } : {}) })) return;
        entry.job = store.jobs.get(entry.job.id);
        entry.taskId = submitted.taskId;
      }
      entry.resolveSubmitted();
      const remote = entry.job.remoteTask;
      let queryFailures = 0;
      const poll = async () => {
        if (!isCurrent(entry) || entry.polling) return;
        entry.polling = true;
        let staged: StagedCanvasAssets | undefined;
        try {
          const result = await driver.poll(remote.taskId, { ...credentialOptions, context: remote.context });
          if (!isCurrent(entry)) return;
          if (result.status === 'failed') { fail(result.error || 'Video generation failed'); return; }
          if (result.status !== 'succeed') {
            if (Date.now() - Date.parse(entry.job.submittedAt || entry.job.createdAt) > 10 * 60 * 1_000) { fail('视频查询超过 10 分钟，请检查供应商后手动重试。', 'interrupted'); return; }
            const output = { ...(store.getNode(entry.canvasId, entry.nodeId)?.output ?? {}), progress: Math.max(10, Math.min(98, result.progress ?? 30)) };
            const updated = store.updateNode(entry.canvasId, entry.nodeId, { runState: 'running', output });
            if (updated) getCanvasChannel(entry.canvasId).broadcast(updated.rev, { type: 'node_output', id: entry.nodeId, output, runState: 'running', operationId: entry.operationId });
            queryFailures = 0;
            return;
          }
          let videoBuffer = result.videoBuffer;
          if (!videoBuffer && result.videoUrl) {
            const response = await fetch(result.videoUrl, { signal: entry.signal });
            if (!isCurrent(entry)) return;
            if (!response.ok) throw new Error(`Video download failed (${response.status})`);
            const bytes = await response.arrayBuffer();
            if (!isCurrent(entry)) return;
            videoBuffer = Buffer.from(bytes);
          }
          if (!videoBuffer?.byteLength) throw new Error('Video provider returned no video data');
          staged = await stageCanvasAssets(dataRoot, entry.canvasId, [{ name: `${entry.nodeId}-${entry.job.id}.mp4`,
            bytes: videoBuffer, mimeType: 'video/mp4', kind: 'video' }], entry.signal);
          if (!isCurrent(entry)) return;
          const params = entry.job.input.params as unknown as VideoGenerateParams;
          finish(entry, 'succeeded', {}, () => {
            const asset = store.assets.register({ ...staged.files[0], canvasId: entry.canvasId, nodeId: entry.nodeId, jobId: entry.job.id, source: 'generated' });
            const previous = store.getNode(entry.canvasId, entry.nodeId)?.output ?? {};
            const output: CanvasNodeOutput = { ...previous, assets: [asset.path, ...(previous.assets ?? []).filter((value) => value !== asset.path)].slice(0, 10),
              resultSet: [{ asset: asset.path, assetId: asset.id, jobId: asset.jobId, generation: asset.generation,
                providerId: asset.providerId, inputHash: asset.inputHash, createdAt: new Date().toISOString(), prompt: params?.prompt, model: asset.model },
              ...(previous.resultSet ?? []).filter((item) => item.asset !== asset.path)].slice(0, 10), activeAssetIndex: 0 };
            delete output.error;
            return output;
          }, () => staged.keep());
        } catch (error) {
          if (!isCurrent(entry)) return;
          queryFailures += 1;
          const retryable = error instanceof VideoPollError ? error.retryable : error instanceof TypeError;
          if (!retryable || queryFailures >= 5 || Date.now() - Date.parse(entry.job.submittedAt || entry.job.createdAt) > 10 * 60 * 1_000) fail(error, 'interrupted');
        } finally {
          await staged?.discard();
          entry.polling = false;
        }
      };
      entry.timer = setInterval(() => { void poll(); }, 2_500);
      if (loadParams === undefined) void poll();
    } catch (error) { fail(error, submitting || entry.job.remoteTask ? 'interrupted' : 'failed'); }
    finally { if (!isCurrent(entry)) detach(entry); }
  });
}

export function startVideoJob(options: VideoRuntimeOptions & {
  canvasId: string; nodeId: string; driverId: string; input: Record<string, unknown>; inputHash?: string;
  operationId?: string; providerId?: string; signal?: AbortSignal; loadParams: (signal?: AbortSignal) => Promise<VideoGenerateParams>;
}): VideoJobSubmission {
  const store = options.canvasStore;
  const receipt = replayVideoJob(store, options.canvasId, options.nodeId, options.operationId, options.providerId);
  if (receipt) return receipt;
  const job = store.transaction(() => {
    const saved = store.jobs.enqueue({ canvasId: options.canvasId, nodeId: options.nodeId, nodeType: 'video', operationId: options.operationId, input: options.input, inputHash: options.inputHash });
    const output = { ...(store.getNode(options.canvasId, options.nodeId)?.output ?? {}), progress: 5 };
    delete output.error;
    if (!store.updateNode(options.canvasId, options.nodeId, { runState: 'running', output })) throw new Error('Video node disappeared during admission');
    return saved;
  }, { canvasId: options.canvasId, mutationId: options.operationId });
  const entry = attach(job, options, options.signal);
  launch(entry, options, options.loadParams);
  return { job, completion: entry.completion, submitted: entry.submitted };
}

/** Compatibility for callers that already prepared an in-memory driver request. */
export async function submitVideoJob(options: VideoRuntimeOptions & {
  canvasId: string; nodeId: string; driverId?: string; params: VideoGenerateParams; providerId?: string; operationId?: string;
}): Promise<void> {
  if (canvasWorkStopped(options.canvasStore)) return;
  const receipt = replayVideoJob(options.canvasStore, options.canvasId, options.nodeId, options.operationId, options.providerId);
  if (receipt) { await receipt.submitted; return; }
  const node = options.canvasStore.getNode(options.canvasId, options.nodeId);
  if (!node) return;
  const params = { prompt: options.params.prompt, duration: options.params.duration, ratio: options.params.ratio, model: options.params.model, cameraMotion: options.params.cameraMotion, camera: options.params.camera };
  const admission = startVideoJob({ ...options, driverId: options.driverId || 'mock',
    input: { request: { providerId: options.providerId }, driverId: options.driverId || 'mock', node, params },
    inputHash: inputHash(node, options.canvasStore.upstreamNodes(options.canvasId, options.nodeId)), loadParams: async () => options.params });
  await admission.submitted;
}

export function resumeVideoJobs(options: VideoRuntimeOptions): VideoJobSubmission[] {
  if (canvasWorkStopped(options.canvasStore)) return [];
  return options.canvasStore.jobs.unfinished().filter((job) => isRecoverableVideoJob(job) && options.canvasStore.jobs.isCurrent(job.id)).map((job) => {
    const existing = byId.get(jobKey(options.canvasStore, job.id));
    if (existing) return { job, completion: existing.completion, submitted: existing.submitted };
    const entry = attach(job, options);
    launch(entry, options);
    return { job, completion: entry.completion, submitted: entry.submitted };
  });
}
