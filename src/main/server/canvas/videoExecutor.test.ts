import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { runVideoNode } from './videoExecutor';
import { awaitVideoJob, cancelVideoJob, getActiveJob } from './asyncJobManager';
import { getVideoDriver, mockDriver } from './videoDrivers';

const settingsStore = {
  get: async () => ({
    activeProviderId: 'openai',
    providers: {},
    permissionMode: 'auto',
  }),
} as unknown as SettingsStore;

async function freshCanvas() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const session = await sessions.create('s', null, null);
  const c = canvas.ensureCanvas(session.id);
  return { canvas, canvasId: c.id };
}

describe('videoExecutor & asyncJobManager', () => {
  it('throws error when video node has empty prompt', async () => {
    const { canvas, canvasId } = await freshCanvas();
    const node = canvas.addNode(canvasId, {
      type: 'video',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: '   ' },
    }).node;

    await expect(
      runVideoNode({
        canvasStore: canvas,
        settingsStore,
        dataRoot: '/tmp/test',
        canvasId,
        node,
      }),
    ).rejects.toThrow(/no prompt/i);
  });

  it('driver registry resolves mock driver by default', () => {
    const driver = getVideoDriver('unknown_or_empty');
    expect(driver.id).toBe('mock');
  });

  it('submits a video job and tracks active job', async () => {
    const { canvas, canvasId } = await freshCanvas();
    const node = canvas.addNode(canvasId, {
      type: 'video',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: 'A futuristic cyber car driving through rain' },
    }).node;

    const submitSpy = vi.spyOn(mockDriver, 'submit');

    await runVideoNode({
      canvasStore: canvas,
      settingsStore,
      dataRoot: '/tmp/test',
      canvasId,
      node,
      providerId: 'mock',
      waitForCompletion: false,
    });

    expect(submitSpy).toHaveBeenCalled();
    const active = getActiveJob(canvasId, node.id);
    expect(active).toBeTruthy();
    expect(active?.driverId).toBe('mock');

    // Clean up timer
    cancelVideoJob(canvasId, node.id);
    expect(getActiveJob(canvasId, node.id)).toBeUndefined();
  });

  it('awaitVideoJob resolves cleanly when job is cancelled or completes', async () => {
    const { canvas, canvasId } = await freshCanvas();
    const node = canvas.addNode(canvasId, {
      type: 'video',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: 'City lights time lapse' },
    }).node;

    await runVideoNode({
      canvasStore: canvas,
      settingsStore,
      dataRoot: '/tmp/test',
      canvasId,
      node,
      providerId: 'mock',
      waitForCompletion: false,
    });

    const promise = awaitVideoJob(canvasId, node.id);
    cancelVideoJob(canvasId, node.id);
    await expect(promise).resolves.toBeUndefined();
  });
});
