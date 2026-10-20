// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VideoEditorActivity from './VideoEditorActivity';
const mocks = vi.hoisted(() => ({ context: vi.fn(), image: vi.fn(), open: vi.fn(), render: vi.fn(), retry: vi.fn() }));
vi.mock('../../api', () => ({ readEditorContext: mocks.context, readCompositionImage: mocks.image, editorRenderRequest: mocks.render, retryEditorExport: mocks.retry }));
vi.mock('../../state/tabStore', () => ({ activeSessionId: () => 'session' }));
vi.mock('../../state/uiStore', () => ({ setRightPanelTab: mocks.open }));
let root: Root, container: HTMLDivElement;
const createUrl = vi.fn(() => 'blob:test-preview'), revokeUrl = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  mocks.context.mockResolvedValue({ connected: false, context: null, activities: [], composition: { id: 'preview', editSessionId: 'draft', timelineId: 't', createdAt: 1, summary: '30秒竖屏；尚未应用', frames: [30], imageCount: 1, plan: { name: '草稿方案' } } });
  mocks.image.mockResolvedValue(new Blob(['image']));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows a persisted preview after editor disconnect/restart without inventing an applied state', async () => {
  await act(async () => root.render(<VideoEditorActivity sessionId="session" />));
  expect(container.textContent).toContain('草稿方案');
  expect(container.textContent).toContain('当前应用状态以编辑器为准');
  expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-preview');
  expect(mocks.image).toHaveBeenCalledWith('session', 'preview', 0);
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  expect(mocks.open).toHaveBeenCalledWith('video');
  await act(async () => root.unmount()); root = null;
  expect(revokeUrl).toHaveBeenCalledWith('blob:test-preview');
});
it('does not retain image URLs when a pending download finishes after unmount', async () => {
  let finish: (value: Blob) => void;
  mocks.image.mockReturnValue(new Promise<Blob>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<VideoEditorActivity sessionId="session" />));
  await act(async () => root.unmount()); root = null;
  await act(async () => finish(new Blob(['late'])));
  expect(createUrl).not.toHaveBeenCalled();
});
it('keeps background exports visible without a connected panel and offers scoped cancellation and retry', async () => {
  mocks.context.mockResolvedValue({ connected: false, context: null, activities: [], exports: [
    { id: 'running', name: '成片.mp4', phase: 'rendering', progress: 41 },
    { id: 'failed', name: '失败.mp4', phase: 'failed', error: '测试失败' },
    { id: 'saving', name: '保存.mp4', phase: 'saving', progress: 99 },
  ] });
  await act(async () => root.render(<VideoEditorActivity sessionId="session" />));
  expect(container.textContent).toContain('渲染中 41%');
  expect(container.textContent).toContain('正在保存 99%');
  const buttons = Array.from(container.querySelectorAll('button'));
  expect(buttons.filter((button) => button.textContent === '取消')).toHaveLength(1);
  await act(async () => buttons.find((button) => button.textContent === '取消')?.click());
  expect(mocks.render).toHaveBeenCalledWith('session', 'DELETE', 'running');
  await act(async () => buttons.find((button) => button.textContent === '重试')?.click());
  expect(mocks.retry).toHaveBeenCalledWith('session', 'failed');
});
