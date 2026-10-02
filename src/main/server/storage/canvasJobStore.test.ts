import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, type DbHandle } from '../db/client';
import { MIGRATIONS } from '../db/migrations';
import { createSqliteSessionStore } from './sqliteSessionStore';
import { createCanvasStore } from './canvasStore';
import { CanvasJobStoreError } from './canvasJobStore';

const handles = new Set<DbHandle>();
const tempDirs: string[] = [];
afterEach(() => {
  for (const handle of handles) handle.close();
  handles.clear();
  for (const dir of tempDirs.splice(0)) {
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true });
  }
});

async function fixture(dbPath = ':memory:') {
  const handle = openDb(dbPath);
  handles.add(handle);
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('durable-job', null, null);
  const store = createCanvasStore(handle);
  const canvas = store.ensureCanvas(session.id);
  const node = store.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'cup' } }).node;
  const input = { canvasId: canvas.id, nodeId: node.id, nodeType: node.type, input: { params: { prompt: 'cup' }, refs: [] as string[] }, inputHash: 'input-hash' };
  return { handle, sessions, store, canvas, node, input };
}

describe('durable canvas jobs', () => {
  it('upgrades an existing job database without changing its saved execution history', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-job-migration-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'sessions.db');
    const old = new DatabaseSync(dbPath);
    try {
      old.exec('CREATE TABLE __migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
      for (const migration of MIGRATIONS.filter((entry) => entry.name <= '0006_canvas_jobs')) {
        for (const statement of migration.statements) old.exec(statement);
        old.prepare('INSERT INTO __migrations VALUES (?, ?)').run(migration.name, 1);
      }
      old.exec(`INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('session', 'saved', 1, 1);
        INSERT INTO canvases (id, session_id, created_at, updated_at) VALUES ('canvas', 'session', 1, 1);
        INSERT INTO canvas_jobs (id, canvas_id, node_id, node_type, generation, operation_id, status, input_json, request_hash, created_at, ended_at)
        VALUES ('saved-job', 'canvas', 'deleted-node', 'image', 3, 'original-operation', 'succeeded', '{}', 'original-hash', 1, 2)`);
    } finally { old.close(); }
    const handle = openDb(dbPath);
    handles.add(handle);
    const store = createCanvasStore(handle);
    expect(store.jobs.get('saved-job')).toMatchObject({
      id: 'saved-job', generation: 3, status: 'succeeded', operationId: 'original-operation',
    });
    expect(store.jobs.get('saved-job')?.remoteTask).toBeUndefined();
    expect(handle.raw.prepare('SELECT name FROM __migrations WHERE name = ?').get('0007_canvas_remote_tasks')).toBeTruthy();
  });

  it('persists a remote task handle across reopen and never rebinds its generation', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-remote-job-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'sessions.db');
    const { store, handle, input } = await fixture(dbPath);
    const job = store.jobs.enqueue(input);
    const remote = { driverId: 'kling', taskId: 'task-123', context: { kind: 'image2video' } };
    expect(store.jobs.recordRemoteTask(job.id, remote)).toBe(false);
    store.jobs.markSubmitted(job.id, { providerId: 'kling', model: 'kling-v1' });
    expect(store.jobs.recordRemoteTask(job.id, remote)).toBe(true);
    expect(store.jobs.recordRemoteTask(job.id, { ...remote, context: { kind: 'image2video' } })).toBe(true);
    remote.context.kind = 'edited';
    expect(() => store.jobs.recordRemoteTask(job.id, remote)).toThrow('different remote task');
    handle.close(); handles.delete(handle);
    const reopened = openDb(dbPath);
    handles.add(reopened);
    const restored = createCanvasStore(reopened);
    expect(restored.jobs.get(job.id)).toMatchObject({
      status: 'running', remoteTask: { driverId: 'kling', taskId: 'task-123', context: { kind: 'image2video' } },
    });
    restored.jobs.finish(job.id, 'succeeded', { result: { assets: ['completed.mp4'] } });
    expect(restored.jobs.recordRemoteTask(job.id, { driverId: 'kling', taskId: 'late' })).toBe(false);
  });

  it('rejects credentials in remote handles and stale task submission without affecting a successor', async () => {
    const { store, input } = await fixture();
    const first = store.jobs.enqueue(input);
    store.jobs.markSubmitted(first.id);
    expect(() => store.jobs.recordRemoteTask(first.id, {
      driverId: 'fal', taskId: 'remote', context: { apiKey: 'secret-value' },
    })).toThrow('credentials');
    expect(store.jobs.get(first.id)?.remoteTask).toBeUndefined();
    expect(() => store.jobs.recordRemoteTask(first.id, { driverId: 'fal', taskId: '' })).toThrow('task ID');
    const next = store.jobs.enqueue(input);
    expect(store.jobs.recordRemoteTask(first.id, { driverId: 'fal', taskId: 'late' })).toBe(false);
    expect(store.jobs.isCurrent(next.id)).toBe(true);
    expect(store.jobs.get(next.id)?.remoteTask).toBeUndefined();
  });

  it('rolls a remote task handle back with its canvas transaction', async () => {
    const { store, input } = await fixture();
    const job = store.jobs.enqueue(input);
    store.jobs.markSubmitted(job.id);
    expect(() => store.transaction(() => {
      store.jobs.recordRemoteTask(job.id, { driverId: 'fal', taskId: 'remote' });
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(store.jobs.get(job.id)?.remoteTask).toBeUndefined();
  });

  it('persists queued/running jobs and immutable input snapshots across database reopen', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-jobs-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'sessions.db');
    const { store, handle, canvas, node, input } = await fixture(dbPath);
    const job = store.jobs.enqueue({ ...input, operationId: 'queued' });
    input.input.params.prompt = 'edited after enqueue';
    job.input.params = { prompt: 'edited returned object' };
    const otherNode = store.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    const running = store.jobs.enqueue({ ...input, nodeId: otherNode.id, operationId: 'running' });
    expect(store.jobs.markSubmitted(running.id, { providerId: 'openai', model: 'image-model' })).toBe(true);
    expect(store.jobs.markSubmitted(running.id, { providerId: 'another' })).toBe(false);
    handle.close();
    handles.delete(handle);

    const reopened = openDb(dbPath);
    handles.add(reopened);
    const restored = createCanvasStore(reopened);
    expect(restored.jobs.get(job.id)).toMatchObject({ status: 'queued', input: { params: { prompt: 'cup' } }, generation: 1 });
    expect(restored.jobs.get(running.id)).toMatchObject({ status: 'running', providerId: 'openai', model: 'image-model', inputHash: 'input-hash' });
    expect(restored.jobs.get(running.id)?.submittedAt).toEqual(expect.any(String));
    expect(restored.jobs.current(canvas.id, node.id)?.id).toBe(job.id);
    expect(restored.jobs.findByOperationId(canvas.id, 'running')?.id).toBe(running.id);
    expect(restored.jobs.list(canvas.id)).toHaveLength(2);
    expect(restored.jobs.isCurrent(job.id)).toBe(true);
    expect(restored.jobs.enqueue(input).generation).toBe(2);
    expect(restored.jobs.get(job.id)).toMatchObject({ status: 'cancelled', cancelReason: 'superseded' });
  });

  it('makes terminal outcomes immutable and only accepts first submission once', async () => {
    const { store, input } = await fixture();
    const job = store.jobs.enqueue(input);
    expect(store.jobs.markSubmitted(job.id, { providerId: 'openai', model: 'image-model' })).toBe(true);
    expect(store.jobs.finish(job.id, 'succeeded', { result: { assets: ['canvas/result.png'] } })).toBe(true);
    const terminal = store.jobs.get(job.id);
    expect(store.jobs.finish(job.id, 'failed', { error: 'late error' })).toBe(false);
    expect(store.jobs.finish(job.id, 'cancelled', { cancelReason: 'late cancel' })).toBe(false);
    expect(store.jobs.markSubmitted(job.id, { model: 'late model' })).toBe(false);
    expect(store.jobs.isCurrent(job.id)).toBe(false);
    expect(store.jobs.get(job.id)).toEqual(terminal);
    expect(terminal?.endedAt).toEqual(expect.any(String));
  });

  it('atomically supersedes all prior active jobs and denies stale results without cancelling the newest on replay', async () => {
    const { store, canvas, node, input } = await fixture();
    const first = store.jobs.enqueue({ ...input, operationId: 'first' });
    store.jobs.markSubmitted(first.id, { providerId: 'openai' });
    const second = store.jobs.enqueue({ ...input, operationId: 'second' });
    expect(second.generation).toBe(2);
    expect(store.jobs.get(first.id)).toMatchObject({ status: 'cancelled', cancelReason: 'superseded' });
    expect(store.jobs.isCurrent(first.id)).toBe(false);
    expect(store.jobs.markSubmitted(first.id)).toBe(false);
    expect(store.jobs.finish(first.id, 'succeeded', { result: { assets: ['stale.png'] } })).toBe(false);
    const retry = store.jobs.enqueue({ ...input, operationId: 'first' });
    expect(retry.id).toBe(first.id);
    expect(retry.status).toBe('cancelled');
    expect(store.jobs.current(canvas.id, node.id)?.id).toBe(second.id);
    expect(store.jobs.isCurrent(second.id)).toBe(true);
    expect(store.jobs.list(canvas.id)).toHaveLength(2);
  });

  it('deduplicates canonical identical requests and rejects conflicts before changing ownership', async () => {
    const { store, canvas, input } = await fixture();
    const original = store.jobs.enqueue({ ...input, operationId: 'operation', input: { params: { prompt: 'cup', size: 'square' }, refs: [] } });
    const retry = store.jobs.enqueue({ ...input, operationId: 'operation', input: { refs: [], params: { size: 'square', prompt: 'cup' } } });
    expect(retry.id).toBe(original.id);
    try {
      store.jobs.enqueue({ ...input, operationId: 'operation', input: { params: { prompt: 'bowl' }, refs: [] } });
      throw new Error('Expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(CanvasJobStoreError);
      expect((error as CanvasJobStoreError).status).toBe(409);
    }
    expect(store.jobs.list(canvas.id)).toHaveLength(1);
    expect(store.jobs.isCurrent(original.id)).toBe(true);
  });

  it('retains deleted-node history, refuses late success, and permits historical interruption', async () => {
    const { store, canvas, node, sessions, input } = await fixture();
    const job = store.jobs.enqueue({ ...input, operationId: 'deleted-node' });
    store.jobs.markSubmitted(job.id);
    store.deleteNode(canvas.id, node.id);
    expect(store.jobs.get(job.id)?.status).toBe('running');
    expect(store.jobs.isCurrent(job.id)).toBe(false);
    expect(store.jobs.finish(job.id, 'succeeded', { result: { assets: ['late.png'] } })).toBe(false);
    expect(store.jobs.finish(job.id, 'interrupted', { error: 'process restarted' })).toBe(true);
    expect(store.jobs.enqueue({ ...input, operationId: 'deleted-node' })).toMatchObject({ id: job.id, status: 'interrupted' });
    expect(() => store.jobs.enqueue({ ...input, operationId: 'new-operation' })).toThrow('Canvas node not found');
    await sessions.remove(canvas.sessionId);
    expect(store.jobs.get(job.id)).toBeNull();
  });

  it('rolls back admission, supersession, and document changes together if an outer transaction fails', async () => {
    const { store, canvas, node, input } = await fixture();
    const first = store.jobs.enqueue({ ...input, operationId: 'first' });
    const revision = store.getCanvas(canvas.id)?.liveRevision;
    expect(() => store.transaction(() => {
      store.jobs.enqueue({ ...input, operationId: 'rollback' });
      store.updateNode(canvas.id, node.id, { runState: 'running' });
      throw new Error('admission failed');
    })).toThrow('admission failed');
    expect(store.jobs.get(first.id)?.status).toBe('queued');
    expect(store.jobs.isCurrent(first.id)).toBe(true);
    expect(store.jobs.findByOperationId(canvas.id, 'rollback')).toBeNull();
    expect(store.getNode(canvas.id, node.id)?.runState).toBe('idle');
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(revision);
    expect(store.jobs.enqueue({ ...input, operationId: 'next' }).generation).toBe(2);
  });

  it('rolls back terminal job outcome when the paired document projection fails', async () => {
    const { store, canvas, node, input } = await fixture();
    const job = store.jobs.enqueue(input);
    store.jobs.markSubmitted(job.id);
    expect(() => store.transaction(() => {
      expect(store.jobs.finish(job.id, 'succeeded', { result: { assets: ['result.png'] } })).toBe(true);
      store.updateNode(canvas.id, node.id, { output: { assets: ['result.png'] }, runState: 'done' });
      throw new Error('projection failed');
    })).toThrow('projection failed');
    expect(store.jobs.get(job.id)?.status).toBe('running');
    expect(store.getNode(canvas.id, node.id)?.output).toBeNull();
  });

  it('rejects missing/type-mismatched nodes, non-JSON snapshots, and credentials without admitting a job', async () => {
    const { store, canvas, input } = await fixture();
    expect(() => store.jobs.enqueue({ ...input, nodeId: 'missing' })).toThrow('Canvas node not found');
    expect(() => store.jobs.enqueue({ ...input, nodeType: 'video' })).toThrow('node type');
    expect(() => store.jobs.enqueue({ ...input, input: { provider: { apiKey: 'never-persist' } } })).toThrow('credentials');
    expect(() => store.jobs.enqueue({ ...input, input: { params: { authorization: 'never-persist' } } })).toThrow('credentials');
    expect(() => store.jobs.enqueue({ ...input, input: { value: Number.NaN } })).toThrow('JSON');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => store.jobs.enqueue({ ...input, input: cyclic })).toThrow('cycles');
    expect(store.jobs.list(canvas.id)).toEqual([]);
  });
});
