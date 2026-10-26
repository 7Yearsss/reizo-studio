// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ToolCallPart } from '../../../shared/chat';
import MediaGenerationCard from './MediaGenerationCard';

const mocks = vi.hoisted(() => ({ getJob: vi.fn(), queryJob: vi.fn(), open: vi.fn(), focus: vi.fn(), reuse: vi.fn(), panel: vi.fn(), error: vi.fn(), nodes: [] as unknown[],
  activeSession: 's1', tabListeners: new Set<() => void>(),
}));
vi.mock('../../state/tabStore', () => ({
  subscribe: (listener: () => void) => { mocks.tabListeners.add(listener); return () => mocks.tabListeners.delete(listener); },
  getSnapshot: () => ({ activeTabId: mocks.activeSession, tabs: [{ id: 's1', sessionId: 's1' }, { id: 's2', sessionId: 's2' }] }),
}));
vi.mock('../../api', () => ({ apiOrigin: async () => 'http://localhost:47100', getCanvasJob: mocks.getJob, queryCanvasVideoJob: mocks.queryJob }));
vi.mock('../../state/canvasStore', () => ({ openCanvas: mocks.open, focusNode: mocks.focus, reuseAsset: mocks.reuse,
  getSnapshot: () => ({ nodesBySession: { s1: mocks.nodes } }),
}));
vi.mock('../../state/uiStore', () => ({ setRightPanelTabForSession: mocks.panel }));
vi.mock('../../lib/toast', () => ({ toast: { error: mocks.error } }));
vi.mock('../agents/image-generation', () => ({ ImageGeneration: ({ children, status, statusText }: { children: ReactNode; status: string; statusText: string }) => <div data-state={status} aria-busy={status === 'generating'}>{statusText}{children}</div> }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.nodes = []; mocks.activeSession = 's1';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const videoPart: ToolCallPart = { type: 'tool', id: 'v1', name: 'generate_video', args: { prompt: '雨中的城市', ratio: '16:9' },
  result: JSON.stringify({ ok: true, canvasId: 'c1', nodeId: 'n1', jobId: 'j1', status: 'queued' }) };
async function render(part: ToolCallPart, interrupted = false) {
  await act(async () => root.render(<MediaGenerationCard part={part} sessionId="s1" interrupted={interrupted} />));
}

it.each(['generate_image', 'generate_video'])('shows an inline loading card for %s before a result arrives', async name => {
  await render({ type: 'tool', id: 'pending', name, args: {} });
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.textContent).toContain(name === 'generate_video' ? '正在生成视频' : '正在生成图片');
  expect(mocks.panel).not.toHaveBeenCalled();
});

it('updates a saved video receipt to a playable result after the chat reply has ended, then stops polling', async () => {
  mocks.getJob.mockResolvedValueOnce({ id: 'j1', nodeId: 'n1', status: 'running' })
    .mockResolvedValueOnce({ id: 'j1', nodeId: 'n1', status: 'succeeded', result: { assets: ['c1/video.mp4'] } });
  await render(videoPart);
  expect(host.querySelector('video')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(host.querySelector('video')?.src).toBe('http://localhost:47100/api/canvas/assets/c1/video.mp4');
  expect(host.querySelector('video')?.controls).toBe(true);
  expect(host.textContent).toContain('带到画布');
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.panel).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(9000));
  expect(mocks.getJob).toHaveBeenCalledTimes(2);
});

it('restores a completed job directly from its persisted receipt on remount', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', nodeId: 'n1', status: 'succeeded', result: { assets: ['c1/restored.mp4'] } });
  await render(videoPart);
  expect(host.querySelector('video')?.src).toContain('/c1/restored.mp4');
});

it('shows the actual generation model returned by the job', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', status: 'succeeded', model: 'chosen-video-model', result: { assets: ['c1/result.mp4'] } });
  await render(videoPart);
  expect(host.textContent).toContain('模型：chosen-video-model');
});

it('shows real progress, elapsed waiting time and background guidance for a long-running video', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', status: 'running', submittedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    remoteTask: { taskId: 'upstream-task' }, observation: { status: 'processing', progress: 50 } });
  await render(videoPart);
  expect(host.textContent).toContain('已等待 18 分');
  expect(host.textContent).toContain('仍在跟踪原任务');
  expect(host.textContent).toContain('upstream-task');
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
  expect(host.querySelector('[data-state="generating"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(host.textContent).toContain('18 分 1 秒');
});

it('does not invent a percentage when the provider has not supplied one', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', status: 'running', observation: { status: 'queued' } });
  await render(videoPart);
  expect(host.textContent).toContain('正在排队');
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

it('queries a previously interrupted video and replaces its old error with the recovered result', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', status: 'interrupted', error: '视频查询超过 10 分钟', remoteTask: { taskId: 'old-task' } });
  await render(videoPart);
  mocks.queryJob.mockResolvedValue({ id: 'recovery', status: 'running', remoteTask: { taskId: 'old-task' } });
  mocks.getJob.mockResolvedValue({ id: 'recovery', status: 'succeeded', result: { assets: ['c1/recovered.mp4'] } });
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '继续查询')!.click());
  expect(mocks.queryJob).toHaveBeenCalledWith('c1', 'j1');
  expect(host.textContent).not.toContain('超过 10 分钟');
  expect(host.querySelector('video')?.src).toContain('/c1/recovered.mp4');
});

