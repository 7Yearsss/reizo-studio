import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../shared/canvas';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    getCanvas: vi.fn(),
    readCanvasStream: vi.fn(
      (_id: string, _rev: number, _cb: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    ),
    addCanvasNode: vi.fn(),
    addCanvasEdge: vi.fn(),
    setCanvasNodeAsset: vi.fn(),
    uploadCanvasNodeMask: vi.fn(),
    runCanvasNode: vi.fn(),
    patchCanvasNode: vi.fn(),
  };
});

import * as api from '../api';
import * as canvasStore from './canvasStore';

function sourceNode(): CanvasNode {
  return {
    id: 'src',
    canvasId: 'c1',
    type: 'image',
    x: 10,
    y: 20,
    w: 320,
    h: 380,
    title: '原图',
    params: { prompt: 'cat', size: '1024x1024' },
    paramsHash: null,
    runState: 'done',
    output: { assets: ['c1/src.png'] },
    updatedAt: '',
  };
}

describe('deriveImageEdit', () => {
  beforeEach(async () => {
    vi.mocked(api.getCanvas).mockResolvedValue({
      canvas: { id: 'c1', sessionId: 's1', liveRevision: 1, createdAt: '', updatedAt: '' },
      nodes: [sourceNode()],
      edges: [],
    });
    let n = 0;
    vi.mocked(api.addCanvasNode).mockImplementation(async (_cid, input) => ({
      id: `new-${++n}`,
      canvasId: 'c1',
      type: input.type,
      x: input.x ?? 0,
      y: input.y ?? 0,
      w: input.w ?? 320,
      h: input.h ?? 380,
      title: input.title ?? '',
      params: input.params ?? {},
      paramsHash: null,
      runState: 'idle',
      output: null,
      updatedAt: '',
    }));
    vi.mocked(api.addCanvasEdge).mockImplementation(async (_cid, input) => ({
      id: `edge-${++n}`,
      canvasId: 'c1',
      sourceId: input.sourceId,
      targetId: input.targetId,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
    }));
    vi.mocked(api.setCanvasNodeAsset).mockImplementation(async (_cid, id) => ({
      ...sourceNode(),
      id,
      runState: 'done',
      output: { assets: [`c1/${id}.png`] },
      params: canvasStore.nodeById('s1', id)?.params ?? {},
    }));
    vi.mocked(api.uploadCanvasNodeMask).mockResolvedValue({ maskAsset: 'c1/new-1-mask-abc.png' });
    vi.mocked(api.runCanvasNode).mockResolvedValue(undefined);
    vi.mocked(api.patchCanvasNode).mockImplementation(async (_cid, id, patch) => ({
      ...(canvasStore.nodeById('s1', id) ?? sourceNode()),
      id,
      ...patch,
      params: (patch.params as CanvasNode['params']) ?? canvasStore.nodeById('s1', id)?.params ?? {},
    }));
    await canvasStore.openCanvas('s1');
  });

  afterEach(() => {
    canvasStore.closeCanvas('s1');
  });

  it('creates a local crop node, wires image_out → edit_src, and uploads the blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const id = await canvasStore.deriveImageEdit(
      's1',
      'src',
      { kind: 'crop', cropRect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
      { localResultBlob: blob },
    );
    expect(id).toBeTruthy();
    const created = canvasStore.nodeById('s1', id!);
    expect((created?.params as { edit?: { kind: string } }).edit?.kind).toBe('crop');
    expect(api.addCanvasEdge).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ sourceId: 'src', sourceHandle: 'image_out', targetHandle: 'edit_src' }),
    );
    expect(api.setCanvasNodeAsset).toHaveBeenCalled();
    expect(api.runCanvasNode).not.toHaveBeenCalled();
  });

  it('revises an existing edit node in place and re-runs model edits', async () => {
    vi.mocked(api.addCanvasNode).mockClear();
    const id = await canvasStore.deriveImageEdit('s1', 'src', {
      kind: 'relight',
      params: { colorTempK: 3000, lightDir: 'left' },
    });
    expect(id).toBeTruthy();
    expect(api.addCanvasNode).toHaveBeenCalledTimes(1);
    vi.mocked(api.runCanvasNode).mockClear();
    await canvasStore.reviseImageEdit('s1', id!, { params: { colorTempK: 6500, lightDir: 'left' } });
    const updated = canvasStore.nodeById('s1', id!);
    expect((updated?.params as { edit?: { params?: { colorTempK?: number } } }).edit?.params?.colorTempK).toBe(6500);
    expect(api.runCanvasNode).toHaveBeenCalledWith('c1', id, { confirmedSpend: true });
    expect(api.addCanvasNode).toHaveBeenCalledTimes(1);
  });

  it('uploads a mask and runs model edits', async () => {
    const mask = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const id = await canvasStore.deriveImageEdit('s1', 'src', { kind: 'erase' }, { maskBlob: mask });
    expect(id).toBeTruthy();
    expect(api.uploadCanvasNodeMask).toHaveBeenCalled();
    expect(api.runCanvasNode).toHaveBeenCalledWith('c1', id, { confirmedSpend: true });
  });
});
