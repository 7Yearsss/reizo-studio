// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ChatPage from './ChatPage';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), importImage: vi.fn(), error: vi.fn(),
  state: { sessions: [{ id: 's1', title: '附件' }], nodeRefsBySession: {} } as Record<string, any>,
  listeners: new Set<() => void>(),
}));
vi.mock('../state/useChatStore', () => ({ useChatStore: (select: (s: any) => any) => useSyncExternalStore(
  callback => { mocks.listeners.add(callback); return () => mocks.listeners.delete(callback); }, () => select(mocks.state),
) }));
vi.mock('../state/chatStore', () => ({
  sendMessage: mocks.send, ensureSessionMessages: vi.fn(), markSessionRead: vi.fn(),
  addNodeRef: (sessionId: string, ref: unknown) => {
    mocks.state.nodeRefsBySession = { ...mocks.state.nodeRefsBySession, [sessionId]: [ref] };
    mocks.listeners.forEach(callback => callback());
  },
  clearNodeRefs: (sessionId: string) => {
    mocks.state.nodeRefsBySession = { ...mocks.state.nodeRefsBySession, [sessionId]: [] };
    mocks.listeners.forEach(callback => callback());
  },
  clearComposerSeed: vi.fn(), setPickingReference: vi.fn(),
}));
vi.mock('../state/canvasStore', () => ({
  importImage: mocks.importImage, getSnapshot: () => ({ nodesBySession: {} }), EMPTY_SELECTED_IDS: [], EMPTY_NODES: [],
}));
vi.mock('../state/useCanvasStore', () => ({
  useCanvasStore: (select: Function) => select({ selectedNodeIdsBySession: {}, nodesBySession: {} }),
  useCanvasStoreEq: (select: Function) => select({ selectedNodeIdsBySession: {}, nodesBySession: {} }),
  sameNodeIgnoringGeometry: () => true,
  sameNodesIgnoringGeometry: () => true,
}));
vi.mock('../state/useSettingsStore', () => ({ useSettingsStore: (select: Function) => select({ settings: { workspacePath: null, permissionMode: 'ask', busyEnter: 'queue' } }) }));
vi.mock('../state/useSkillStore', () => ({ useSkillStore: () => ({ skills: [] as unknown[] }) }));
vi.mock('../state/useUiStore', () => ({ useUiStore: (select: Function) => select({ mode: 'chat', canvasOpen: false }) }));
vi.mock('../state/documentWorkspace', () => ({ useDocumentWorkspace: (select: Function) => select({ references: {} }), documentReferences: (): unknown[] => [], documentMentions: (): string[] => [], dropDocumentSelection: vi.fn() }));
vi.mock('../state/presentationWorkspace', () => ({ usePresentationWorkspace: (select: Function) => select({ references: {} }), presentationMentions: (): string[] => [], dropPresentationScope: vi.fn() }));
vi.mock('../state/sheetWorkspace', () => ({ useSheetWorkspace: (select: Function) => select({ pinnedBySession: {}, activeBySession: {} }), sheetMentions: (): string[] => [], clearPinnedSheets: vi.fn(), flushSheetEdits: vi.fn() }));
vi.mock('../components/layout/titleBarSlots', () => ({ useTitleBarSlot: (): null => null }));
vi.mock('../components/chat/ModelPicker', () => ({ default: (): null => null }));
vi.mock('../components/chat/MessageList', () => ({ default: (): null => null }));
vi.mock('../components/chat/PendingInteraction', () => ({ default: (): null => null }));
vi.mock('../components/chat/QueuePanel', () => ({ default: (): null => null }));
vi.mock('../components/canvas/canvasThumbnail', () => ({ getCanvasNodeThumbnail: () => 'blob:attached-image' }));
vi.mock('../lib/toast', () => ({ toast: { error: mocks.error } }));

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
  // jsdom omits range geometry; ProseMirror scrolls its caret after text paste.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: (): DOMRect[] => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  mocks.state = { sessions: [{ id: 's1', title: '附件' }], messagesBySession: {}, sendingBySession: {}, errorBySession: {}, loopNoticeBySession: {}, turnOutcomeBySession: {}, memoryEventsBySession: {}, interruptRequestedBySession: {}, interruptDismissedBySession: {}, interactionBySession: {}, queueBySession: {}, steerPendingBySession: {}, todosBySession: {}, composerSeedBySession: {}, skillBySession: {}, nodeRefsBySession: {} };
  vi.clearAllMocks();
  mocks.importImage.mockResolvedValue({ id: 'uploaded', title: '截图.png', params: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ChatPage sessionId="s1" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); mocks.listeners.clear(); Reflect.deleteProperty(Range.prototype, 'getClientRects'); Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect'); vi.unstubAllGlobals(); });

function transfer(kind: string) {
  const file = new File(['pixels'], '截图.png', { type: 'image/png' });
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, kind === 'paste' ? 'clipboardData' : 'dataTransfer', { value: {
    types: ['Files'], files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
  } });
  return { event, file };
}
it.each(['paste', 'drop'])('accepts %s on the real rich editor, displays the image and sends it without text', async kind => {
  const { event, file } = transfer(kind);
  await act(async () => { host.querySelector('[role="textbox"]')!.dispatchEvent(event); });
  expect(mocks.importImage).toHaveBeenCalledWith('s1', file, expect.anything());
  expect(host.querySelector('img[src="blob:attached-image"]')).not.toBeNull();
  const send = host.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!;
  expect(send.disabled).toBe(false);
  await act(async () => send.click());
  expect(mocks.send).toHaveBeenCalledWith('s1', '看下这些素材', expect.arrayContaining(['canvas:uploaded']), expect.anything());
});
it('surfaces image import failure instead of silently losing the clipboard image', async () => {
  mocks.importImage.mockRejectedValue(new Error('图片上传失败'));
  await act(async () => { host.querySelector('[role="textbox"]')!.dispatchEvent(transfer('paste').event); });
  expect(mocks.error).toHaveBeenCalledWith('图片上传失败');
  expect(mocks.send).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!.disabled).toBe(true);
});

it('keeps normal text paste working in the rich editor', async () => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain'], files: [], items: [], getData: (format: string) => format === 'text/plain' ? '普通文字' : '' } });
  await act(async () => { host.querySelector('[role="textbox"]')!.dispatchEvent(event); });
  expect(host.querySelector('[role="textbox"]')!.textContent).toContain('普通文字');
  expect(mocks.importImage).not.toHaveBeenCalled();
});

it('prevents an attachment-only send while image upload is still pending', async () => {
  let finish: (value: unknown) => void;
  mocks.importImage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { host.querySelector('[role="textbox"]')!.dispatchEvent(transfer('paste').event); });
  expect(host.textContent).toContain('正在添加附件');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!.disabled).toBe(true);
  expect(mocks.send).not.toHaveBeenCalled();
  await act(async () => { finish!({ id: 'uploaded', title: '截图.png', params: {} }); });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!.disabled).toBe(false);
});
