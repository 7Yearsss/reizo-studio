import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { createArtifactStore } from '../storage/artifactStore';
import { stageCanvasAssets } from './assets';
import { startPresentationExport, PPTX_MIME } from './presentationExport';
import { verifyImagePresentation } from './presentationValidation';
import { createDeliveryTools } from '../agent/deliveryTools';
import { loadSkills } from '../../skills';
import { createCanvasTools } from '../agent/canvasTools';
import { createCanvasBudget } from '../agent/canvasBudget';
import type { SettingsStore } from '../storage/settingsStore';
import { stopCanvasWork } from './workLifecycle';
import { createCanvasMaintenance } from '../storage/canvasMaintenance';
import { nodeJobsFor } from './nodeJobs';
import { createCanvasApplication } from './application';
import { createArtifactsRouter } from '../routes/artifacts';
import { canvasFixtureImage } from '../../../../scripts/canvas-fixture-image';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
it('checks real image geometry before delivery completion and keeps contracts without dimensions compatible', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-delivery-geometry-fixture-')); const handle = openDb(':memory:');
  const session = await createSqliteSessionStore(handle).create('geometry', null, null); const store = createCanvasStore(handle); const canvasId = store.ensureCanvas(session.id).id;
  try {
    const staged = await stageCanvasAssets(root, canvasId, [PNG, canvasFixtureImage(16, 9, 0), canvasFixtureImage(32, 18, 1)].map((bytes, index) => ({ name: `${index}.png`, bytes, kind: 'image', mimeType: 'image/png' })));
    staged.prepareCommit(); const assets = staged.files.map((file) => store.assets.register({ ...file, canvasId, source: 'imported' })); staged.keep();
    const skill = (await loadSkills([path.resolve('skills')])).find((item) => item.id === 'cover-image');
    const tools = createDeliveryTools({ skill, canvasStore: store, sessionId: session.id, dataRoot: root });
    const context = { toolCallId: 'geometry', messages: [] as import('ai').ModelMessage[], context: {} as Record<string, unknown> };
    const input = { objective: 'fixture', aspectRatio: '16:9', style: 'fixture' };
    const deliverable = { role: 'final', title: 'cover', kind: 'image' as const, count: 1, requiredAssetIds: [] as string[] };
    const plan = await tools.plan_delivery.execute({ input, deliverables: [deliverable] }, context) as { id: string };
    expect(store.deliveries.get(plan.id).plan.deliverables[0].geometry).toEqual({ aspectRatio: '16:9' });
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest: [{ role: 'final', assetId: assets[0].id }] }, context)).toMatchObject({ complete: false, issues: expect.arrayContaining([expect.stringContaining('画幅要求 16:9')]) });
    expect(store.deliveries.get(plan.id).complete).toBe(false);
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest: [{ role: 'final', assetId: assets[1].id }] }, context)).toMatchObject({ complete: true });
    const sized = await tools.plan_delivery.execute({ input, deliverables: [{ ...deliverable, geometry: { width: 16, height: 9, minWidth: 16, minHeight: 9 } }] }, context) as { id: string };
    expect(await tools.check_delivery.execute({ planId: sized.id, manifest: [{ role: 'final', assetId: assets[2].id }] }, context)).toMatchObject({ complete: false, issues: expect.arrayContaining([expect.stringContaining('宽度要求 16px')]) });
    expect(await tools.check_delivery.execute({ planId: sized.id, manifest: [{ role: 'final', assetId: assets[1].id }] }, context)).toMatchObject({ complete: true });
    expect(await tools.plan_delivery.execute({ input, deliverables: [{ ...deliverable, geometry: { aspectRatio: '1:1' } }] }, context)).toMatchObject({ error: expect.stringContaining('与用户选择') });
    const legacyFields = { ...skill.contract.fields }; delete legacyFields.aspectRatio;
    const legacySkill = { ...skill, contract: { ...skill.contract, fields: legacyFields } };
    const legacyTools = createDeliveryTools({ skill: legacySkill, canvasStore: store, sessionId: session.id, dataRoot: root });
    const legacy = await legacyTools.plan_delivery.execute({ input: { objective: 'fixture', style: 'fixture' }, deliverables: [deliverable] }, context) as { id: string };
    expect(await legacyTools.check_delivery.execute({ planId: legacy.id, manifest: [{ role: 'final', assetId: assets[0].id }] }, context)).toMatchObject({ complete: true });
  } finally { stopCanvasWork(store); handle.close(); if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('reizo-delivery-geometry-fixture-')) await rm(root, { recursive: true, force: true }); }
});

