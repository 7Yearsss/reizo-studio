import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { createSettingsStore } from '../storage/settingsStore';
import { createCanvasTools } from './canvasTools';
import { findLikelyGaps } from './canvasGapCheck';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

async function setup() {
  const handle = openDb(':memory:');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-test-'));
  const sessions = createSqliteSessionStore(handle);
  const canvasStore = createCanvasStore(handle);
  const settingsStore = createSettingsStore(tmpDir);
  const session = await sessions.create('test-session', null, null);
  return { canvasStore, settingsStore, sessionId: session.id };
}

function addNode(canvasStore: ReturnType<typeof createCanvasStore>, canvasId: string, type: string, title = type) {
  return canvasStore.addNode(canvasId, { type: type as never, x: 0, y: 0, w: 100, h: 100, title, params: {} }).node;
}

describe('findLikelyGaps', () => {
  it('warns on a video node with no script/voiceover source upstream', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const vid = addNode(canvasStore, canvas.id, 'video');

    const warnings = findLikelyGaps(canvasStore, canvas.id, [vid.id], '15s 口播广告');
    expect(warnings.some((w) => w.includes('脚本/配音来源'))).toBe(true);
    // Intent implies voiceover and no audio node exists at all.
    expect(warnings.some((w) => w.includes('音频节点'))).toBe(true);
  });

  it('does not warn on the storyboard topology note → image → video', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const note = addNode(canvasStore, canvas.id, 'note', '分镜脚本');
    const img = addNode(canvasStore, canvas.id, 'image', '关键帧');
    const vid = addNode(canvasStore, canvas.id, 'video');
    canvasStore.addEdge(canvas.id, { sourceId: note.id, targetId: img.id, sourceHandle: null, targetHandle: 'prompt' });
    canvasStore.addEdge(canvas.id, { sourceId: img.id, targetId: vid.id, sourceHandle: null, targetHandle: 'start_frame' });

    const warnings = findLikelyGaps(canvasStore, canvas.id, [img.id, vid.id], '口播广告');
    expect(warnings.some((w) => w.includes('脚本/配音来源'))).toBe(false);
  });

  it('does not warn when the video has a note or audio upstream', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const note = addNode(canvasStore, canvas.id, 'note', '脚本');
    const audio = addNode(canvasStore, canvas.id, 'audio', '配音');
    const vid = addNode(canvasStore, canvas.id, 'video');
    canvasStore.addEdge(canvas.id, { sourceId: note.id, targetId: vid.id, sourceHandle: null, targetHandle: 'prompt' });
    canvasStore.addEdge(canvas.id, { sourceId: audio.id, targetId: vid.id, sourceHandle: 'audio_out', targetHandle: 'audio_in' });

    const warnings = findLikelyGaps(canvasStore, canvas.id, [vid.id], '口播广告');
    expect(warnings).toHaveLength(0);
  });

  it('warns when multiple shot images have no reference edge wired', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const a = addNode(canvasStore, canvas.id, 'image', '镜头1');
    const b = addNode(canvasStore, canvas.id, 'image', '镜头2');

    const warnings = findLikelyGaps(canvasStore, canvas.id, [a.id, b.id]);
    expect(warnings.some((w) => w.includes('参考'))).toBe(true);
  });

  it('stays quiet when shot images are anchored via reference/ref_N edges', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const anchor = addNode(canvasStore, canvas.id, 'anchor', '定妆');
    const a = addNode(canvasStore, canvas.id, 'image', '镜头1');
    const b = addNode(canvasStore, canvas.id, 'image', '镜头2');
    canvasStore.addEdge(canvas.id, { sourceId: anchor.id, targetId: a.id, sourceHandle: 'anchor_out', targetHandle: 'ref_1' });

    const warnings = findLikelyGaps(canvasStore, canvas.id, [a.id, b.id]);
    expect(warnings).toHaveLength(0);
  });

  it('stays quiet when an anchor node feeds an image via a default handle', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const anchor = addNode(canvasStore, canvas.id, 'anchor', '定妆');
    const a = addNode(canvasStore, canvas.id, 'image', '镜头1');
    const b = addNode(canvasStore, canvas.id, 'image', '镜头2');
    // No ref_N/ref_N target handle — the anchor node type alone marks the reference.
    canvasStore.addEdge(canvas.id, { sourceId: anchor.id, targetId: a.id, sourceHandle: 'anchor_out', targetHandle: null });

    const warnings = findLikelyGaps(canvasStore, canvas.id, [a.id, b.id]);
    expect(warnings).toHaveLength(0);
  });

  it('returns nothing for a single idle image', async () => {
    const { canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const img = addNode(canvasStore, canvas.id, 'image');

    expect(findLikelyGaps(canvasStore, canvas.id, [img.id])).toHaveLength(0);
  });
});

describe('run_graph warnings', () => {
  it('still dispatches and returns warnings without blocking', async () => {
    const { canvasStore, settingsStore, sessionId } = await setup();
    const { tools } = createCanvasTools({ sessionId, canvasStore, settingsStore, dataRoot: './data-test' });
    const canvas = canvasStore.ensureCanvas(sessionId);
    addNode(canvasStore, canvas.id, 'video');

    // wait:false path — dispatch succeeds even though the graph is gappy.
    const res = (await (tools.run_graph as any).execute({
      wait: false,
      intent: '口播广告视频',
    })) as { ok?: boolean; status?: string; warnings?: string[]; error?: string };
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.status).toBe('running');
    expect(res.warnings && res.warnings.length > 0).toBe(true);
  });
});
