import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VideoExportTask } from '../../../shared/videoExportTask';

const uuid = z.string().uuid();
const terminal = new Set(['saved', 'cancelled', 'failed', 'interrupted']);
const recordSchema = z.object({
  version: z.literal(1), id: uuid, sessionId: z.string().min(1), projectId: z.string().min(1),
  name: z.string(), phase: z.enum(['queued', 'submitting', 'rendering', 'saving', 'saved', 'cancelling', 'cancelled', 'failed', 'interrupted']),
  progress: z.number(), createdAt: z.number(), updatedAt: z.number(),
  recipe: z.record(z.string(), z.unknown()), digest: z.string(),
  cancelRequested: z.boolean(), submissionConfirmed: z.boolean().optional(), result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(), assetId: z.string().optional(), retryId: uuid.optional(),
});
type RecordData = z.infer<typeof recordSchema>;
export interface ExportTaskTransport {
  request(method: 'POST' | 'GET' | 'DELETE', id?: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<Response>;
  output(file: string, signal: AbortSignal): Promise<Buffer>;
  save(sessionId: string, projectId: string, name: string, bytes: Buffer): Promise<{ id: string }>;
}
function publicTask(job: RecordData): VideoExportTask {
  const { id, projectId, name, phase, progress, createdAt, updatedAt, error, assetId, retryId } = job;
  return { id, projectId, name, phase, progress, createdAt, updatedAt, error, assetId, retryId };
}
function message(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 1000); }
function recipeFor(projectId: string, body: Record<string, unknown>, id: string) {
  const format = z.enum(['video', 'audio']).parse(body.format);
  const codec = z.enum(['h264', 'vp8', 'mp3', 'wav']).parse(body.codec ?? (format === 'video' ? 'h264' : 'mp3'));
  if (format === 'video' !== (codec === 'h264' || codec === 'vp8')) throw new Error('导出格式与编码不匹配');
  // Upstream ProjectDoc has no identity field; ownership comes from the authenticated workspace bridge.
  const embeddedId = body.project && (body.project as { id?: unknown }).id;
  if (embeddedId !== undefined && embeddedId !== null && embeddedId !== projectId) throw new Error('导出工程不属于当前对话');
  if (!body.state || typeof body.state !== 'object') throw new Error('缺少剪辑状态');
  const recipe = JSON.parse(JSON.stringify({ ...body, format, codec, operationId: id })) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(recipe)) > 32 * 1024 * 1024) throw new Error('剪辑工程超过 32 MB');
  const ext = codec === 'h264' ? 'mp4' : codec === 'vp8' ? 'webm' : codec;
  const base = typeof body.name === 'string' ? body.name.slice(0, 160).replace(/[\\/]/g, '_') : '剪辑成片';
  return { recipe, name: `${base.replace(/\.(mp4|webm|mp3|wav)$/i, '')}.${ext}` };
}

