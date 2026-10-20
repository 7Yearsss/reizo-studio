import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchRendererRuntime } from '../integrations/openchatcut/patch-renderer-runtime.mjs';
import { patchDraftRefinement } from '../integrations/openchatcut/patch-draft-refinement.mjs';
import { patchDraftApproval } from '../integrations/openchatcut/patch-draft-approval.mjs';
import { patchSpeech } from '../integrations/openchatcut/patch-speech.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const revision = '2e6f4a29b784200cfb32b859b16f2561592bc3e8'; // v0.2.16
const configPath = path.join(root, '.cache/openchatcut-runtime.json');
const previous = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const sourceArg = process.argv.indexOf('--source');
const source = path.resolve(sourceArg >= 0 ? process.argv[sourceArg + 1] : previous.source || path.join(root, '.cache/openchatcut'));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('OpenChatCut requires Node.js 24 or newer');
function run(exe, args, cwd = source) {
  const result = spawnSync(exe, args, { cwd, stdio: 'inherit', env: exe === 'npm' ? { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } : process.env, shell: process.platform === 'win32' && exe === 'npm', windowsHide: true });
  if (result.status !== 0) throw new Error(`${exe} failed (${result.status})`);
}
function copyDirectory(from, to, excluded) {
  if (process.platform !== 'win32') {
    cpSync(from, to, { recursive: true, filter: (file) => !excluded || file !== excluded && !file.startsWith(excluded + path.sep) });
    return;
  }
  // Parallel file copying avoids minutes of serial small-file writes on Windows.
  const args = [from, to, '/E', '/XJ', '/MT:16', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...(excluded ? ['/XD', excluded] : [])];
  const result = spawnSync('robocopy', args, { stdio: 'inherit', windowsHide: true });
  if (result.status === null || result.status >= 8) throw new Error(`Runtime copy failed (${result.status})`);
}
mkdirSync(path.join(root, '.cache'), { recursive: true });
if (!existsSync(path.join(source, '.git'))) {
  run('git', ['clone', '--depth', '1', '--branch', 'v0.2.16', 'https://github.com/0xsline/OpenChatCut.git', source], root);
}
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true }).stdout.trim();
if (head !== revision) throw new Error(`Expected OpenChatCut ${revision}; found ${head}. Refusing to patch another version.`);
// Overlay only the reviewed integration files; never reset the checkout.
for (const [from, to] of [['App.tsx', 'src/App.tsx'], ['EditorWorkspaceView.tsx', 'src/editor/EditorWorkspaceView.tsx'], ['reizoMediaBridge.ts', 'src/editor/reizoMediaBridge.ts'], ['ReizoPoolActions.tsx', 'src/editor/ReizoPoolActions.tsx'], ['server.mjs', 'reizo-server.mjs']]) {
  copyFileSync(path.join(root, 'integrations/openchatcut', from), path.join(source, to));
}
const compositionFile = path.join(source, 'src/editor/TimelineComposition.tsx');
let compositionCode = readFileSync(compositionFile, 'utf8');
const oldBackground = 'background: transparent ? undefined : GRID';
const exportBackground = "background: transparent ? undefined : environment.isRendering || browserRenderer ? '#000000' : GRID";
if (compositionCode.includes(oldBackground)) {
  compositionCode = compositionCode.replace(oldBackground, exportBackground);
  writeFileSync(compositionFile, compositionCode);
} else if (!compositionCode.includes(exportBackground)) throw new Error('Unexpected upstream composition background');
const library = path.join(source, 'src/library/LibraryPanel.tsx');
const queueFile = path.join(source, 'server/derivative-queue.ts');
let queueCode = readFileSync(queueFile, 'utf8').replace(/\r\n/g, '\n');
if (!queueCode.includes('Reizo serializes replacement work')) {
  const markers = [
    '    if (running) {',
    '  private active = 0;',
    '    void Promise.resolve()\n      .then(() => job.work(job.controller.signal))',
    "        job.state = 'done';",
  ];
  if (markers.some(marker => !queueCode.includes(marker))) throw new Error('Unexpected upstream derivative queue');
  queueCode = queueCode.replace(markers[0], '    if (running && !running.controller.signal.aborted) {')
    .replace(markers[1], markers[1] + '\n  private readonly inFlight = new Map<string, Promise<unknown>>();')
    .replace(markers[2], `    // Reizo serializes replacement work until cancelled work releases its cache.
    // Track running work separately: cancelling a queued replacement must not lose this barrier.
    const previous = this.inFlight.get(job.key);
    this.inFlight.set(job.key, job.promise);
    void Promise.resolve()
      .then(async () => {
        await previous?.catch(() => undefined);
        job.controller.signal.throwIfAborted();
        return job.work(job.controller.signal);
      })`)
    .replace(markers[3], markers[3] + '\n        if (this.inFlight.get(job.key) === job.promise) this.inFlight.delete(job.key);');
  writeFileSync(queueFile, queueCode);
}
// Preview-only derivatives: keep original media in the document and export recipe.
const qualityFile = path.join(source, 'src/media/qualityPolicy.ts');
let qualityCode = readFileSync(qualityFile, 'utf8');
if (!qualityCode.includes('Reizo defaults to automatic preview')) {
  const marker = "  // Keep existing projects on their original media unless the user opts in.\n  return 'original';";
  qualityCode = qualityCode.replace(/\r\n/g, '\n');
  if (!qualityCode.includes(marker)) throw new Error('Unexpected upstream preview-source default');
  qualityCode = qualityCode.replace(marker, "  // Reizo defaults to automatic preview; explicit saved choices remain authoritative.\n  return typeof window !== 'undefined' && window.parent !== window ? 'auto' : 'original';");
  writeFileSync(qualityFile, qualityCode);
}
const proxyFile = path.join(source, 'server/preview-proxy.ts');
let proxyCode = readFileSync(proxyFile, 'utf8').replace(/\r\n/g, '\n');
if (!proxyCode.includes('reizo-540p-v1')) {
  const scale = `scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const url = 'const previewSrc = `/api/preview-proxy-file?src=${encodeURIComponent(src)}`;';
  if (!proxyCode.includes(scale) || !proxyCode.includes(url)) throw new Error('Unexpected upstream preview proxy');
  proxyCode = proxyCode.replace("if (probe.width > 1920 || probe.height > 1080)", "if (probe.durationMs >= 60_000) return 'long-video';\n  if (probe.width > 960 || probe.height > 540)")
    .replace(scale, `scale='min(960,iw)':'min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`)
    .replace("'-crf', '23'", "'-crf', '25'")
    .replace("'-b:a', '160k'", "'-b:a', '96k'")
    .replace(url, 'const previewSrc = `/api/preview-proxy-file?src=${encodeURIComponent(src)}&v=reizo-540p-v1-${hit.source.size}-${Math.floor(hit.source.mtimeMs * 1000)}`;');
  writeFileSync(proxyFile, proxyCode);
}
if (!proxyCode.includes('preview proxy version expired')) {
  const at = proxyCode.indexOf('export async function handlePreviewProxyFile(');
  const marker = '    if (!hit) return;';
  if (at < 0 || !proxyCode.slice(at).includes(marker)) throw new Error('Unexpected upstream proxy file route');
  proxyCode = proxyCode.slice(0, at) + proxyCode.slice(at).replace(marker, marker + "\n    const requestedVersion = new URL(req.url ?? '/', 'http://localhost').searchParams.get('v');\n    const version = `reizo-540p-v1-${hit.source.size}-${Math.floor(hit.source.mtimeMs * 1000)}`;\n    if (requestedVersion !== version) {\n      deps.sendJson(res, 404, { error: 'preview proxy version expired' });\n      return;\n    }");
  writeFileSync(proxyFile, proxyCode);
}
const previewFile = path.join(source, 'server/plugins/media-preview.ts');
const uploadFile = path.join(source, 'src/media/upload.ts');
let uploadCode = readFileSync(uploadFile, 'utf8');
if (!uploadCode.includes('Reizo keeps uploaded masters immutable')) {
  const marker = '  if (!shouldNormalizeImportedVideo(kind, uploaded.desktopImport)) {';
  if (!uploadCode.includes(marker)) throw new Error('Unexpected upstream import normalization');
  uploadCode = uploadCode.replace(marker, "  // Reizo keeps uploaded masters immutable; previewMedia supplies compatibility proxies.\n  if (!shouldNormalizeImportedVideo(kind, uploaded.desktopImport) || (typeof window !== 'undefined' && window.parent !== window)) {");
  writeFileSync(uploadFile, uploadCode);
}
// A hardware encoder fallback must also drop its hardware decoder. Reusing CUDA/
// QSV frames with libx264 and CPU filters makes the supposed fallback fail again.
const normalizeFile = path.join(source, 'server/media-normalization.ts');
let normalizeCode = readFileSync(normalizeFile, 'utf8').replace(/\r\n/g, '\n');
if (!normalizeCode.includes('Reizo chooses decoding for each encoder attempt')) {
  const attempt = "  for (const encoder of h264EncoderAttempts(preferred)) {\n    const args = [\n      ...commonArgs, '-vf', filters.join(','),";
  const common = "    ...(await resolveHwDecodeArgs(ffmpeg, preferred)),\n";
  const preferred = "  // Resolve the encoder before building decode args: NVIDIA NVENC requires\n  // `-hwaccel cuda`, not the platform-default d3d11va, or encode fails with\n  // \"CreateInputBuffer failed\" once the 64x64 probe bug is fixed.\n  const preferred = await resolveH264Encoder(ffmpeg);\n";
  if (!normalizeCode.includes(attempt) || !normalizeCode.includes(common) || !normalizeCode.includes(preferred)) throw new Error('Unexpected upstream normalization decoder routing');
  normalizeCode = normalizeCode.replace(attempt, "  for (const encoder of h264EncoderAttempts(preferred)) {\n    // Reizo chooses decoding for each encoder attempt, including software fallback.\n    const inputIndex = commonArgs.indexOf('-i');\n    const decodeArgs = await resolveHwDecodeArgs(ffmpeg, encoder);\n    throwIfNormalizationAborted(signal);\n    const args = [\n      ...commonArgs.slice(0, inputIndex), ...decodeArgs, ...commonArgs.slice(inputIndex), '-vf', filters.join(','),")
    .replace(common, '').replace(preferred, '');
  writeFileSync(normalizeFile, normalizeCode);
}
let previewCode = readFileSync(previewFile, 'utf8');
if (!previewCode.includes("'reizo-preview-540p-v2'")) {
  const marker = /const PREVIEW_TRANSFORM_VERSION = '(?:preview-v3|reizo-preview-540p-v1)';/;
  if (!marker.test(previewCode)) throw new Error('Unexpected upstream preview cache version');
  previewCode = previewCode.replace(marker, "const PREVIEW_TRANSFORM_VERSION = 'reizo-preview-540p-v2';");
  writeFileSync(previewFile, previewCode);
}
const transformsFile = path.join(source, 'server/plugins/media-preview-transforms.ts');
let transformsCode = readFileSync(transformsFile, 'utf8');
if (!transformsCode.includes('function appendBoundedPeak')) {
  const push = 'state.peaks.push(Math.round(state.binMax * 1000) / 1000)';
  if (transformsCode.split(push).length !== 3) throw new Error('Unexpected upstream waveform accumulation');
  transformsCode = transformsCode.replaceAll(push, 'appendBoundedPeak(state)')
    .replace('Math.floor((PCM_RATE * seconds) / bins)', 'Math.ceil((PCM_RATE * seconds) / bins)')
    .replace('function appendPcmPeaks(', "// Decoder padding or inaccurate duration metadata must not grow an unbounded array.\nfunction appendBoundedPeak(state: PeakState): void {\n  const peak = Math.round(state.binMax * 1000) / 1000;\n  if (state.peaks.length < MAX_PEAK_BINS) state.peaks.push(peak);\n  else state.peaks[MAX_PEAK_BINS - 1] = Math.max(state.peaks[MAX_PEAK_BINS - 1]!, peak);\n}\n\nfunction appendPcmPeaks(");
  writeFileSync(transformsFile, transformsCode);
}
let code = readFileSync(library, 'utf8');
code = code.replace('MAIN_TABS.map((tab)', "MAIN_TABS.filter((tab) => ['我的素材', '字幕'].includes(tab)).map((tab)");
code = code.replace('onAddAssetsToChat={onUseMediaAI}', 'onAddAssetsToChat={undefined}');
code = code.replace(', onUseMediaAI,', ',');
writeFileSync(library, code);
const pool = path.join(source, 'src/media/MediaPoolPanel.tsx');
let poolCode = readFileSync(pool, 'utf8').replace(', MusicModelsNotice,', ',').replace('      <MusicModelsNotice cards={musicAnalysis} />', '');
if (!poolCode.includes('ReizoPoolActions')) {
  const marker = '      <MediaPoolToolbar';
  if (!poolCode.includes(marker)) throw new Error('Unexpected upstream media pool toolbar');
  poolCode = "import { ReizoPoolActions } from '../editor/ReizoPoolActions';\n" + poolCode.replace(marker, '      <ReizoPoolActions assets={selectedAssets} />\n' + marker);
}
writeFileSync(pool, poolCode);
// Older local overlay reported on Promise resolution, which can also mean a stale/no-op apply.
// Remove that overlay and observe the runtime's actual terminal transition instead.
const externalActions = path.join(source, 'src/agent/useExternalAgentBridge.ts');
let externalCode = readFileSync(externalActions, 'utf8');
if (externalCode.includes('reportReizoActivity')) {
  externalCode = externalCode.replace("import { reportReizoActivity } from '../editor/reizoMediaBridge';\n", '')
    .replace("const runAction = useCallback((action: Promise<void> | undefined, outcome: 'applied' | 'rejected') => {", 'const runAction = useCallback((action: Promise<void> | undefined) => {')
    .replace("void action.then(() => reportReizoActivity(outcome, outcome === 'applied' ? 'Agent 修改已应用到时间线' : 'Agent 修改已拒绝'), (actionError) => { setError(errorMessage(actionError)); reportReizoActivity('failed', errorMessage(actionError)); });", 'void action.catch((actionError) => setError(errorMessage(actionError)));')
    .replace("runAction(runtimeRef.current?.runtime.apply(selected), 'applied')", 'runAction(runtimeRef.current?.runtime.apply(selected))')
    .replace("runAction(runtimeRef.current?.runtime.apply(selected, true), 'applied')", 'runAction(runtimeRef.current?.runtime.apply(selected, true))')
    .replace("runAction(runtimeRef.current?.runtime.reject(), 'rejected')", 'runAction(runtimeRef.current?.runtime.reject())');
  writeFileSync(externalActions, externalCode);
}
const externalRuntime = path.join(source, 'src/agent/external-bridge-runtime.ts');
let runtimeCode = readFileSync(externalRuntime, 'utf8');
if (!runtimeCode.includes('reportReizoActivity')) {
  const marker = 'this.sessions.set(session.id, finishExternalEditSession(session, status, appliedOperationCount));';
  if (!runtimeCode.includes(marker)) throw new Error('Unexpected upstream external terminal transition');
  runtimeCode = "import { reportReizoActivity } from '../editor/reizoMediaBridge';\n" + runtimeCode.replace(marker, marker + `
    reportReizoActivity(status === 'stale' ? 'failed' : status,
      status === 'applied' ? 'Agent 修改已应用到时间线' : status === 'rejected' ? 'Agent 修改已拒绝' : status === 'cancelled' ? 'Agent 修改已取消' : status === 'stale' ? '草稿已过期，未应用修改' : 'Agent 修改失败');`);
  writeFileSync(externalRuntime, runtimeCode);
}
// A terminal status read can arrive between applying the document and persisting
// its receipt. Serialize that read behind Apply so it cannot mark the committing
// draft stale. All mutation/revision/ownership checks remain upstream-owned.
if (!runtimeCode.includes('private reizoApply:')) {
  runtimeCode = runtimeCode.replace(/\r\n/g, '\n');
  const applyMarker = '  async apply(\n';
  const readMarker = '    const sessionId = externalSessionId(rawArgs);\n';
  if (!runtimeCode.includes(applyMarker) || !runtimeCode.includes(readMarker)) throw new Error('Unexpected upstream apply/read boundary');
  runtimeCode = runtimeCode.replace(applyMarker, `  private reizoApply: Promise<void> | null = null;
  async apply(selected: Set<number>, force = false, exposeProposal = true, signal?: AbortSignal): Promise<void> {
    if (this.reizoApply) return this.reizoApply;
    const pending = this.applyDraft(selected, force, exposeProposal, signal);
    this.reizoApply = pending;
    try { await pending; } finally { if (this.reizoApply === pending) this.reizoApply = null; }
  }
  private async applyDraft(
`).replace(readMarker, readMarker + "    if (name === 'get_edit_session' && this.reizoApply) await this.reizoApply.catch(() => undefined);\n");
  writeFileSync(externalRuntime, runtimeCode);
}
// No inference/model warmup is needed for the editing-only surface.
const controller = path.join(source, 'src/editor/useEditorController.tsx');
writeFileSync(controller, readFileSync(controller, 'utf8')
  .replace(/import \{ useAutoMusicAnalysis \} from '..\/audio\/intelligence\/useAutoMusicAnalysis';\r?\n/, '')
  .replace('  useAutoMusicAnalysis(editor.doc.assets);', '  // Reizo: local music analysis is opt-in, not a startup dependency.'));
