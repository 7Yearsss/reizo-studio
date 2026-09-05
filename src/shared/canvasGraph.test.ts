import { describe, it, expect } from 'vitest';
import { isPortCompatible, wouldCycle } from './canvasGraph';
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