it('refreshes an old error receipt so a persisted query recovery remains visible after remount', async () => {
  mocks.getJob.mockResolvedValue({ id: 'recovery', status: 'succeeded', result: { assets: ['c1/recovered.mp4'] } });
  await render({ ...videoPart, result: JSON.stringify({ ok: false, canvasId: 'c1', jobId: 'j1', error: '旧查询失败' }) });
  expect(host.querySelector('video')?.src).toContain('/c1/recovered.mp4');
  expect(host.textContent).not.toContain('旧查询失败');
});

it('displays embedded tool errors instead of an empty successful image', async () => {
  await render({ type: 'tool', id: 'bad', name: 'generate_image', args: {}, result: JSON.stringify({ ok: false, error: '余额不足' }) });
  expect(host.querySelector('[data-state="error"]')).not.toBeNull();
  expect(host.textContent).toContain('余额不足');
  expect(host.querySelector('img')).toBeNull();
});

it('shows failed or cancelled jobs and does not keep a loading animation running', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', status: 'cancelled' });
  await render(videoPart);
  expect(host.textContent).toContain('视频生成已停止');
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
});

it('survives a temporary status request failure without submitting a new generation', async () => {
  mocks.getJob.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ id: 'j1', status: 'succeeded', result: { assets: ['c1/reconnected.mp4'] } });
  await render(videoPart);
  expect(host.textContent).toContain('正在重新连接');
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(host.querySelector('video')?.src).toContain('reconnected.mp4');
  expect(host.textContent).not.toContain('正在重新连接');
});

it('opens and focuses the existing result only when the user chooses 带到画布', async () => {
  mocks.nodes = [{ id: 'n1', output: { assets: ['c1/image.png'] } }];
  await render({ type: 'tool', id: 'image', name: 'generate_image', args: {},
    result: JSON.stringify({ ok: true, nodeId: 'n1', imageUrl: '/api/canvas/assets/c1/image.png' }) });
  expect(mocks.open).not.toHaveBeenCalled();
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '带到画布')!;
  await act(async () => button.click());
  expect(mocks.open).toHaveBeenCalledWith('s1');
  expect(mocks.panel).toHaveBeenCalledWith('s1', 'canvas');
  expect(mocks.focus).toHaveBeenCalledWith('s1', 'n1');
  expect(mocks.reuse).not.toHaveBeenCalled();
});

it('reuses the saved immutable asset if its original canvas node now shows another version', async () => {
  mocks.nodes = [{ id: 'n1', output: { assets: ['c1/newer.png'] } }]; mocks.reuse.mockResolvedValue({ id: 'copy' });
  await render({ type: 'tool', id: 'old', name: 'generate_image', args: {},
    result: JSON.stringify({ nodeId: 'n1', assetId: 'old-asset', imageUrl: '/api/canvas/assets/c1/old.png' }) });
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '带到画布')!.click());
  expect(mocks.reuse).toHaveBeenCalledWith('s1', expect.objectContaining({ assetId: 'old-asset' }));
  expect(mocks.focus).toHaveBeenCalledWith('s1', 'copy');
});

it('releases a pending status request when its card unmounts', async () => {
  mocks.getJob.mockImplementation(() => new Promise(() => undefined));
  await render(videoPart);
  const signal = mocks.getJob.mock.calls[0][2] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it('pauses status requests in a background conversation and refreshes when the user returns', async () => {
  mocks.getJob.mockResolvedValue({ id: 'j1', status: 'running' });
  await render(videoPart);
  expect(mocks.getJob).toHaveBeenCalledOnce();
  await act(async () => { mocks.activeSession = 's2'; mocks.tabListeners.forEach(listener => listener()); });
  await act(async () => vi.advanceTimersByTimeAsync(9000));
  expect(mocks.getJob).toHaveBeenCalledOnce();
  await act(async () => { mocks.activeSession = 's1'; mocks.tabListeners.forEach(listener => listener()); });
  expect(mocks.getJob).toHaveBeenCalledTimes(2);
});

it('keeps the download available when media preview cannot be loaded', async () => {
  await render({ type: 'tool', id: 'image', name: 'generate_image', args: {}, result: JSON.stringify({ imageUrl: '/api/canvas/assets/c1/image.png' }) });
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.textContent).toContain('预览加载失败');
  expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '下载')).toBe(true);
});

it('does not show an endless spinner for an interrupted tool without a receipt', async () => {
  await render({ type: 'tool', id: 'stopped', name: 'generate_image', args: {} }, true);
  expect(host.textContent).toContain('图片生成已中断');
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
});