// Save supported finished exports through the host's durable asset transaction.
const destination = path.join(source, 'src/export/exportDestination.ts');
let destinationCode = readFileSync(destination, 'utf8');
if (!destinationCode.includes('saveReizoExport')) {
  const expected = 'downloadBlob(blob, outputFilename);';
  if (destinationCode.split(expected).length !== 3) throw new Error('Unexpected upstream export destination; refusing an incomplete bridge patch');
  destinationCode = "import { saveReizoExport } from '../editor/reizoMediaBridge';\n" + destinationCode.replaceAll(expected, 'if (!await saveReizoExport(blob, outputFilename)) downloadBlob(blob, outputFilename);');
  writeFileSync(destination, destinationCode);
}
const agentExport = path.join(source, 'src/export/agentExportTracking.ts');
let agentCode = readFileSync(agentExport, 'utf8');
if (!agentCode.includes('saveReizoRenderedExport')) {
  const marker = 'const completed = await pollExport({ setProgress: setters.setProgress, t }, submission.renderId, signal);';
  if (!agentCode.includes(marker)) throw new Error('Unexpected upstream Agent export lifecycle');
  agentCode = "import { saveReizoRenderedExport } from '../editor/reizoMediaBridge';\n" + agentCode.replace(marker, marker + '\n    await saveReizoRenderedExport(completed, submission.label);');
  writeFileSync(agentExport, agentCode);
}
const renderClient = path.join(source, 'src/export/renderJobClient.ts');
let renderClientCode = readFileSync(renderClient, 'utf8').replace(/\r\n/g, '\n');
if (!renderClientCode.includes('reizoRenderRequest')) {
  const submit = "const response = await fetch('/export/job', {";
  const read = "const response = await fetch(`/export/job/${encodeURIComponent(renderId)}`, { method: 'GET', signal });";
  const cancel = "const response = await fetch(`/export/job/${encodeURIComponent(renderId)}`, { method: 'DELETE' });";
  for (const marker of [submit, read, cancel]) if (!renderClientCode.includes(marker)) throw new Error('Unexpected upstream render job client');
  renderClientCode = "import { isReizoEmbedded, reizoRenderRequest } from '../editor/reizoMediaBridge';\n" + renderClientCode
    .replace(submit, "if (isReizoEmbedded() && !body.operationId) body = { ...body, operationId: crypto.randomUUID() };\n  const response = isReizoEmbedded() ? await reizoRenderRequest('POST', undefined, body) : await fetch('/export/job', {")
    .replace(read, "signal?.throwIfAborted();\n  const response = isReizoEmbedded() ? await reizoRenderRequest('GET', renderId) : await fetch(`/export/job/${encodeURIComponent(renderId)}`, { method: 'GET', signal });")
    .replace(cancel, "const response = isReizoEmbedded() ? await reizoRenderRequest('DELETE', renderId) : await fetch(`/export/job/${encodeURIComponent(renderId)}`, { method: 'DELETE' });");
  writeFileSync(renderClient, renderClientCode);
}
const videoOperation = path.join(source, 'src/export/videoExportOperation.ts');
let videoOperationCode = readFileSync(videoOperation, 'utf8').replace(/\r\n/g, '\n');
if (!videoOperationCode.includes('isReizoEmbedded')) {
  const marker = '    const options = browserOptions(context, controller.signal);';
  if (!videoOperationCode.includes(marker)) throw new Error('Unexpected upstream video export routing');
  videoOperationCode = "import { isReizoEmbedded } from '../editor/reizoMediaBridge';\n" + videoOperationCode.replace(marker,
    "    if (isReizoEmbedded()) {\n      context.setRenderEngine('server');\n      context.setEngineReason('工作台后台导出');\n      await context.exportServerVideo(controller.signal);\n      return;\n    }\n" + marker);
  writeFileSync(videoOperation, videoOperationCode);
}
const renderOperation = path.join(source, 'src/export/serverExportRenderOperation.ts');
let renderOperationCode = readFileSync(renderOperation, 'utf8').replace(/\r\n/g, '\n');
if (!renderOperationCode.includes('isReizoEmbedded')) {
  const marker = 'if (submissionAccepted && !outputObserved) {';
  if (!renderOperationCode.includes(marker)) throw new Error('Unexpected upstream render cleanup');
  // A lost UI observer must not cancel an accepted host job. Explicit user cancellation still propagates.
  renderOperationCode = "import { isReizoEmbedded } from '../editor/reizoMediaBridge';\n" + renderOperationCode.replace(marker, 'if (submissionAccepted && !outputObserved && (!isReizoEmbedded() || signal?.aborted)) {');
  writeFileSync(renderOperation, renderOperationCode);
}
const destinationBar = path.join(source, 'src/export/ExportDestinationBar.tsx');
let bar = readFileSync(destinationBar, 'utf8');
if (!bar.includes('Reizo 素材库')) {
  bar = bar.replace('  const downloads =', "  const embedded = window.parent !== window;\n  const downloads =")
    .replace("{downloads ? t('浏览器下载目录') : destination.label}", "{embedded && downloads ? 'Reizo 素材库 · 剪辑成片' : downloads ? t('浏览器下载目录') : destination.label}")
    .replace("{downloads ? t('保存位置由浏览器下载设置决定') : t('文件将直接写入所选文件夹')}", "{embedded && downloads ? '视频和音频回到当前画布；其他格式下载到本机' : downloads ? t('保存位置由浏览器下载设置决定') : t('文件将直接写入所选文件夹')}");
  writeFileSync(destinationBar, bar);
}
if (!process.argv.includes('--skip-install')) run('npm', ['ci', '--no-audit', '--no-fund']);
patchDraftRefinement(source);
patchDraftApproval(source);
patchSpeech(source);
patchRendererRuntime(source);
const browserArg = process.argv.indexOf('--browser');
let browserExecutable = browserArg >= 0 ? path.resolve(process.argv[browserArg + 1]) : previous.browserExecutable;
if (browserExecutable && !existsSync(browserExecutable)) throw new Error('Browser executable does not exist');
const bundleArg = process.argv.indexOf('--render-bundle');
let renderBundle = bundleArg >= 0 ? path.resolve(process.argv[bundleArg + 1]) : previous.renderBundle;
if (renderBundle && !existsSync(path.join(renderBundle, 'index.html'))) throw new Error('Render bundle index.html does not exist');
// The render bundle is compiled code: a source patch does not change an already cached renderer.
// Hash the inputs, rebuild into a fresh directory, and publish the manifest only after success.
const renderHash = createHash('sha256').update(revision).update(readFileSync(path.join(source, 'package-lock.json')));
function hashRenderInputs(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) hashRenderInputs(file);
    else if (item.isFile() && /\.(?:tsx?|m?js|css|frag|json)$/.test(item.name)) renderHash.update(path.relative(source, file).replaceAll('\\', '/')).update(readFileSync(file));
  }
}
for (const directory of ['src', 'shared', 'remotion']) hashRenderInputs(path.join(source, directory));
const renderBundleId = renderHash.digest('hex');
let renderMarker;
try { renderMarker = JSON.parse(readFileSync(path.join(renderBundle, '.reizo-render.json'), 'utf8')); } catch { /* older bundles need rebuilding */ }
if (renderMarker?.id !== renderBundleId || process.argv.includes('--rebuild-render')) {
  const buildRoot = path.resolve(root, '.cache/openchatcut-build');
  const output = path.join(buildRoot, `render-${renderBundleId.slice(0, 16)}-${Date.now()}`);
  if (!output.startsWith(buildRoot + path.sep) || existsSync(output)) throw new Error('Render build target must be a fresh private directory');
  console.log('Building the updated render bundle…');
  const { prebuildServeBundle } = await import(pathToFileURL(path.join(source, 'remotion/serve-bundle.mjs')).href);
  await prebuildServeBundle(output);
  writeFileSync(path.join(output, '.reizo-render.json'), JSON.stringify({ id: renderBundleId, background: 'opaque-black-v1' }));
  renderBundle = output;
}
let node = previous.node && existsSync(previous.node) ? previous.node : process.execPath;
if (process.argv.includes('--cache-runtime')) {
  if (!browserExecutable || !renderBundle) throw new Error('--cache-runtime needs --browser and --render-bundle on first setup');
  const runtime = path.join(root, '.cache/openchatcut-runtime');
  mkdirSync(runtime, { recursive: true });
  const cachedNode = path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node');
  if (path.resolve(node) !== cachedNode) copyFileSync(node, cachedNode);
  node = cachedNode;
  const browserDir = path.join(runtime, 'browser');
  if (path.dirname(browserExecutable) !== browserDir) copyDirectory(path.dirname(browserExecutable), browserDir);
  browserExecutable = path.join(browserDir, path.basename(browserExecutable));
  const bundleDir = path.join(runtime, `render-bundle-${renderBundleId.slice(0, 16)}`);
  if (renderBundle !== bundleDir) {
    const uploads = path.join(renderBundle, 'media', 'uploads');
    copyDirectory(renderBundle, bundleDir, uploads);
  }
  renderBundle = bundleDir;
}
const config = { source, revision, node, browserExecutable, renderBundle, renderBundleId, integrationVersion: 2 };
writeFileSync(`${configPath}.tmp`, JSON.stringify(config, null, 2));
renameSync(`${configPath}.tmp`, configPath);
run(process.execPath, [path.join(root, 'scripts/check-openchatcut.mjs')], root);
console.log('OpenChatCut editor prepared. Open 视频剪辑 in Reizo.');