it('publishes a real ordered image PPTX with fixed versions, atomic artifact/job/plan ownership and local reruns', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-pptx-fixture-'));
  const handle = openDb(':memory:'); const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('pptx fixture', null, null); const store = createCanvasStore(handle); const canvasId = store.ensureCanvas(session.id).id;
  const artifacts = createArtifactStore(handle, root);
  try {
    const first = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    const second = store.addNode(canvasId, { type: 'image', x: 200, y: 0, w: 100, h: 100 }).node;
    const staged = await stageCanvasAssets(root, canvasId, [0, 1, 2].map((index) => ({ name: `${index}.png`, bytes: PNG, kind: 'image', mimeType: 'image/png' })));
    staged.prepareCommit();
    const assets = staged.files.map((file, index) => store.assets.register({ ...file, canvasId, nodeId: index < 2 ? first.id : second.id, source: 'imported' })); staged.keep();
    store.updateNode(canvasId, first.id, { runState: 'done', output: { assets: [assets[0].path, assets[1].path], activeAssetIndex: 1 } });
    store.updateNode(canvasId, second.id, { runState: 'done', output: { assets: [assets[2].path] } });
    const skill = (await loadSkills([path.resolve('skills')])).find((skill) => skill.id === 'deck-maker');
    const tools = createDeliveryTools({ skill, canvasStore: store, sessionId: session.id, dataRoot: root, artifactStore: artifacts });
    const context = { toolCallId: 'fixture', messages: [] as import('ai').ModelMessage[], context: {} as Record<string, unknown> };
    const plan = await tools.plan_delivery.execute({ planId: 'deck-fixture', input: { objective: 'fixture', audience: 'fixture', pages: 2, style: 'fixture' },
      deliverables: [{ role: 'slide', title: 'slides', kind: 'image', count: 2, requiredAssetIds: [] }] }, context) as { id: string };
    const manifest = [{ role: 'slide', assetId: assets[2].id }, { role: 'slide', assetId: assets[1].id }];
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest }, context)).toMatchObject({ complete: false });
    const request = { pages: [{ nodeId: second.id, expectedPath: assets[2].path }, { nodeId: first.id, expectedPath: assets[1].path }], planId: plan.id, title: 'Fixture.pptx' };
    expect(() => startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request: { ...request, pages: [{ nodeId: second.id, expectedPath: 'stale-selection.png' }, request.pages[1]] }, operationId: 'stale-preview' })).toThrow('重新确认');
    const accepted = startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request, operationId: 'fixed-export' });
    store.updateNode(canvasId, first.id, { output: { ...store.getNode(canvasId, first.id).output, activeAssetIndex: 0 } });
    expect(startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request, operationId: 'fixed-export' }).job.id).toBe(accepted.job.id);
    await accepted.completion;
    const job = store.jobs.get(accepted.job.id); expect(job.status).toBe('succeeded');
    const result = job.result as { artifactId: string; artifactVersion: number; downloadUrl: string };
    expect(result.downloadUrl).toContain('?v=1');
    const download = await createArtifactsRouter(artifacts).request(`/${result.artifactId}/raw?v=1`);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="Fixture.pptx"; filename*=UTF-8\'\'Fixture.pptx');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(await artifacts.readBlob(result.artifactId, 1));
    verifyImagePresentation(await artifacts.readBlob(result.artifactId, result.artifactVersion), 2);
    expect(store.deliveryExports.list(plan.id)[0].sourceAssetIds).toEqual(manifest.map((item) => item.assetId));
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest }, context)).toMatchObject({ complete: true });
    const localOnlySettings = { get: vi.fn(async () => { throw new Error('local export must not resolve a paid provider'); }) } as unknown as SettingsStore;
    store.updateNode(canvasId, job.nodeId, { paramsHash: null });
    const budget = createCanvasBudget({ execute: 0 });
    const canvasTools = createCanvasTools({ canvasStore: store, settingsStore: localOnlySettings, artifactStore: artifacts, dataRoot: root, sessionId: session.id, budget });
    expect(await canvasTools.tools.run_graph.execute({ nodeIds: [job.nodeId] }, context)).toMatchObject({ ok: true, results: [{ id: job.nodeId, status: 'done' }] });
    expect(budget.counts().execute).toBe(0);
    expect(localOnlySettings.get).not.toHaveBeenCalled(); expect(artifacts.getMeta(result.artifactId).version).toBe(2);
    verifyImagePresentation(await artifacts.readBlob(result.artifactId, 1), 2);
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest }, context)).toMatchObject({ complete: true });
    await writeFile(path.join(root, 'canvas', canvasId, 'orphan.png'), PNG);
    const maintenance = createCanvasMaintenance(handle, root, () => Date.now() + 2 * 24 * 60 * 60_000);
    const scan = maintenance.scan(); expect(scan.referencesComplete).toBe(true);
    expect(scan.files.filter((file) => file.status === 'candidate').map((file) => file.path)).toEqual([`${canvasId}/orphan.png`]);
    const originalBlob = await artifacts.readBlob(result.artifactId, 1);
    await writeFile(artifacts.blobFilePath(result.artifactId, 1), Buffer.from('corrupted native export'));
    expect(maintenance.scan().referencesComplete).toBe(false);
    await writeFile(artifacts.blobFilePath(result.artifactId, 1), originalBlob);
    const nativeMeta = artifacts.getMeta(result.artifactId);
    const heldPublication = await artifacts.preparePublish({ artifactId: result.artifactId, sessionId: session.id, kind: 'binary', name: 'fixture.pptx',
      source: 'manual', mimeType: PPTX_MIME, bytes: originalBlob, origin: nativeMeta.origin });
    let deleted = false;
    const deletion = artifacts.remove(result.artifactId).then(() => { deleted = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(deleted).toBe(false); expect(artifacts.getMeta(result.artifactId)).not.toBeNull();
    await heldPublication.discard(); await deletion;
    expect(store.deliveries.get(plan.id).complete).toBe(false);
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest }, context)).toMatchObject({ complete: false });
    const rerun = startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request, operationId: 'rerun-after-delete', targetNodeId: job.nodeId,
      fixedSources: store.jobs.get(job.id).input.sources as import('../../../shared/canvasPresentation').PresentationSource[] });
    await rerun.completion; expect(store.jobs.get(rerun.job.id).status).toBe('succeeded');
    verifyImagePresentation(await artifacts.readBlob(result.artifactId, 1), 2);
  } finally { stopCanvasWork(store); handle.close(); if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir())) await rm(root, { recursive: true, force: true }); }
}, 20_000);