/** The accepted recipe and delivery receipt belong to the host, never to an iframe lifetime. */
export class VideoExportTasks {
  private jobs = new Map<string, RecordData>();
  private writes = new Map<string, Promise<void>>();
  private workers = new Map<string, Promise<void>>();
  private controller = new AbortController();
  private loaded: Promise<void>;
  private directory: string;
  private creation = Promise.resolve();
  constructor(root: string, private transport: ExportTaskTransport, private pollMs = 1000) {
    this.directory = path.join(root, 'video-editor-export-jobs');
    this.loaded = this.load();
    // A failed load still reaches whoever awaits it (start); marking it handled here only stops an unobserved
    // rejection — e.g. the data folder removed while the app shuts down — from crashing the process.
    this.loaded.catch((): void => undefined);
  }
  private async load() {
    await mkdir(this.directory, { recursive: true });
    for (const file of await readdir(this.directory)) {
      if (!file.endsWith('.json')) continue;
      // A damaged ledger must not silently disappear and lead to duplicate rendering.
      const job = recordSchema.parse(JSON.parse(await readFile(path.join(this.directory, file), 'utf8')));
      if (file !== `${job.id}.json`) throw new Error('导出任务文件身份不匹配');
      this.jobs.set(job.id, job);
    }
  }
  private persist(job: RecordData): Promise<void> {
    job.updatedAt = Date.now();
    const bytes = JSON.stringify(job);
    const file = path.join(this.directory, `${job.id}.json`);
    const write = (this.writes.get(job.id) ?? Promise.resolve()).catch((): void => undefined).then(async () => {
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, file);
    });
    this.writes.set(job.id, write);
    return write;
  }
  private own(sessionId: string, id: string) {
    const job = this.jobs.get(uuid.parse(id));
    if (!job || job.sessionId !== sessionId) throw new Error('导出任务不属于当前对话');
    return job;
  }
  async start() {
    await this.loaded;
    for (const job of this.jobs.values()) if (!terminal.has(job.phase)) this.run(job);
  }
  stop() { this.controller.abort(); }
  /** True while any accepted export has not reached a terminal phase. */
  hasActive(): boolean { return [...this.jobs.values()].some((job) => !terminal.has(job.phase)); }
  async settled() { await Promise.allSettled([...this.workers.values(), ...this.writes.values()]); }
  async list(sessionId: string) {
    await this.loaded;
    return [...this.jobs.values()].filter((job) => job.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map(publicTask);
  }
  async create(sessionId: string, projectId: string, body: Record<string, unknown>): Promise<VideoExportTask> {
    // Serialize acceptance, including the durable write, so repeated requests cannot acknowledge an uncommitted job.
    const pending = this.creation.then(() => this.accept(sessionId, projectId, body));
    this.creation = pending.then((): void => undefined, (): void => undefined);
    return pending;
  }
  private async accept(sessionId: string, projectId: string, body: Record<string, unknown>) {
    await this.loaded;
    this.controller.signal.throwIfAborted();
    const id = body.operationId === undefined ? randomUUID() : uuid.parse(body.operationId);
    const { recipe, name } = recipeFor(projectId, body, id);
    const digest = createHash('sha256').update(JSON.stringify(recipe)).digest('hex');
    const previous = this.jobs.get(id);
    if (previous) {
      if (previous.sessionId !== sessionId || previous.projectId !== projectId || previous.digest !== digest) throw new Error('导出任务编号已被其他请求使用');
      await this.writes.get(id);
      return publicTask(previous);
    }
    const now = Date.now();
    const job: RecordData = { version: 1, id, sessionId, projectId, name, recipe, digest, phase: 'queued', progress: 0, createdAt: now, updatedAt: now, cancelRequested: false };
    this.jobs.set(id, job);
    try { await this.persist(job); } catch (error) { this.jobs.delete(id); throw error; }
    this.run(job);
    return publicTask(job);
  }
  async snapshot(sessionId: string, id: string) {
    await this.loaded;
    const job = this.own(sessionId, id);
    return { id, phase: job.phase === 'saving' ? 'finalizing' : job.phase === 'queued' ? 'queued' : 'rendering', status: job.phase === 'saved' ? 'succeeded' : terminal.has(job.phase) ? 'failed' : job.phase === 'queued' ? 'queued' : 'running',
      progress: job.progress, ...(job.phase === 'saved' ? { result: job.result } : {}), error: job.error, task: publicTask(job) };
  }
  async cancel(sessionId: string, id: string) {
    await this.loaded;
    const job = this.own(sessionId, id);
    if (terminal.has(job.phase) || job.phase === 'saving') return publicTask(job);
    job.cancelRequested = true;
    // Keep queued distinct: it proves no engine submission was ever attempted.
    if (job.phase !== 'queued') job.phase = 'cancelling';
    await this.persist(job);
    this.run(job);
    return publicTask(job);
  }
  async retry(sessionId: string, id: string) {
    await this.loaded;
    const job = this.own(sessionId, id);
    if (!['failed', 'interrupted', 'cancelled'].includes(job.phase)) throw new Error('此导出任务不能重试');
    await this.workers.get(id);
    if (job.phase === 'interrupted') {
      // A network interruption is not proof that rendering stopped. Reconcile before allowing another attempt.
      const response = job.result ? null : await this.transport.request('GET', id, undefined, this.controller.signal);
      if (response && !response.ok && response.status !== 404) throw new Error('暂时无法确认原任务状态，请稍后重试');
      const snapshot = response?.ok ? await response.json() as { status?: string } : null;
      if (job.result || snapshot && snapshot.status !== 'failed') {
        job.phase = job.result ? 'saving' : 'rendering'; job.error = undefined;
        await this.persist(job); this.run(job); return publicTask(job);
      }
    }
    // Persist the child identity before creating it; a restart/double click reuses this exact attempt.
    job.retryId ??= randomUUID();
    await this.persist(job);
    return this.create(sessionId, job.projectId, { ...job.recipe, operationId: job.retryId });
  }
  private run(job: RecordData) {
    if (this.controller.signal.aborted || this.workers.has(job.id)) return;
    const worker = this.work(job).catch(async (error) => {
      if (this.controller.signal.aborted) return;
      const missing = (error as { code?: string })?.code === 'OUTPUT_MISSING';
      job.phase = missing ? 'failed' : 'interrupted'; job.error = `导出中断，可重试：${message(error)}`;
      if (missing) job.result = undefined;
      await this.persist(job);
    }).finally(() => this.workers.delete(job.id));
    // Surface persistence failures through reads rather than an unhandled rejection.
    this.workers.set(job.id, worker);
    void worker.catch((): void => undefined);
  }
  private async work(job: RecordData) {
    const signal = this.controller.signal;
    if (job.phase === 'queued') {
      if (job.cancelRequested) { job.phase = 'cancelled'; job.error = '导出已取消'; await this.persist(job); return; }
      job.phase = 'submitting'; await this.persist(job);
      signal.throwIfAborted();
      try {
        const response = await this.transport.request('POST', undefined, job.recipe, signal);
        const body = await response.json() as { renderId?: string; error?: string };
        if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 409) {
          job.phase = 'failed'; job.error = body.error ?? `导出请求失败 (${response.status})`; await this.persist(job); return;
        }
        if (response.ok && body.renderId !== job.id) throw new Error('渲染任务回执身份不匹配');
        if (response.ok) { job.submissionConfirmed = true; await this.persist(job); }
      } catch { signal.throwIfAborted(); /* Ambiguous acceptance: reconcile this ID, never POST again. */ }
    }
    let readFailures = 0;
    while (!signal.aborted) {
      if (job.cancelRequested) {
        job.phase = 'cancelling'; await this.persist(job);
        if (!job.submissionConfirmed) {
          const existing = await this.transport.request('GET', job.id, undefined, signal);
          if (!existing.ok) throw new Error('提交结果尚未确认，无法确认取消；请稍后重试');
          job.submissionConfirmed = true; await this.persist(job);
        }
        const response = await this.transport.request('DELETE', job.id, undefined, signal);
        if (!response.ok && response.status !== 404) throw new Error(`取消尚未确认 (${response.status})`);
        job.phase = 'cancelled'; job.error = '导出已取消'; await this.persist(job); return;
      }
      if (job.result) { await this.deliver(job, signal); return; }
      let response: Response;
      try { response = await this.transport.request('GET', job.id, undefined, signal); }
      catch (error) {
        if (++readFailures >= 3) throw error;
        await delay(this.pollMs, undefined, { signal }); continue;
      }
      if (response.status === 404) throw new Error('原渲染任务不存在，未自动重新提交');
      if (!response.ok) {
        if (++readFailures >= 3) throw new Error(`读取导出进度失败 (${response.status})`);
        await delay(this.pollMs, undefined, { signal }); continue;
      }
      readFailures = 0;
      const snapshot = z.object({ id: z.string().optional(), status: z.enum(['queued', 'running', 'succeeded', 'failed']), progress: z.number().finite(), result: z.record(z.string(), z.unknown()).optional(), error: z.string().optional(), code: z.string().optional() }).parse(await response.json());
      if (snapshot.id && snapshot.id !== job.id) throw new Error('导出进度身份不匹配');
      job.submissionConfirmed = true;
      if (snapshot.status === 'failed') {
        const restarted = snapshot.code === 'resumer_unavailable' || snapshot.code === 'submission_unknown';
        job.phase = restarted ? 'interrupted' : 'failed'; job.error = restarted ? '上次导出因应用重启而中断，请重试' : snapshot.error ?? '渲染失败';
        await this.persist(job); return;
      }
      // Cancellation may have arrived while GET was pending. Let the worker acknowledge it first.
      if (job.cancelRequested) continue;
      if (snapshot.status === 'succeeded') {
        if (!snapshot.result || typeof snapshot.result.path !== 'string') throw new Error('渲染完成但缺少文件回执');
        job.result = snapshot.result; job.phase = 'saving'; job.progress = 99; await this.persist(job);
        await this.deliver(job, signal); return;
      }
      job.phase = 'rendering'; job.progress = Math.max(0, Math.min(98, snapshot.progress));
      await this.persist(job);
      await delay(this.pollMs, undefined, { signal });
    }
  }
  private async deliver(job: RecordData, signal: AbortSignal) {
    job.phase = 'saving'; job.progress = 99; await this.persist(job);
    const file = job.result?.path;
    if (typeof file !== 'string' || !/^\/media\/uploads\/[a-zA-Z0-9_.-]+\.(mp4|webm|mp3|wav)$/i.test(file)) throw new Error('成片路径无效');
    const bytes = await this.transport.output(file, signal);
    signal.throwIfAborted();
    // saveExport is content-addressed and transactionally idempotent, including a crash before the ledger write.
    const asset = await this.transport.save(job.sessionId, job.projectId, job.name, bytes);
    job.assetId = asset.id; job.phase = 'saved'; job.progress = 100; job.error = undefined;
    await this.persist(job);
  }
}
