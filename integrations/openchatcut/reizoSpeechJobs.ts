export interface SpeechWord { text: string; start: number; end: number }
export interface SpeechJob {
  id: string; projectId: string; assetId: string; revision: string; language: string; model: string;
  status: 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled';
  note?: string; error?: string; words?: SpeechWord[];
}
type Storage = { get: (key: string) => Promise<SpeechJob | undefined>; set: (key: string, value: SpeechJob) => Promise<void> };
type Runner = (progress: (note: string) => void) => Promise<SpeechWord[]>;

/** Recognition only produces data. Completing a job never writes into a draft. */
export class ReizoSpeechJobs {
  private running = new Map<string, SpeechJob>();
  private queue: Promise<unknown> = Promise.resolve();
  private storage: Storage;
  private stop: () => Promise<void>;
  constructor(storage: Storage, stop: () => Promise<void>) { this.storage = storage; this.stop = stop; }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private key(projectId: string, id: string) { return `reizo-speech:${projectId}:${id}`; }
  async read(projectId: string, id: string): Promise<SpeechJob | undefined> {
    const key = this.key(projectId, id);
    const job = this.running.get(key) ?? await this.storage.get(key);
    if (job && (job.projectId !== projectId || job.id !== id)) throw new Error('语音任务不属于当前工程');
    return job?.status === 'running' && !this.running.has(key)
      ? { ...job, status: 'interrupted', note: '识别进程已中断，可显式重试；尚未写入字幕' }
      : job && { ...job };
  }
  start(input: SpeechJob, run: Runner, retry = false) {
    return this.exclusive(async () => {
      const key = this.key(input.projectId, input.id), old = await this.read(input.projectId, input.id);
      if (old && (old.status === 'running' || old.status === 'done' || !retry)) return old;
      if ([...this.running.values()].some(j => j.status === 'running')) throw new Error('另一项本地语音识别正在执行，请完成或取消后再启动');
      const job = { ...input, status: 'running' as const } as SpeechJob;
      await this.storage.set(key, { ...job });
      this.running.set(key, job);
      void (async () => {
        let result: SpeechJob;
        try {
          const words = await run(note => { if (this.running.get(key) === job) job.note = note; });
          if (words.some((w, i) => typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end < w.start || i > 0 && w.start < words[i - 1].start)) throw new Error('识别返回了无效时间戳');
          result = { ...job, words, status: 'done', note: words.length ? '本地识别完成，尚未写入草稿' : '未识别出可用语音，不生成虚构字幕' };
        } catch (error) { result = { ...job, status: 'failed', error: error instanceof Error ? error.message : String(error) }; }
        await this.exclusive(async () => {
          if (this.running.get(key) !== job) return;
          try { await this.storage.set(key, result); this.running.delete(key); }
          catch { this.running.set(key, { ...job, status: 'failed', error: '识别结果保存失败，请显式重试' }); }
        });
      })();
      return { ...job };
    });
  }
  cancel(projectId: string, id: string) {
    return this.exclusive(async () => {
      const key = this.key(projectId, id), job = await this.read(projectId, id);
      if (!job || job.status !== 'running') return job;
      // Finish worker teardown before another job may acquire the single local worker.
      await this.stop();
      const cancelled: SpeechJob = { ...job, status: 'cancelled', note: '已取消，识别结果不会写入草稿' };
      this.running.set(key, cancelled);
      await this.storage.set(key, cancelled);
      this.running.delete(key);
      return cancelled;
    });
  }
}
