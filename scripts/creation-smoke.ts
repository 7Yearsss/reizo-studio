import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Hono } from 'hono';
import { openDb } from '../src/main/server/db/client';
import { createSqliteSessionStore } from '../src/main/server/storage/sqliteSessionStore';
import { createCanvasStore } from '../src/main/server/storage/canvasStore';
import { createCanvasRouter } from '../src/main/server/routes/canvas';
import { startComposition, runMediaProcess } from '../src/main/server/canvas/composition';
import { nodeJobsFor } from '../src/main/server/canvas/nodeJobs';
import { loadSkills } from '../src/main/skills';
import { createDeliveryTools } from '../src/main/server/agent/deliveryTools';
import { createGenerationScheduler } from '../src/main/server/canvas/generationScheduler';
import { quotaFetch } from '../src/main/server/agent/provider/quotaFetch';
import type { SettingsStore } from '../src/main/server/storage/settingsStore';
import { createScheduleStore } from '../src/main/server/storage/scheduleStore';
import { requireScheduledCompletion } from '../src/main/schedulerHost';

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(tempRoot, 'reizo-creation-smoke-'));
  const dbFile = path.join(root, 'data.db');
  let handle = openDb(dbFile);
  try {
    const sessions = createSqliteSessionStore(handle);
    let store = createCanvasStore(handle);
    const session = await sessions.create('creation smoke', null, null);
    const canvasId = store.ensureCanvas(session.id).id;
    const app = new Hono().route('/canvas', createCanvasRouter(store, { get: async () => ({}) } as unknown as SettingsStore, sessions, root));
    const post = (edits: unknown[], uploads: unknown[], key: string) => app.request(`/canvas/${canvasId}/edits`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ edits, uploads }) });
    await runMediaProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'red.mp4')]);
    await runMediaProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=240x320:r=24:d=0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'blue.mp4')]);
    await runMediaProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(root, 'tone.wav')]);
    const names = ['red.mp4', 'blue.mp4', 'tone.wav'];
    const uploads = await Promise.all(names.map(async (name, i) => ({ nodeId: `source-${i}`, name,
      mimeType: i === 2 ? 'audio/wav' : 'video/mp4', dataBase64: (await readFile(path.join(root, name))).toString('base64') })));
    const edits = names.map((name, i) => ({ kind: 'add_node', id: `source-${i}`, node: { type: i === 2 ? 'audio' : 'video', title: name, x: i * 300, y: 0 } }));
    const accepted = await post(edits, uploads, 'import');
    assert.equal(accepted.status, 200);
    assert.equal((await post(edits, uploads, 'import')).status, 200);
    assert.equal(store.getNodes(canvasId).length, 3);
    assert.equal(store.assets.list(canvasId).length, 3);
    store.addEdge(canvasId, { sourceId: 'source-2', targetId: 'source-0', targetHandle: 'audio_in' });

    const before = store.getSnapshot(canvasId);
    const filesBefore = await readdir(path.join(root, 'canvas', canvasId));
    const failed = await post([...edits.map((edit, i) => ({ ...edit, id: `broken-${i}` })),
      { kind: 'add_edge', edge: { id: 'broken-edge', sourceId: 'broken-0', targetId: 'missing' } }],
    uploads.map((upload, i) => ({ ...upload, nodeId: `broken-${i}` })), 'failed-import');
    assert.equal(failed.status, 409);
    assert.deepEqual(store.getSnapshot(canvasId), before);
    assert.deepEqual(await readdir(path.join(root, 'canvas', canvasId)), filesBefore);

    const request = { nodeIds: ['source-0', 'source-1'], width: 640, height: 360, fps: 24, sourceVolume: 0, audioVolume: 0.8 };
    const render = startComposition(store, root, canvasId, request, 'render');
    assert.equal(startComposition(store, root, canvasId, request, 'render').job.id, render.job.id);
    store.updateNode(canvasId, render.job.nodeId, { params: { ...store.getNode(canvasId, render.job.nodeId).params, prompt: 'edited while rendering' } });
    await render.completion;
    const job = store.jobs.get(render.job.id);
    assert.equal(job.status, 'succeeded', job.error);
    const node = store.getNode(canvasId, job.nodeId);
    assert.equal((node.params as Record<string, unknown>).prompt, 'edited while rendering');
    const finalPath = path.join(root, 'canvas', node.output.assets[0]);
    const media = JSON.parse(await runMediaProcess('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', finalPath]));
    assert.equal(media.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').width, 640);
    assert.ok(Math.abs(Number(media.format.duration) - 1.4) < 0.15);
    const audio = spawnSync('ffmpeg', ['-v', 'error', '-i', finalPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 1024 * 1024 });
    assert.equal(audio.status, 0);
    const rms = (start: number, end: number) => {
      let square = 0; let count = 0;
      for (let i = Math.floor(start * 8000); i < end * 8000 && i * 4 + 4 <= audio.stdout.length; i++) { square += audio.stdout.readFloatLE(i * 4) ** 2; count++; }
      return Math.sqrt(square / count);
    };
    assert.ok(rms(0.1, 0.4) > 0.02, 'connected audio must be audible');
    assert.ok(rms(1.1, 1.3) < 0.002, 'the silent second shot must remain silent');
    const rerender = startComposition(store, root, canvasId, request, 'rerender', node.id);
    store.updateNode(canvasId, node.id, { params: { ...store.getNode(canvasId, node.id).params, prompt: 'edited during rerender' } });
    await rerender.completion;
    assert.equal(store.jobs.get(rerender.job.id).status, 'succeeded');
    const updated = store.getNode(canvasId, node.id);
    assert.equal((updated.params as Record<string, unknown>).prompt, 'edited during rerender');
    assert.equal(updated.output.assets.length, 2);
    assert.ok(updated.output.assets.includes(node.output.assets[0]), 'rerender must preserve the previous film');
    assert.equal(updated.output.activeAssetIndex, 0);
    assert.equal(updated.output.error, undefined);
    assert.equal(updated.output.progress, undefined);

    const selected = (await loadSkills([path.resolve('skills')])).find((skill) => skill.id === 'cover-image');
    assert.ok(selected.contract && !selected.contractError);
    const tools = createDeliveryTools({ skill: selected, canvasStore: store, sessionId: session.id, dataRoot: root });
    const context = { toolCallId: 'smoke', messages: [] as import('ai').ModelMessage[], context: {} as Record<string, unknown> };
    const plan = await tools.plan_delivery.execute({ planId: 'cover-plan', input: { objective: 'smoke cover', aspectRatio: '16:9', style: 'minimal' },
      deliverables: [{ role: 'final', title: 'cover', kind: 'image', count: 1, requiredAssetIds: [] }] }, context) as { id: string };
    assert.equal(plan.id, 'cover-plan');
    const missing = await tools.check_delivery.execute({ planId: plan.id, manifest: [] }, context) as { complete: boolean; issues: string[] };
    assert.equal(missing.complete, false); assert.ok(missing.issues.length);
    const firstAsset = store.assets.list(canvasId)[0];
    store.assets.updateMetadata(firstAsset.id, { name: 'persistent name', folder: 'smoke', tags: ['test'] });
    const page = store.assets.page({ limit: 1 });
    assert.ok(page.nextCursor);
    assert.notEqual(store.assets.page({ limit: 1, cursor: page.nextCursor }).assets[0].id, page.assets[0].id);
    nodeJobsFor(store).shutdown(); handle.close(); handle = openDb(dbFile); store = createCanvasStore(handle);
    assert.equal(store.deliveries.get(plan.id).complete, false);
    assert.equal(store.assets.get(firstAsset.id).name, 'persistent name');
    assert.equal(store.assets.page({ search: 'persistent name', folder: 'smoke', tag: 'test' }).assets.length, 1);

    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    let stream: ReadableStreamDefaultController<Uint8Array>;
    let called = 0;
    const transport = quotaFetch(scheduler, 'provider', async () => { called++; return new Response(new ReadableStream({ start(controller) { stream = controller; } })); });
    const response = await transport('https://fixture.invalid');
    const pending = transport('https://fixture.invalid');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(called, 1, 'streaming headers must not release the LLM permit');
    await response.body.cancel();
    await (await pending).body.cancel();
    assert.equal(called, 2); scheduler.shutdown();
    const reserved = createGenerationScheduler({ globalLimit: 3, providerLimit: 3, reservedInteractiveSlots: 1 });
    const releaseFirst = await reserved.acquire('p'); const releaseSecond = await reserved.acquire('p');
    let backgroundAdmitted = false;
    const background = reserved.acquire('p').then((release) => { backgroundAdmitted = true; return release; });
    const releaseInteractive = await reserved.acquire('p', undefined, true);
    assert.equal(backgroundAdmitted, false, 'background work must leave the interactive slot available');
    releaseFirst(); (await background)(); releaseSecond(); releaseInteractive(); reserved.shutdown();
    const schedules = createScheduleStore(root);
    await Promise.all(Array.from({ length: 20 }, (_, i) => schedules.create({ name: `fixture-${i}`, prompt: 'fixture', intervalMs: 60000, once: i === 0 })));
    const savedSchedules = await schedules.list();
    assert.equal(savedSchedules.length, 20, 'concurrent schedule creates must not overwrite each other');
    const once = savedSchedules.find((schedule) => schedule.once);
    await schedules.markRun(once.id, 'failed fixture');
    assert.equal((await schedules.list()).find((schedule) => schedule.id === once.id).enabled, false);
    await assert.rejects(requireScheduledCompletion(new Response('{"type":"done","outcome":"error","error":"failed fixture"}\n')), /failed fixture/);
    console.log(JSON.stringify({ pass: true, checks: ['atomic uploads and failure cleanup', 'idempotent composition with parameter edits and preserved versions', '640x360 MP4 with two shots and audible connected audio', 'missing-delivery rejection and database reopen', 'library pagination, durable labels and filters', 'LLM streaming quota with interactive reservation', 'concurrent schedule writes and authoritative failed outcomes'], durationSec: Number(media.format.duration) }, null, 2));
  } finally { handle.close(); if (path.dirname(path.resolve(root)) === tempRoot) await rm(root, { recursive: true, force: true }); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
