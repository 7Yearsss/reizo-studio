import { describe, it, expect } from 'vitest';
import { inputHash, isPortCompatible, normalizeSourceHandle, wouldCycle } from './canvasGraph';
import type { CanvasNode, CanvasEdge } from './canvas';

function makeNode(type: CanvasNode['type'], id: string): CanvasNode {
  return {
    id,
    canvasId: 'c1',
    type,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    title: id,
    params: {},
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: '',
  };
}

describe('inputHash selected upstream versions', () => {
  it('invalidates a saved input hash when the selected version changes with the same asset array', () => {
    const video = makeNode('video', 'video');
    const assets = ['draft.png', 'refined.png', 'edited.png'];
    const source = { ...makeNode('image', 'frame'), output: { assets } };
    const saved = inputHash(video, [source]);
    const selected = inputHash(video, [{ ...source, output: { assets, activeAssetIndex: 1 } }]);
    expect(selected).not.toBe(saved);
    expect(inputHash(video, [{ ...source, output: { assets, activeAssetIndex: 2 } }])).not.toBe(selected);
    expect(inputHash(video, [{ ...source, output: { assets, activeAssetIndex: 0 } }])).toBe(saved);
    const anchor = { ...makeNode('anchor', 'fixed'), params: { assetId: 'asset-version-1', role: 'content', strength: 'mid', note: 'composition' } };
    const pinned = inputHash(video, [anchor]);
    expect(inputHash(video, [{ ...anchor, runState: 'error', output: { assets, activeAssetIndex: 2 } }])).toBe(pinned);
    for (const change of [{ assetId: 'asset-version-2' }, { role: 'style' }, { strength: 'high' }, { note: 'changed' }]) {
      expect(inputHash(video, [{ ...anchor, params: { ...anchor.params, ...change } }])).not.toBe(pinned);
    }
  });

  it('retains the exact legacy hash format for missing or zero selection', () => {
    const video = { ...makeNode('video', 'video'), params: { prompt: 'use the frame' } };
    const source = { ...makeNode('image', 'frame'), output: { assets: ['draft.png', 'refined.png'], text: 'reference' } };
    const legacy = JSON.stringify({ params: video.params, up: [{ id: 'frame', assets: source.output.assets, text: 'reference' }] });
    expect(inputHash(video, [source])).toBe(legacy);
    expect(inputHash(video, [{ ...source, output: { ...source.output, activeAssetIndex: 0 } }])).toBe(legacy);
  });
});

describe('inputHash upstream note content', () => {
  it('keeps legacy hashes when there is no meaningful note content', () => {
    const audio = makeNode('audio', 'audio');
    const note = makeNode('note', 'script');
    const legacy = JSON.stringify({ params: audio.params, up: [{ id: 'script', assets: [], text: null }] });
    for (const content of [undefined, '', '  ']) {
      expect(inputHash(audio, [{ ...note, params: { content } }])).toBe(legacy);
    }
    const image = { ...makeNode('image', 'script'), params: { content: 'Unrelated image metadata' } };
    expect(inputHash(audio, [image])).toBe(legacy);
  });
});

describe('isPortCompatible (Port Compatibility Matrix)', () => {
  const noteNode = makeNode('note', 'note1');
  const imageNode = makeNode('image', 'img1');
  const videoNode = makeNode('video', 'vid1');
  const audioNode = makeNode('audio', 'aud1');
  const anchorNode = makeNode('anchor', 'anc1');
  const extractorNode = makeNode('frameExtractor', 'ext1');
  const groupNode = makeNode('group', 'grp1');

  it('allows text/note to prompt connection', () => {
    const res = isPortCompatible(noteNode, imageNode, null, 'prompt');
    expect(res.valid).toBe(true);
  });

  it('rejects audio to prompt connection', () => {
    const res = isPortCompatible(audioNode, imageNode, null, 'prompt');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('音频节点只能连接到视频节点');
  });

  it('allows audio to video audio_in handle', () => {
    const res = isPortCompatible(audioNode, videoNode, 'audio_out', 'audio_in');
    expect(res.valid).toBe(true);
  });

  it('rejects image to video audio_in handle', () => {
    const res = isPortCompatible(imageNode, videoNode, 'image_out', 'audio_in');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('音轨输入');
  });

  it('allows image to start_frame handle', () => {
    const res = isPortCompatible(imageNode, videoNode, 'image_out', 'start_frame');
    expect(res.valid).toBe(true);
  });

  it('allows anchor broadcast to ref handles', () => {
    const res = isPortCompatible(anchorNode, imageNode, 'anchor_out', 'ref_1');
    expect(res.valid).toBe(true);
  });

  it('allows video to frameExtractor', () => {
    const res = isPortCompatible(videoNode, extractorNode, 'video_out', null);
    expect(res.valid).toBe(true);
  });

  it('rejects connecting group containers directly', () => {
    const res = isPortCompatible(groupNode, imageNode, null, null);
    expect(res.valid).toBe(false);
  });
});

describe('wouldCycle', () => {
  it('detects direct self cycle', () => {
    expect(wouldCycle([], 'n1', 'n1')).toBe(true);
  });

  it('detects indirect cycles', () => {
    const edges: CanvasEdge[] = [
      { id: 'e1', canvasId: 'c1', sourceId: 'a', targetId: 'b', sourceHandle: null, targetHandle: null },
      { id: 'e2', canvasId: 'c1', sourceId: 'b', targetId: 'c', sourceHandle: null, targetHandle: null },
    ];
    expect(wouldCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCycle(edges, 'a', 'c')).toBe(false);
  });
});

describe('normalizeSourceHandle', () => {
  it('maps generic "output"/missing handles to the node type\'s real output id', () => {
    expect(normalizeSourceHandle('image', 'output')).toBe('image_out');
    expect(normalizeSourceHandle('image', null)).toBe('image_out');
    expect(normalizeSourceHandle('image', undefined)).toBe('image_out');
    expect(normalizeSourceHandle('audio', 'default')).toBe('audio_out');
    expect(normalizeSourceHandle('note', 'output')).toBe('prompt_out');
    expect(normalizeSourceHandle('video', 'output')).toBe('prompt_out');
    expect(normalizeSourceHandle('anchor', 'output')).toBe('anchor_out');
    expect(normalizeSourceHandle('frameExtractor', 'output')).toBe('frame_out');
    expect(normalizeSourceHandle('subgraph', 'output')).toBe('output');
  });

  it('keeps explicit real handles untouched', () => {
    expect(normalizeSourceHandle('image', 'image_out')).toBe('image_out');
    expect(normalizeSourceHandle('image', 'edit_src')).toBe('edit_src');
  });

  it('returns null for types without an output handle', () => {
    expect(normalizeSourceHandle('agent', 'output')).toBeNull();
    expect(normalizeSourceHandle('agent', null)).toBeNull();
  });
});
