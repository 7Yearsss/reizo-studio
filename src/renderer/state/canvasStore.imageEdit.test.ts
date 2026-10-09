import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../shared/canvas';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    getCanvas: vi.fn(),
    editCanvas: vi.fn(),
    editCanvasWithUploads: vi.fn(),
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
  let revision = 0;
  beforeEach(async () => {
    revision++;
    vi.mocked(api.getCanvas).mockResolvedValue({
      canvas: { id: 'c1', sessionId: 's1', liveRevision: revision, createdAt: '', updatedAt: '' },
      nodes: [sourceNode()],
      edges: [],
    });
    vi.mocked(api.editCanvas).mockImplementation(async (_cid, edits) => {
      const state = canvasStore.getSnapshot();
      let nodes = structuredClone(state.nodesBySession.s1 ?? []);
      let edges = structuredClone(state.edgesBySession.s1 ?? []);
      for (const edit of edits) {
        if (edit.kind === 'add_node') nodes.push({ ...sourceNode(), ...edit.node, id: edit.id, output: null, runState: 'idle', ...edit.patch });
        if (edit.kind === 'update_node') nodes = nodes.map((node) => node.id === edit.id ? { ...node, ...edit.patch } : node);
        if (edit.kind === 'delete_node') { nodes = nodes.filter((node) => node.id !== edit.id); edges = edges.filter((edge) => edge.sourceId !== edit.id && edge.targetId !== edit.id); }
        if (edit.kind === 'add_edge') edges.push({ ...edit.edge, canvasId: 'c1' });
        if (edit.kind === 'delete_edge') edges = edges.filter((edge) => edge.id !== edit.id);
      }
      return { canvas: { id: 'c1', sessionId: 's1', liveRevision: ++revision, createdAt: '', updatedAt: '' }, nodes, edges };
    });
    vi.mocked(api.setCanvasNodeAsset).mockImplementation(async (_cid, id) => ({
      ...sourceNode(),
      id,
      runState: 'done',
      output: { assets: [`c1/${id}.png`] },
      params: canvasStore.nodeById('s1', id)?.params ?? {},
    }));
    vi.mocked(api.editCanvasWithUploads).mockImplementation(async (canvasId, edits, uploads, operationId) => {
      const snapshot = await api.editCanvas(canvasId, edits, operationId);
      for (const upload of uploads) {
        const node = snapshot.nodes.find((node) => node.id === upload.nodeId);
        if (upload.role === 'mask') node.params = { ...node.params, edit: { ...(node.params as any).edit, maskAsset: 'c1/mask.png' } };
        else { node.output = { assets: [`c1/${node.id}.png`] }; node.runState = 'done'; }
      }
      return snapshot;
    });
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
    expect(canvasStore.edgesForSession('s1')).toContainEqual(expect.objectContaining({ sourceId: 'src', sourceHandle: 'image_out', targetHandle: 'edit_src' }));
    expect(api.editCanvasWithUploads).toHaveBeenCalled();
    expect(api.runCanvasNode).not.toHaveBeenCalled();
  });

  it('revises an existing edit node in place and re-runs model edits', async () => {
    vi.mocked(api.editCanvas).mockClear();
    const id = await canvasStore.deriveImageEdit('s1', 'src', {
      kind: 'relight',
      params: { colorTempK: 3000, lightDir: 'left' },
    });
    expect(id).toBeTruthy();
    expect(api.editCanvas).toHaveBeenCalledTimes(1);
    vi.mocked(api.runCanvasNode).mockClear();
    await canvasStore.reviseImageEdit('s1', id!, { params: { colorTempK: 6500, lightDir: 'left' } });
    const updated = canvasStore.nodeById('s1', id!);
    expect((updated?.params as { edit?: { params?: { colorTempK?: number } } }).edit?.params?.colorTempK).toBe(6500);
    expect(api.runCanvasNode).toHaveBeenCalledWith('c1', id, { confirmedSpend: true });
    expect(api.editCanvas).toHaveBeenCalledTimes(2);
  });

  it('uploads a mask and runs model edits', async () => {
    const mask = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const id = await canvasStore.deriveImageEdit('s1', 'src', { kind: 'erase' }, { maskBlob: mask });
    expect(id).toBeTruthy();
    expect(api.editCanvasWithUploads).toHaveBeenCalledWith('c1', expect.any(Array), expect.arrayContaining([expect.objectContaining({ role: 'mask' })]), expect.any(String));
    expect(api.runCanvasNode).toHaveBeenCalledWith('c1', id, { confirmedSpend: true });
  });

  it('keeps revision params and pixels together through upload failure, undo, and redo', async () => {
    const oldRect = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const nextRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const id = await canvasStore.deriveImageEdit('s1', 'src', { kind: 'crop', cropRect: oldRect }, { localResultBlob: blob });
    const original = structuredClone(canvasStore.nodeById('s1', id!));
    const unavailable = new Error('upload unavailable');
    vi.mocked(api.editCanvasWithUploads).mockRejectedValueOnce(unavailable);
    vi.mocked(api.setCanvasNodeAsset).mockRejectedValue(unavailable);
    await expect(canvasStore.reviseImageEdit('s1', id!, { cropRect: nextRect }, { localResultBlob: blob })).rejects.toThrow(unavailable);
    expect(canvasStore.nodeById('s1', id!)).toEqual(original);

    vi.mocked(api.editCanvasWithUploads).mockImplementationOnce(async (canvasId, edits, _uploads, operationId) => {
      const snapshot = await api.editCanvas(canvasId, edits, operationId);
      const node = snapshot.nodes.find((node) => node.id === id)!;
      node.output = { assets: ['c1/revised.png'] }; node.runState = 'done';
      return snapshot;
    });
    await canvasStore.reviseImageEdit('s1', id!, { cropRect: nextRect }, { localResultBlob: blob });
    expect(canvasStore.nodeById('s1', id!)?.output.assets).toEqual(['c1/revised.png']);
    expect(await canvasStore.undo('s1')).toBe(true);
    expect(canvasStore.nodeById('s1', id!)?.params).toEqual(original.params);
    expect(canvasStore.nodeById('s1', id!)?.output).toEqual(original.output);
    expect(await canvasStore.redo('s1')).toBe(true);
    expect((canvasStore.nodeById('s1', id!)?.params as any).edit.cropRect).toEqual(nextRect);
    expect(canvasStore.nodeById('s1', id!)?.output.assets).toEqual(['c1/revised.png']);
  });

  it('retains the published revision mask through undo and redo without uploading it again', async () => {
    const id = await canvasStore.deriveImageEdit('s1', 'src', { kind: 'erase', maskAsset: 'c1/original-mask.png' });
    const mask = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const before = vi.mocked(api.editCanvasWithUploads).mock.calls.length;
    await canvasStore.reviseImageEdit('s1', id!, { instruction: 'erase mark' }, { maskBlob: mask, rerun: false });
    expect((canvasStore.nodeById('s1', id!)?.params as any).edit.maskAsset).toBe('c1/mask.png');
    expect(await canvasStore.undo('s1')).toBe(true);
    expect((canvasStore.nodeById('s1', id!)?.params as any).edit.maskAsset).toBe('c1/original-mask.png');
    expect(await canvasStore.redo('s1')).toBe(true);
    expect((canvasStore.nodeById('s1', id!)?.params as any).edit.maskAsset).toBe('c1/mask.png');
    expect(vi.mocked(api.editCanvasWithUploads).mock.calls.length - before).toBe(1);
  });
});
