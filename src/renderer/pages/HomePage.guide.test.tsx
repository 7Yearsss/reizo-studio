// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomePage from './HomePage';

const mocks = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), setSkill: vi.fn(), openTab: vi.fn(), importImage: vi.fn() }));
vi.mock('../components/layout/titleBarSlots', () => ({ useTitleBarSlot: (): null => null }));
vi.mock('../components/home/HomeWelcome', () => ({ default: () => <h1>欢迎创作</h1> }));
vi.mock('../components/chat/ModelPicker', () => ({ default: (): null => null }));
vi.mock('../components/chat/TopRightToolbar', () => ({ default: (): null => null }));
vi.mock('../components/chat/MentionMenu', () => ({ default: (): null => null, extractMentionQuery: (): null => null }));
vi.mock('../components/canvas/canvasThumbnail', () => ({ getCanvasNodeThumbnail: vi.fn() }));
vi.mock('../state/canvasStore', () => ({ importImage: mocks.importImage, getSnapshot: () => ({ nodesBySession: {} }) }));
vi.mock('../state/chatStore', () => ({ createSession: mocks.create, sendMessage: mocks.send, setSessionSkill: mocks.setSkill }));
vi.mock('../state/tabStore', () => ({ openChatTab: mocks.openTab }));
vi.mock('../state/uiStore', () => ({ setMode: vi.fn() }));
vi.mock('../state/settingsStore', () => ({}));
vi.mock('../api', () => ({}));
vi.mock('../state/useSettingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: { workspacePath: null, providers: [{ hasKey: true }] } }) }));
vi.mock('../state/useSkillStore', () => ({ useSkillStore: () => ({ skills: [{ id: 'video-travel', name: '旅行视频', category: 'video', description: '旅行素材', prompt: '请做一段旅行视频', source: 'bundled' }] }) }));

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  vi.clearAllMocks(); mocks.create.mockResolvedValue({ id: 'session-1', title: '旅行视频' });
  mocks.importImage.mockResolvedValue({ id: 'uploaded', title: 'screenshot.png', params: {} });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<HomePage />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const target = [...host.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label || el.textContent?.startsWith(label));
  if (!target) throw new Error(`Missing button: ${label}`);
  await act(async () => target.click());
}

it('selects a tool in place and uses its installed skill only when sending', async () => {
  await click('视频'); await click('旅行视频');
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')?.value).toBe('请做一段旅行视频');
  expect(host.querySelector('[aria-label="移除已选工具"]')).not.toBeNull();
  await click('发送');
  expect(mocks.setSkill).toHaveBeenCalledWith('session-1', 'video-travel');
  expect(mocks.send).toHaveBeenCalledWith('session-1', '请做一段旅行视频', [], expect.objectContaining({ skillId: 'video-travel' }));
});

it('removes a selected skill without deleting the draft or using it on send', async () => {
  await click('视频'); await click('旅行视频'); await click('移除已选工具');
  expect(host.querySelector('textarea')?.value).toBe('请做一段旅行视频');
  await click('发送');
  expect(mocks.setSkill).not.toHaveBeenCalled();
  expect(mocks.send.mock.calls[0][3]).not.toHaveProperty('skillId');
});

it.each(['paste', 'drop'])('accepts a clipboard screenshot via %s and sends its actual image reference', async (kind) => {
  const file = new File(['image bytes'], 'screenshot.png', { type: 'image/png' });
  const event = new Event(kind, { bubbles: true, cancelable: true });
  const transfer = { types: ['Files'], files: kind === 'drop' ? [file] : [], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] };
  Object.defineProperty(event, kind === 'drop' ? 'dataTransfer' : 'clipboardData', { value: transfer });
  await act(async () => { host.querySelector('textarea')!.dispatchEvent(event); });
  expect(host.querySelector('img[src="blob:preview"]')).not.toBeNull();
  await click('发送');
  expect(mocks.importImage).toHaveBeenCalledWith('session-1', file, expect.anything());
  expect(mocks.send.mock.calls[0][2]).toContain('canvas:uploaded');
});

it('retains the homepage attachment and shows the error when image import fails', async () => {
  mocks.importImage.mockRejectedValue(new Error('图片上传失败'));
  const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [file] } });
  await act(async () => { host.querySelector('textarea')!.dispatchEvent(event); });
  await click('发送');
  expect(host.textContent).toContain('图片上传失败');
  expect(host.querySelector('img[src="blob:preview"]')).not.toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.openTab).not.toHaveBeenCalled();
});
