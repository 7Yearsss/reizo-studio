import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getAudioDriver, mockAudioDriver } from './audioDrivers';
import { runAudioNode } from './audioExecutor';
import { createProviderStore } from '../storage/providerStore';
import { createCanvasStore } from '../storage/canvasStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { openDb } from '../db/client';

describe('audioDrivers & audioExecutor', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'reizo-audio-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('mockAudioDriver generates a valid PCM WAV buffer', async () => {
    const result = await mockAudioDriver.synthesize(
      { prompt: '测试语音合成', format: 'wav' },
      {},
    );

    expect(result.format).toBe('wav');
    expect(result.audioBuffer.length).toBeGreaterThan(1000);
    // RIFF chunk ID
    expect(result.audioBuffer.toString('utf8', 0, 4)).toBe('RIFF');
    // WAVE format
    expect(result.audioBuffer.toString('utf8', 8, 12)).toBe('WAVE');
    // fmt subchunk
    expect(result.audioBuffer.toString('utf8', 12, 16)).toBe('fmt ');
    // data subchunk
    expect(result.audioBuffer.toString('utf8', 36, 40)).toBe('data');
  });

  it('driver factory resolves driver by type safely', () => {
    expect(getAudioDriver('mock').id).toBe('mock');
    expect(getAudioDriver('minimax').id).toBe('minimax');
    expect(getAudioDriver('cosyvoice').id).toBe('cosyvoice');
    expect(getAudioDriver('unknown_future_vendor').id).toBe('mock');
  });

  it('runAudioNode executes mock driver and writes asset to disk', async () => {
    const providerStore = createProviderStore(tmpDir);
    const db = openDb(':memory:');
    const sessions = createSqliteSessionStore(db);
    const session = await sessions.create('test-session', null, null);
    const canvasStore = createCanvasStore(db);

    const canvas = canvasStore.ensureCanvas(session.id);
    const { node } = canvasStore.addNode(canvas.id, {
      type: 'audio',
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      title: '测试音频节点',
      params: { prompt: '你好，欢迎来到 Reizo Studio' },
    });

    await runAudioNode({
      canvasStore,
      providerStore,
      dataRoot: tmpDir,
      canvasId: canvas.id,
      node,
      providerId: 'mock-audio-local',
    });

    const updated = canvasStore.getNode(canvas.id, node.id);
    expect(updated?.runState).toBe('done');
    expect(updated?.output?.assets?.length).toBe(1);
    expect(updated?.output?.assets?.[0]).toMatch(new RegExp(`^${canvas.id}/${node.id}-.+\\.(wav|mp3)$`));
  });
});
