import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasStore } from '../storage/canvasStore';
import { createVideoEditorTools } from './videoEditorTools';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const editor = vi.hoisted(() => ({ catalog: vi.fn(), open: vi.fn(), call: vi.fn(), pendingReview: vi.fn(), applyReviewed: vi.fn() }));
vi.mock('../videoEditor/service', () => ({ videoEditorFor: () => editor }));

afterEach(() => vi.clearAllMocks());
it('exposes inspected source images as multimodal tool output and keeps rough cut evidence mandatory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'source-tool-'));
  try {
    const image = { type: 'image', mimeType: 'image/jpeg', data: 'aW1hZ2U=' };
    editor.call.mockImplementation(async (_session: string, name: string, args: Record<string, unknown>) => ({ content: name === 'read_project'
      ? [{ type: 'text', text: JSON.stringify({ projectId: 'p', timeline: { fps: 30 }, mediaPool: { assets: [{ id: 'chosen', name: '素材', kind: 'video', src: '/media/fixed.mp4', durationInFrames: 180 }] } }) }]
      : [{ type: 'text', text: JSON.stringify({ assetId: 'chosen', coordinateSpace: 'source', frames: args.frames }) }, image] }));
    const tools = createVideoEditorTools('s', root);
    const execute = tools.video_editor_inspect_sources.execute;
    if (!execute || !tools.video_editor_inspect_sources.toModelOutput) throw new Error('Inspection tool missing');
    const output = await execute({ editSessionId: 'd', sources: [{ assetId: 'chosen', count: 6 }] }, { toolCallId: 'inspect', messages: [], context: undefined });
    if (!('content' in output)) throw new Error('Expected a completed inspection result');
    const modelOutput = await tools.video_editor_inspect_sources.toModelOutput({ output, toolCallId: 'inspect', input: { editSessionId: 'd', sources: [{ assetId: 'chosen', count: 6 }] } });
    expect(modelOutput).toMatchObject({ type: 'content', value: expect.arrayContaining([{ type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: image.data } }]) });
    expect(tools.video_editor_rough_cut.execute).toBeTypeOf('function');
    expect(editor.call.mock.calls.map(c => c[1])).toEqual(['read_project', 'view_asset_frames']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('guides misrouted host tools without invoking the editor transport', async () => {
  const tools = createVideoEditorTools('chat', 'root');
  expect('video_editor_apply' in tools).toBe(false);
  const execute = tools.video_editor_call.execute;
  if (!execute) throw new Error('Missing low-level tool');
  await expect(execute({ name: 'video_editor_compose', arguments: {} }, { toolCallId: 'bad-route', messages: [], context: undefined })).rejects.toThrow('一级工具');
  expect(editor.call).not.toHaveBeenCalled();
});

it('does not report an empty editor pool when this conversation has no workbench canvas', async () => {
  const findCanvasBySession = vi.fn(() => undefined);
  const store = { findCanvasBySession } as unknown as CanvasStore;
  const tools = createVideoEditorTools('editor-only', 'qa-editor-only', store);
  const execute = tools.video_editor_media?.execute;
  if (!execute) throw new Error('Workbench media tool missing');
  const result = await execute({ action: 'list' }, { toolCallId: 'list', messages: [], context: undefined });
  expect(findCanvasBySession).toHaveBeenCalledWith('editor-only');
  expect(result).toMatchObject({ scope: 'workbench', assets: [], editorMediaPool: { status: 'not_inspected' } });
  // Discovery must not silently start a draft or import a file just to list sources.
  expect(editor.catalog).not.toHaveBeenCalled();
  expect(editor.open).not.toHaveBeenCalled();
  expect(editor.call).not.toHaveBeenCalled();
});

it('keeps exact workbench asset identities separate from the uninspected editor pool', async () => {
  const asset = { id: 'selected-old-version', kind: 'video', name: 'clip.mp4', contentHash: 'original-hash' };
  const list = vi.fn(() => [asset]);
  const store = { findCanvasBySession: () => ({ id: 'this-canvas' }), assets: { list }, getNodes: (): never[] => [] } as unknown as CanvasStore;
  const tools = createVideoEditorTools('with-canvas', 'qa-with-canvas', store);
  const execute = tools.video_editor_media?.execute;
  if (!execute) throw new Error('Workbench media tool missing');
  const result = await execute({ action: 'list' }, { toolCallId: 'list', messages: [], context: undefined });
  expect(list).toHaveBeenCalledWith('this-canvas');
  expect(result).toMatchObject({ scope: 'workbench', assets: [asset], editorMediaPool: { status: 'not_inspected' } });
  expect(editor.call).not.toHaveBeenCalled();
});