it('requires explicit canvas reuse for foreign versions and fences delivery validation after host shutdown', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-pptx-scope-fixture-')); const handle = openDb(':memory:'); let closed = false;
  const sessions = createSqliteSessionStore(handle); const first = await sessions.create('owner', null, null); const second = await sessions.create('foreign', null, null);
  const store = createCanvasStore(handle); const canvasId = store.ensureCanvas(first.id).id; const foreignId = store.ensureCanvas(second.id).id;
  const artifacts = createArtifactStore(handle, root);
  try {
    const staged = await stageCanvasAssets(root, foreignId, [{ name: 'foreign.png', bytes: PNG, kind: 'image', mimeType: 'image/png' }]); staged.prepareCommit();
    const asset = store.assets.register({ ...staged.files[0], canvasId: foreignId, source: 'imported' }); staged.keep();
    const request = { pages: [{ assetId: asset.id }] };
    expect(() => startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request, operationId: 'foreign-direct' })).toThrow('当前画布');
    expect(() => startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request, operationId: 'foreign-fixed',
      fixedSources: [{ assetId: asset.id, path: asset.path, contentHash: asset.contentHash, title: 'foreign' }] })).toThrow('当前画布');
    const skill = (await loadSkills([path.resolve('skills')])).find((skill) => skill.id === 'deck-maker');
    const tools = createDeliveryTools({ skill, canvasStore: store, sessionId: first.id, dataRoot: root, artifactStore: artifacts });
    const context = { toolCallId: 'scope', messages: [] as import('ai').ModelMessage[], context: {} as Record<string, unknown> };
    const plan = await tools.plan_delivery.execute({ planId: 'scope-plan', input: { objective: 'fixture', audience: 'fixture', pages: 1, style: 'fixture' },
      deliverables: [{ role: 'slide', title: 'slide', kind: 'image', count: 1, requiredAssetIds: [] }] }, context) as { id: string };
    const manifest = [{ role: 'slide', assetId: asset.id }];
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest }, context)).toMatchObject({ complete: false, issues: expect.arrayContaining([expect.stringContaining('当前画布')]) });
    createCanvasApplication(store).reuseAsset(canvasId, { assetId: asset.id });
    const accepted = startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request: { ...request, planId: plan.id }, operationId: 'explicit-reuse' });
    await accepted.completion; expect(store.jobs.get(accepted.job.id).status).toBe('succeeded');
    expect(await tools.check_delivery.execute({ planId: plan.id, manifest }, context)).toMatchObject({ complete: true });
    const read = artifacts.readBlob.bind(artifacts);
    vi.spyOn(artifacts, 'readBlob').mockImplementation(async (id, version) => { const bytes = await read(id, version); stopCanvasWork(store); handle.close(); closed = true; return bytes; });
    await expect(tools.check_delivery.execute({ planId: plan.id, manifest }, context)).resolves.toMatchObject({ error: expect.stringContaining('已中断') });
    expect(() => startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request, operationId: 'late-body' })).toThrow('shutting down');
  } finally { stopCanvasWork(store); if (!closed) handle.close(); if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir())) await rm(root, { recursive: true, force: true }); }
}, 20_000);

