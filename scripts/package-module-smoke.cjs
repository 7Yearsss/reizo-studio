// Exercise the exact packaged main bundle in Node with Electron startup suppressed.
// This is a module compatibility check, not a claim that the packaged Electron UI was launched.
/* eslint-disable @typescript-eslint/no-var-requires -- This standalone CommonJS harness mirrors the packaged main module. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const acorn = require('acorn');

async function main() {
  const root = path.resolve(process.argv[2] || '');
  assert(path.dirname(root) === path.resolve(require('node:os').tmpdir()) && path.basename(root).startsWith('reizo-package-qa-'), 'Expected the disposable package output root');
  const packaged = fs.readdirSync(root).map((name) => path.join(root, name)).find((dir) => fs.existsSync(path.join(dir, 'resources', 'app.asar')));
  assert(packaged, 'Windows app.asar was not produced');
  const resources = path.join(packaged, 'resources'); const archive = path.join(resources, 'app.asar');
  const inventory = asar.listPackage(archive).map((name) => name.replace(/\\/g, '/'));
  assert(!inventory.some((name) => /presentation-export-qa|package-compatibility|package-qa-path/.test(name)), 'Private QA files leaked into app.asar');
  const buildChunks = inventory.filter((name) => /^\/\.vite\/build\/index-[^/]+\.js$/.test(name));
  const archivePath = (name) => path.normalize(name.replace(/^\//, ''));
  const selected = buildChunks.find((name) => asar.extractFile(archive, archivePath(name)).toString().includes('pptxgenjs-4.0.1'));
  assert(selected, 'Packaged main chunk does not contain the native exporter');
  const bytes = asar.extractFile(archive, archivePath(selected)); const source = bytes.toString('utf8');
  const bundleSha256 = createHash('sha256').update(bytes).digest('hex');
  const moduleRoot = path.join(root, 'module-fixture'); asar.extractAll(archive, moduleRoot);
  const bundleFile = path.join(moduleRoot, selected.replace(/^\//, ''));
  assert.equal(createHash('sha256').update(fs.readFileSync(bundleFile)).digest('hex'), bundleSha256);
  // Minified identifiers are discovered from unique stable source literals. Original package bytes are never changed.
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const functions = ast.body.filter((node) => node.type === 'FunctionDeclaration' && node.id);
  const strings = (node, values = []) => {
    if (!node || typeof node !== 'object') return values;
    if (node.type === 'Literal' && typeof node.value === 'string') values.push(node.value);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach((entry) => strings(entry, values)); else if (value && typeof value === 'object') strings(value, values);
    return values;
  };
  const identify = (label, marker, maximumLength = Infinity) => {
    const matches = functions.filter((node) => node.end - node.start < maximumLength && strings(node.body).some((value) => value.includes(marker)));
    assert.equal(matches.length, 1, `Expected one packaged ${label} binding (${marker})`); return matches[0].id.name;
  };
  const bindings = {
    openDb: identify('database', 'PRAGMA journal_mode = WAL'),
    createSqliteSessionStore: identify('sessions', 'SELECT * FROM sessions WHERE id = ?'),
    createCanvasStore: identify('canvas repository', 'SELECT * FROM canvases WHERE id = ?'),
    createArtifactStore: identify('artifacts', 'Prepared publication requires a native binary artifact'),
    startPresentationExport: identify('native export', '操作 ID 已用于不同的演示稿导出'),
    stageCanvasAssets: identify('asset staging', 'Canvas asset requires non-empty bytes and a valid MIME type'),
    verifyImagePresentation: identify('native verifier', 'PPTX 画幅不是 16:9'),
    loadSkills: identify('skill loader', '/data/skills'),
    stopCanvasWork: identify('work fence', 'shutdown', 90),
    createArtifactsRouter: identify('download router', 'Blob missing'),
  };
  const noOperation = () => undefined;
  const userData = path.join(root, 'fixture-user-data'); await fsp.mkdir(userData, { recursive: true });
  const electron = {
    app: { isPackaged: true, setAppUserModelId: noOperation, requestSingleInstanceLock: () => false, quit: noOperation, on: noOperation,
      commandLine: { appendSwitch: noOperation }, disableHardwareAcceleration: noOperation, getAppPath: () => moduleRoot, getPath: () => userData },
    BrowserWindow: { getAllWindows: () => [] }, globalShortcut: { register: noOperation, unregisterAll: noOperation }, ipcMain: { on: noOperation, handle: noOperation },
    safeStorage: { isEncryptionAvailable: () => false },
  };
  const originalLoad = Module._load;
  delete process.env.REIZO_DEV_NO_SANDBOX;
  Module._load = function (request, parent, isMain) { if (request === 'electron' || request.startsWith('electron/')) return electron; return originalLoad.call(this, request, parent, isMain); };
  let qa;
  try {
    const compiled = new Module(bundleFile, module); compiled.filename = bundleFile; compiled.paths = Module._nodeModulePaths(path.dirname(bundleFile));
    compiled._compile(source + '\nmodule.exports.__qa = {' + Object.entries(bindings).map(([key, value]) => `${key}:${value}`).join(',') + '};', bundleFile);
    qa = compiled.exports.__qa;
  } finally { Module._load = originalLoad; }
  const skills = await qa.loadSkills([path.join(resources, 'skills')]);
  const contracted = ['deck-maker', 'cover-image', 'brand-kit', 'ecommerce-listing'];
  for (const id of contracted) {
    const skill = skills.find((entry) => entry.id === id); assert(skill?.contract && !skill.contractError, `Missing packaged contract: ${id}`);
    for (const filename of ['SKILL.md', 'contract.json']) {
      const actual = fs.readFileSync(path.join(resources, 'skills', id, filename)); const expected = fs.readFileSync(path.resolve('skills', id, filename));
      assert(actual.equals(expected), `Packaged skill does not match final source: ${id}/${filename}`);
    }
  }
  assert.deepEqual(skills.find((entry) => entry.id === 'deck-maker').contract.requiredExports, [{ format: 'pptx', count: 1 }]);
  const handle = qa.openDb(path.join(userData, 'fixture.db')); const store = qa.createCanvasStore(handle);
  const session = await qa.createSqliteSessionStore(handle).create('packaged module fixture', null, null); const canvasId = store.ensureCanvas(session.id).id;
  const artifacts = qa.createArtifactStore(handle, userData);
  const oldPath = process.env.PATH; const oldFfmpeg = process.env.REIZO_FFMPEG_PATH; const oldResources = process.resourcesPath;
  const report = { root, packaged, bundleSha256, nodeVersion: process.version, electronStarted: false, privateDataRoot: userData, contractedSkills: contracted };
  try {
    const migrations = handle.raw.prepare('SELECT name FROM __migrations').all().map((row) => row.name);
    assert(migrations.includes('0011_usage_ledger') && migrations.some((name) => name.includes('delivery_exports')), 'Packaged migrations are missing'); report.migrations = migrations;
    process.env.PATH = path.join(root, 'empty-bin'); delete process.env.REIZO_FFMPEG_PATH; process.resourcesPath = resources;
    const inputs = [
      { name: 'page.png', mimeType: 'image/png', bytes: fs.readFileSync(path.resolve('resources/icon.png')) },
      // Small JPEG fixture derived from resources/icon.png; no runtime codec or host PATH dependency.
      { name: 'page.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('/9j//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABeAAADAQAAAAAAAAAAAAAAAAADBAUHAQEAAAAAAAAAAAAAAAAAAAABEAACAwEAAgEFAQAAAAAAAAADBAIFAQYREhMyQRQVYQcRAQEBAQAAAAAAAAAAAAAAAAABEVH/wAARCAAQABADARIAAhIAAxIA/9oADAMBAAIRAxEAPwDPuW4ylpFJmdvqqPUnqYWddWN1p3UKwJIxNA1ixuSWGwRbxOEJhMJfJ5M259gcb1q7Vd0AZxql+hapk6pJ2wJg121BE9GlpkLvxBYMrghe8pQiUY5D3c998u3oO3oVux4dLqKSoaDY84Hsx0dla2NbUhiFa5r0paUbY9UhBQT/AOHExJjiOEWhC+SG+fqR6H/QKakXj+soqgPTsUk6d60QsTN11cuYUliwQX8aGLRldkMhMOYYIz2Av47eg7eh/9k=', 'base64') },
    ];
    const pages = [];
    for (const input of inputs) {
      const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
      const staged = await qa.stageCanvasAssets(userData, canvasId, [{ ...input, kind: 'image' }]); staged.prepareCommit();
      const asset = store.assets.register({ ...staged.files[0], canvasId, nodeId: node.id, source: 'imported' }); staged.keep();
      store.updateNode(canvasId, node.id, { output: { assets: [asset.path] } }); pages.push({ nodeId: node.id, assetId: asset.id, expectedPath: asset.path });
    }
    const request = { title: '封装验证/报价\r\n.pptx', pages };
    const accepted = qa.startPresentationExport({ store, artifactStore: artifacts, dataRoot: userData, canvasId, operationId: 'packaged-no-path', request });
    await accepted.completion; const job = store.jobs.get(accepted.job.id); assert.equal(job.status, 'succeeded', job.error);
    qa.verifyImagePresentation(await artifacts.readBlob(job.result.artifactId, job.result.artifactVersion), 2);
    const response = await qa.createArtifactsRouter(artifacts).request(`/${job.result.artifactId}/raw?v=${job.result.artifactVersion}`);
    assert.equal(response.status, 200); const disposition = response.headers.get('content-disposition');
    assert(disposition?.includes('filename*=UTF-8') && !/[\r\n]/.test(disposition)); report.downloadDisposition = disposition;
    report.pngJpegWithoutPath = { jobId: job.id, providerId: job.providerId, model: job.model, result: job.result };
    assert(!fs.existsSync(path.join(resources, 'ffmpeg.exe')), 'FFmpeg unexpectedly shipped');
    report.ffmpegBundled = false;
    const webpNode = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
    const staged = await qa.stageCanvasAssets(userData, canvasId, [{ name: 'missing-ffmpeg.webp', mimeType: 'image/webp', bytes: webp, kind: 'image' }]); staged.prepareCommit();
    const asset = store.assets.register({ ...staged.files[0], canvasId, nodeId: webpNode.id, source: 'imported' }); staged.keep();
    store.updateNode(canvasId, webpNode.id, { output: { assets: [asset.path] } });
    const unsupported = qa.startPresentationExport({ store, artifactStore: artifacts, dataRoot: userData, canvasId,
      operationId: 'missing-ffmpeg', request: { pages: [{ nodeId: webpNode.id, assetId: asset.id }] } });
    await unsupported.completion; const failed = store.jobs.get(unsupported.job.id);
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /未找到 ffmpeg/); report.webpWithoutFfmpeg = { status: failed.status, error: failed.error };
    await fsp.writeFile(path.join(root, 'module-smoke-receipt.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    qa.stopCanvasWork(store); handle.close(); process.env.PATH = oldPath;
    if (oldFfmpeg === undefined) delete process.env.REIZO_FFMPEG_PATH; else process.env.REIZO_FFMPEG_PATH = oldFfmpeg;
    if (oldResources === undefined) delete process.resourcesPath; else process.resourcesPath = oldResources;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
