import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import type { LocalSettings } from '../../../shared/settings';
import { falDriver, getVideoDriver } from '../canvas/videoDrivers';
import { stopVideoJobsForStore } from '../canvas/asyncJobManager';
import { stopCanvasWork } from '../canvas/workLifecycle';
import { createVideoTools } from './videoTools';

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.spyOn(falDriver, 'submit').mockResolvedValue({ taskId: 'test-video', context: {
    baseUrl: 'https://queue.fal.run/fal-ai/test-video',
    statusUrl: 'https://queue.fal.run/fal-ai/test-video/requests/test-video/status',
    responseUrl: 'https://queue.fal.run/fal-ai/test-video/requests/test-video',
  } });
  vi.spyOn(falDriver, 'poll').mockResolvedValue({ status: 'processing', progress: 30 });
});
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });

async function fixture() {
  const db = openDb(':memory:');
  const sessions = createSqliteSessionStore(db);
  const canvasStore = createCanvasStore(db);
  const session = await sessions.create('chat video', null, null);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-chat-video-'));
  const getSettings = vi.fn(async (): Promise<LocalSettings> => ({ activeProviderId: 'openai', providers: { fal: { apiKey: 'test-fal' } }, mediaModels: { video: 'fal-ai/test-video' } }) as unknown as LocalSettings);
  const settingsStore = { get: getSettings } as unknown as SettingsStore;
  const tools = createVideoTools({ canvasStore, settingsStore, dataRoot, sessionId: session.id });
  cleanups.push(async () => {
    stopVideoJobsForStore(canvasStore); stopCanvasWork(canvasStore); db.close();
    if (path.dirname(path.resolve(dataRoot)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temporary directory');
    await rm(dataRoot, { recursive: true, force: true });
  });
  const execute = tools.generate_video.execute as (input: { prompt: string; duration?: '5s' | '10s'; ratio?: '16:9' | '9:16' | '1:1'; model?: string; providerId?: string; referenceNodeIds?: string[] },
    context: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<{ ok: boolean; canvasId?: string; nodeId?: string; jobId?: string; status?: string; error?: string }>;
  return { canvasStore, execute, sessionId: session.id, getSettings };
}

it('returns a durable chat receipt before a slow provider responds and replays without duplicate paid work', async () => {
  const { canvasStore, execute, sessionId } = await fixture();
  vi.mocked(falDriver.submit).mockImplementation(() => new Promise(() => undefined));
  const args = { prompt: 'rainy city', duration: '10s' as const, ratio: '9:16' as const, model: 'fal-ai/test-video' };
  vi.useFakeTimers();
  const pendingReceipt = execute(args, { toolCallId: 'same-call' });
  await vi.advanceTimersByTimeAsync(16_000);
  const first = await pendingReceipt;
  vi.useRealTimers();
  expect(first).toMatchObject({ ok: true, submissionStatus: 'unconfirmed' });
  expect(first.canvasId).toBeTruthy(); expect(first.jobId).toBeTruthy();
  await vi.waitFor(() => expect(falDriver.submit).toHaveBeenCalledOnce());
  const replay = await execute(args, { toolCallId: 'same-call' });
  expect(replay.jobId).toBe(first.jobId);
  expect(canvasStore.getSnapshotBySession(sessionId).nodes).toHaveLength(1);
  expect(canvasStore.getSnapshotBySession(sessionId).nodes[0].params).toMatchObject({ origin: 'chat', duration: '10s', ratio: '9:16' });
  expect(falDriver.submit).toHaveBeenCalledOnce();
  expect(vi.mocked(falDriver.submit).mock.calls[0][0]).toMatchObject({ prompt: 'rainy city', duration: '10s', ratio: '9:16', model: 'fal-ai/test-video' });
});

it('persists the final video on the original receipt so chat can retrieve it after its turn ends', async () => {
  const { canvasStore, execute } = await fixture();
  vi.mocked(falDriver.poll).mockResolvedValue({ status: 'succeed', videoBuffer: Buffer.from('test mp4') });
  const receipt = await execute({ prompt: 'a city' }, { toolCallId: 'complete-call' });
  await vi.waitFor(() => expect(canvasStore.jobs.get(receipt.jobId!)?.status).toBe('succeeded'), { timeout: 5000 });
  const job = canvasStore.jobs.get(receipt.jobId!);
  expect(job?.result).toMatchObject({ assets: [expect.stringContaining('.mp4')] });
  expect(canvasStore.getNode(receipt.canvasId!, receipt.nodeId!)?.runState).toBe('done');
  expect((await execute({ prompt: 'a city' }, { toolCallId: 'complete-call' })).jobId).toBe(receipt.jobId);
  expect(falDriver.submit).toHaveBeenCalledOnce();
});

it('keeps provider failure on the same receipt rather than returning a false success or resubmitting', async () => {
  const { canvasStore, execute } = await fixture();
  vi.mocked(falDriver.submit).mockRejectedValue(new Error('video quota exhausted'));
  const receipt = await execute({ prompt: 'a city' }, { toolCallId: 'failed-call' });
  await vi.waitFor(() => expect(canvasStore.jobs.get(receipt.jobId!)?.status).toBe('interrupted'));
  const replay = await execute({ prompt: 'a city' }, { toolCallId: 'failed-call' });
  expect(replay).toMatchObject({ ok: false, jobId: receipt.jobId, error: 'video quota exhausted' });
  expect(falDriver.submit).toHaveBeenCalledOnce();
});

it('reports a rejected submission before the assistant can describe the video as accepted', async () => {
  const { execute } = await fixture();
  vi.mocked(falDriver.submit).mockRejectedValue(new Error('视频提交失败（HTTP 500）'));
  const receipt = await execute({ prompt: 'a city' }, { toolCallId: 'http-500' });
  expect(receipt).toMatchObject({ ok: false, error: '视频提交失败（HTTP 500）', submissionStatus: 'unconfirmed' });
  expect(receipt).toHaveProperty('summary', expect.stringContaining('不能声称'));
  expect(falDriver.submit).toHaveBeenCalledOnce();
});

it('rolls back missing reference images before admitting a video', async () => {
  const { canvasStore, execute, sessionId } = await fixture();
  const receipt = await execute({ prompt: 'animate this', referenceNodeIds: ['missing'] }, { toolCallId: 'missing-reference' });
  expect(receipt).toMatchObject({ ok: false, error: '参考图片不存在，请重新添加' });
  expect(canvasStore.getSnapshotBySession(sessionId).nodes).toHaveLength(0);
  expect(canvasStore.jobs.list()).toHaveLength(0);
  expect(falDriver.submit).not.toHaveBeenCalled();
});

it('does not create or submit a video after the caller has stopped', async () => {
  const { execute } = await fixture();
  const controller = new AbortController(); controller.abort();
  expect(await execute({ prompt: 'a city' }, { toolCallId: 'stopped', abortSignal: controller.signal })).toMatchObject({ ok: false, error: '视频生成已停止' });
  expect(falDriver.submit).not.toHaveBeenCalled();
});

it('does not fall back to simulated generation when there is no configured video model', async () => {
  const { canvasStore, execute, getSettings } = await fixture();
  getSettings.mockResolvedValue({ activeProviderId: 'openai', providers: {}, mediaModels: {} } as unknown as LocalSettings);
  expect(await execute({ prompt: 'a city' }, { toolCallId: 'unconfigured' })).toMatchObject({ ok: false, error: expect.stringContaining('当前没有可用的视频模型') });
  expect(canvasStore.jobs.list()).toHaveLength(0);
  expect(falDriver.submit).not.toHaveBeenCalled();
});

it('preserves a pending selection on replay even after the default model or credentials change', async () => {
  const { execute, getSettings } = await fixture();
  vi.mocked(falDriver.submit).mockImplementation(() => new Promise(() => undefined));
  vi.useFakeTimers();
  const pendingReceipt = execute({ prompt: 'original video' }, { toolCallId: 'changing-default' });
  await vi.advanceTimersByTimeAsync(16_000);
  const receipt = await pendingReceipt;
  vi.useRealTimers();
  await vi.waitFor(() => expect(falDriver.submit).toHaveBeenCalledOnce());
  getSettings.mockResolvedValue({ activeProviderId: 'openai', providers: {}, mediaModels: { video: 'another-model' } } as unknown as LocalSettings);
  const replay = await execute({ prompt: 'original video' }, { toolCallId: 'changing-default' });
  expect(replay).toMatchObject({ ok: true, jobId: receipt.jobId, model: 'fal-ai/test-video', providerId: 'fal' });
  expect(falDriver.submit).toHaveBeenCalledOnce();
});

const accountSettings = { activeProviderId: 'reizo-account', providers: { 'reizo-account': { apiKey: 'account-fixture', baseUrl: 'https://gateway.example/v1' } }, mediaModels: {},
  accountCatalog: { text: [], image: [], video: [{ id: 'video-a', name: '视频模型 A', protocol: 'openai-video', video: {
    startFrame: false, endFrame: false, camera: false, reference: false, minSeconds: 6, maxSeconds: 10,
    aspectRatios: ['9:16'], fields: ['duration', 'aspect_ratio'],
  } }] } } as unknown as LocalSettings;

it('pins the selected account video model and supported defaults into the actual provider request', async () => {
  const { canvasStore, execute, getSettings } = await fixture();
  getSettings.mockResolvedValue(accountSettings);
  const driver = getVideoDriver('new-api');
  const submit = vi.spyOn(driver, 'submit').mockResolvedValue({ taskId: 'video_account', context: { baseUrl: 'https://gateway.example/v1' } });
  vi.spyOn(driver, 'poll').mockResolvedValue({ status: 'processing' });
  const receipt = await execute({ prompt: 'a city', model: 'video-a', providerId: 'reizo-account' }, { toolCallId: 'account-selection' });
  expect(receipt).toMatchObject({ ok: true, model: 'video-a', modelName: '视频模型 A', providerId: 'reizo-account', duration: '10s', ratio: '9:16' });
  expect(receipt).toMatchObject({ submissionStatus: 'submitted', remoteTaskId: 'video_account' });
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
  expect(submit.mock.calls[0][0]).toMatchObject({ model: 'video-a', duration: '10s', ratio: '9:16' });
  expect(canvasStore.getNode(receipt.canvasId!, receipt.nodeId!)?.params).toMatchObject({ model: 'video-a', provider: 'reizo-account' });
  expect(falDriver.submit).not.toHaveBeenCalled();
});

it('releases the submission wait on host shutdown without reading the stopped store', async () => {
  const { canvasStore, execute } = await fixture();
  vi.mocked(falDriver.submit).mockImplementation(() => new Promise(() => undefined));
  const running = execute({ prompt: 'a city' }, { toolCallId: 'shutdown-during-submit' });
  await vi.waitFor(() => expect(falDriver.submit).toHaveBeenCalledOnce());
  stopCanvasWork(canvasStore);
  const read = vi.spyOn(canvasStore.jobs, 'get');
  expect(await running).toMatchObject({ ok: false, status: 'interrupted', submissionStatus: 'unconfirmed' });
  expect(read).not.toHaveBeenCalled();
});

it.each([
  { model: 'unknown', error: '请选择当前可用的视频模型' },
  { model: 'video-a', duration: '5s' as const, error: '不支持此时长' },
  { model: 'video-a', ratio: '16:9' as const, error: '不支持此画幅' },
])('rejects an unavailable model or unsupported request before paid admission: $error', async ({ error, ...input }) => {
  const { canvasStore, execute, getSettings } = await fixture();
  getSettings.mockResolvedValue(accountSettings);
  expect(await execute({ prompt: 'a city', ...input }, { toolCallId: 'invalid-selection' })).toMatchObject({ ok: false, error: expect.stringContaining(error) });
  expect(canvasStore.jobs.list()).toHaveLength(0);
});