it('discards cancelled staged blobs and keeps committed blobs after a commit observer stops the runtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-pptx-stop-fixture-')); const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle); const session = await sessions.create('fixture', null, null);
  const store = createCanvasStore(handle); const canvasId = store.ensureCanvas(session.id).id; const artifacts = createArtifactStore(handle, root);
  try {
    const source = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    const staged = await stageCanvasAssets(root, canvasId, [{ name: 'source.png', bytes: PNG, kind: 'image', mimeType: 'image/png' }]); staged.prepareCommit();
    const asset = store.assets.register({ ...staged.files[0], canvasId, nodeId: source.id, source: 'imported' }); staged.keep();
    store.updateNode(canvasId, source.id, { output: { assets: [asset.path] } });
    const publish = artifacts.preparePublish.bind(artifacts);
    let cancelledLease: Awaited<ReturnType<typeof publish>>;
    const spy = vi.spyOn(artifacts, 'preparePublish').mockImplementation(async (input, signal) => {
      cancelledLease = await publish(input, signal);
      nodeJobsFor(store).cancelNode(canvasId, input.origin.canvasNodeId);
      return cancelledLease;
    });
    const cancelled = startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request: { pages: [{ nodeId: source.id }] }, operationId: 'cancel-before-commit' });
    await cancelled.completion; await cancelledLease.discard(); spy.mockRestore();
    expect(store.jobs.get(cancelled.job.id).status).toBe('cancelled'); expect(await artifacts.listAll()).toEqual([]);
    const blobDirs = await readdir(path.join(root, 'artifacts', 'blobs'));
    for (const directory of blobDirs) expect(await readdir(path.join(root, 'artifacts', 'blobs', directory))).toEqual([]);
    const unsubscribe = store.subscribeCommits((commit) => { if (commit.changes.some((change) => change.type === 'node_updated' && change.node.output?.artifactId)) stopCanvasWork(store); });
    const accepted = startPresentationExport({ store, artifactStore: artifacts, dataRoot: root, canvasId, request: { pages: [{ nodeId: source.id }] }, operationId: 'stop-after-commit' });
    await accepted.completion; unsubscribe();
    const result = store.jobs.get(accepted.job.id).result as { artifactId: string; artifactVersion: number };
    expect(result.artifactId).toBeTruthy(); const file = artifacts.blobFilePath(result.artifactId, result.artifactVersion);
    verifyImagePresentation(await readFile(file), 1);
  } finally { stopCanvasWork(store); handle.close(); if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir())) await rm(root, { recursive: true, force: true }); }
}, 20_000);
