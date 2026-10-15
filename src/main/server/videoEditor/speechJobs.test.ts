import { expect, it, vi } from 'vitest';
import { ReizoSpeechJobs, type SpeechJob, type SpeechWord } from '../../../../integrations/openchatcut/reizoSpeechJobs';

const job: SpeechJob = { id: 'job', projectId: 'p', assetId: 'a', revision: 'v1', language: 'zh', model: 'base', status: 'running' };
const words: SpeechWord[] = [{ text: '真实语音', start: 10, end: 900 }];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const disk = new Map<string, SpeechJob>();
  const storage = { get: vi.fn(async (key: string) => structuredClone(disk.get(key))), set: vi.fn(async (key: string, value: SpeechJob) => { disk.set(key, structuredClone(value)); }) };
  const stop = vi.fn(() => Promise.resolve());
  return { storage, disk, stop, jobs: new ReizoSpeechJobs(storage, stop) };
}
it('deduplicates concurrent starts and excludes a second inference', async () => {
  const { jobs } = fixture(), pending = deferred<SpeechWord[]>(), runner = vi.fn(() => pending.promise);
  await Promise.all([jobs.start(job, runner), jobs.start(job, runner)]);
  expect(runner).toHaveBeenCalledTimes(1);
  await expect(jobs.start({ ...job, id: 'other' }, runner)).rejects.toThrow('另一项');
  pending.resolve(words);
  await vi.waitFor(async () => expect((await jobs.read('p', 'job'))?.status).toBe('done'));
  expect((await jobs.start(job, runner)).words).toEqual(words);
  expect(runner).toHaveBeenCalledTimes(1);
});
it('publishes completion only after durable persistence', async () => {
  const { jobs, storage } = fixture(), saved = deferred<void>(), runner = deferred<SpeechWord[]>();
  await jobs.start(job, () => runner.promise);
  storage.set.mockImplementationOnce(async () => saved.promise);
  runner.resolve(words);
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(2));
  expect((await jobs.read('p', 'job'))?.status).toBe('running');
  saved.resolve();
});
it('cancels before retry and ignores late completion from the cancelled run', async () => {
  const { jobs, stop } = fixture(), first = deferred<SpeechWord[]>(), second = deferred<SpeechWord[]>();
  await jobs.start(job, () => first.promise);
  expect((await jobs.cancel('p', 'job'))?.status).toBe('cancelled'); expect(stop).toHaveBeenCalledOnce();
  await jobs.start(job, () => second.promise, true);
  first.resolve([{ text: 'old', start: 0, end: 50 }]);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect((await jobs.read('p', 'job'))?.status).toBe('running');
  second.resolve(words);
  await vi.waitFor(async () => expect((await jobs.read('p', 'job'))?.words).toEqual(words));
});
it('reports interrupted jobs after reload and requires explicit retry', async () => {
  const { jobs, storage } = fixture(); await storage.set('reizo-speech:p:job', job);
  const run = vi.fn(async () => words);
  expect((await jobs.start(job, run)).status).toBe('interrupted'); expect(run).not.toHaveBeenCalled();
  await jobs.start(job, run, true); expect(run).toHaveBeenCalledOnce();
});
it('does not expose successful results after storage failure or invalid timestamps', async () => {
  const { jobs, storage } = fixture(), runner = deferred<SpeechWord[]>();
  await jobs.start(job, () => runner.promise); storage.set.mockRejectedValueOnce(new Error('disk full')); runner.resolve(words);
  await vi.waitFor(async () => expect((await jobs.read('p', 'job'))?.status).toBe('failed'));
  await jobs.start(job, async () => [{ text: 'bad', start: 100, end: 10 }], true);
  await vi.waitFor(async () => expect((await jobs.read('p', 'job'))?.error).toContain('时间戳'));
});
it('keeps silence empty and rejects a cross-project stored result', async () => {
  const { jobs, storage } = fixture(); await jobs.start(job, async () => []);
  await vi.waitFor(async () => expect((await jobs.read('p', 'job'))?.words).toEqual([]));
  await storage.set('reizo-speech:other:job', { ...job, status: 'done', words });
  await expect(jobs.read('other', 'job')).rejects.toThrow('不属于');
});
