// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode, CanvasSnapshot } from '../../../shared/canvas';
import type { CanvasAsset, CanvasAssetSummary } from '../../../shared/canvasAssets';

const harness = vi.hoisted(() => ({ snapshots: {} as Record<string, CanvasSnapshot>, list: vi.fn(), reuse: vi.fn(), edges: vi.fn(), runs: vi.fn() }));
vi.mock('@xyflow/react', () => ({ Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>, useReactFlow: () => ({ screenToFlowPosition: () => ({ x: 140, y: 180 }) }) }));
vi.mock('../../state/tabStore', () => ({ activeSessionId: (): string | null => null, subscribe: (): (() => void) => (): void => undefined }));
vi.mock('../../state/settingsStore', () => ({ getSnapshot: () => ({ settings: {} }) }));
vi.mock('../../lib/notify', () => ({ primeNotifications: vi.fn(), notifyJobDone: vi.fn() }));
vi.mock('../../api', async (original) => ({ ...await original<typeof import('../../api')>(),
  getCanvas: vi.fn(async (sessionId: string) => harness.snapshots[sessionId]),
  canvasAssetUrl: vi.fn(async (path: string) => `http://localhost/assets/${path}`),
  listCanvasAssets: harness.list, reuseCanvasAsset: harness.reuse, addCanvasEdge: harness.edges, runCanvasNode: harness.runs,
}));

let root: Root;
let container: HTMLDivElement;
let store: typeof import('../../state/canvasStore');
let Shelf: typeof import('./AssetShelf')['default'];
const flash = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function node(id: string, canvasId = 'c1'): CanvasNode {
  return { id, canvasId, type: 'image', x: 0, y: 0, w: 320, h: 380, title: '测试图片', params: {}, paramsHash: null,
    runState: 'done', output: { assets: [`${canvasId}/new.png`, `${canvasId}/old.png`], activeAssetIndex: 0 }, updatedAt: '' };
}
function snapshot(sessionId: string, canvasId: string, nodes: CanvasNode[] = []): CanvasSnapshot {
  return { canvas: { id: canvasId, sessionId, liveRevision: 1, createdAt: '', updatedAt: '' }, nodes, edges: [] };
}
function asset(id: string): CanvasAsset {
  return { id, canvasId: 'c1', path: 'c1/old.png', kind: 'image', mimeType: 'image/png', byteSize: 3, contentHash: 'a'.repeat(64), source: 'imported', createdAt: '' };
}
function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent.trim() === text);
  if (!button) throw new Error(`Missing action: ${text}`);
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  button.click();
}
async function render(sessionId = 's1') { await act(async () => root.render(<Shelf sessionId={sessionId} selectedTargetIds={['producer']} flash={flash} />)); }

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.snapshots = { s1: snapshot('s1', 'c1', [node('producer')]), s2: snapshot('s2', 'c2') };
  harness.list.mockReset(); harness.reuse.mockReset();
  store = await import('../../state/canvasStore');
  Shelf = (await import('./AssetShelf')).default;
  await store.openCanvas('s1');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  store.closeCanvas('s1'); store.closeCanvas('s2'); container.remove(); vi.unstubAllGlobals();
});

describe('asset shelf public workflows', () => {
  it('reuses the selected fixed version once, retries safely and rejects a late library response after switching canvases', async () => {
    const first = deferred<{ node: CanvasNode; asset: CanvasAsset }>();
    harness.reuse.mockReturnValueOnce(first.promise);
    await render();
    await act(async () => { click('素材栏'); });
    await act(async () => { click('版本 2'); });
    await act(async () => { click('引用此版本'); click('引用此版本'); });
    expect(harness.reuse).toHaveBeenCalledTimes(1);
    expect(harness.reuse.mock.calls[0][1]).toMatchObject({ sourceNodeId: 'producer', sourceCanvasId: 'c1', assetIndex: 1, asReference: true });
    const operationId = harness.reuse.mock.calls[0][2];
    expect(operationId).toEqual(expect.any(String));
    await act(async () => { first.reject(new Error('连接暂时断开')); });
    expect(container.textContent).toContain('连接暂时断开');
    const fixed: CanvasNode = { ...node('fixed'), type: 'anchor', params: { assetId: 'old-version', role: 'content', strength: 'mid' }, output: { assets: ['c1/old.png'] } };
    harness.reuse.mockResolvedValueOnce({ node: fixed, asset: asset('old-version') });
    await act(async () => { click('引用此版本'); });
    expect(harness.reuse.mock.calls[1][2]).toBe(operationId);
    expect(store.nodeById('s1', 'fixed')?.output?.assets).toEqual(['c1/old.png']);
    expect(harness.edges).not.toHaveBeenCalled(); expect(harness.runs).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith('已添加固定版本引用');
    const old = deferred<CanvasAssetSummary[]>(); const current = deferred<CanvasAssetSummary[]>();
    harness.list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await act(async () => { click('素材库'); });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    const oldSignal = harness.list.mock.calls[0][0].signal as AbortSignal;
    await act(async () => { await store.openCanvas('s2'); });
    await render('s2');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { current.reject(new Error('本地服务暂不可用')); });
    expect(container.textContent).toContain('本地服务暂不可用');
    harness.list.mockResolvedValueOnce([{ ...asset('new-library'), kind: 'audio', mimeType: 'audio/mpeg', label: '新会话素材' }]);
    await act(async () => { click('重试'); });
    await act(async () => { old.resolve([{ ...asset('late-library'), label: '迟到的旧素材' }]); });
    expect(container.textContent).toContain('新会话素材');
    expect(container.textContent).not.toContain('迟到的旧素材');
    expect(harness.reuse).toHaveBeenCalledTimes(2); expect(harness.runs).not.toHaveBeenCalled();
  });
});
