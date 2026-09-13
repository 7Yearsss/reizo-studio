import { describe, expect, it } from 'vitest';
import {
  isStructuralTargetHandle,
  mentionPromptKey,
  planMentionWire,
  shouldSyncMentionOnEdge,
} from './canvasMentionWire';

describe('planMentionWire', () => {
  it('routes image → video onto reference, not start_frame', () => {
    expect(planMentionWire({ id: 'img', type: 'image' }, { id: 'vid', type: 'video' })).toEqual({
      sourceHandle: 'image_out',
      targetHandle: 'reference',
    });
  });

  it('routes image → image onto reference', () => {
    expect(planMentionWire({ id: 'a', type: 'image' }, { id: 'b', type: 'image' })).toEqual({
      sourceHandle: 'image_out',
      targetHandle: 'reference',
    });
  });

  it('routes note → image onto prompt', () => {
    expect(planMentionWire({ id: 'n', type: 'note' }, { id: 'img', type: 'image' })).toEqual({
      sourceHandle: 'prompt_out',
      targetHandle: 'prompt',
    });
  });

  it('routes audio → video onto audio_in', () => {
    expect(planMentionWire({ id: 'a', type: 'audio' }, { id: 'v', type: 'video' })).toEqual({
      sourceHandle: 'audio_out',
      targetHandle: 'audio_in',
    });
  });

  it('refuses audio → image', () => {
    expect(planMentionWire({ id: 'a', type: 'audio' }, { id: 'img', type: 'image' })).toBeNull();
  });

  it('refuses self and group endpoints', () => {
    expect(planMentionWire({ id: 'x', type: 'image' }, { id: 'x', type: 'image' })).toBeNull();
    expect(planMentionWire({ id: 'g', type: 'group' }, { id: 'img', type: 'image' })).toBeNull();
  });
});

describe('shouldSyncMentionOnEdge', () => {
  it('does not sync first/last frame or edit source', () => {
    expect(shouldSyncMentionOnEdge('start_frame', 'image')).toBe(false);
    expect(shouldSyncMentionOnEdge('end_frame', 'image')).toBe(false);
    expect(shouldSyncMentionOnEdge('edit_src', 'image')).toBe(false);
    expect(isStructuralTargetHandle('start_frame')).toBe(true);
  });

  it('syncs reference sockets', () => {
    expect(shouldSyncMentionOnEdge('reference', 'image')).toBe(true);
    expect(shouldSyncMentionOnEdge('ref_2', 'anchor')).toBe(true);
  });

  it('syncs prompt for any source (fallback socket for @ wires)', () => {
    expect(shouldSyncMentionOnEdge('prompt', 'note')).toBe(true);
    expect(shouldSyncMentionOnEdge('prompt', 'agent')).toBe(true);
    expect(shouldSyncMentionOnEdge('prompt', 'image')).toBe(true);
  });

  it('does not treat a bare handle as a mention twin (video fallback is start frame)', () => {
    expect(shouldSyncMentionOnEdge(null, 'image')).toBe(false);
    expect(shouldSyncMentionOnEdge(undefined, 'image')).toBe(false);
  });
});

describe('mentionPromptKey', () => {
  it('maps node types to the stored prompt field', () => {
    expect(mentionPromptKey('image')).toBe('prompt');
    expect(mentionPromptKey('note')).toBe('content');
    expect(mentionPromptKey('agent')).toBeNull();
  });
});
