import { createRequire, isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchRendererRuntime } from '../integrations/openchatcut/patch-renderer-runtime.mjs';
import { patchDraftRefinement } from '../integrations/openchatcut/patch-draft-refinement.mjs';
import { patchDraftApproval } from '../integrations/openchatcut/patch-draft-approval.mjs';
import { patchSpeech } from '../integrations/openchatcut/patch-speech.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function copyTree(from, to, excluded = [], excludedFiles = []) {
  const result = spawnSync('robocopy', [from, to, '/E', '/XJ', '/MT:16', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...(excluded.length ? ['/XD', ...excluded] : []), ...(excludedFiles.length ? ['/XF', ...excludedFiles] : [])], { windowsHide: true, stdio: 'ignore' });
  if (result.status === null || result.status >= 8) throw new Error(`Resource copy failed: ${from} (${result.status})`);
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The bundled editor currently targets Windows x64.');
const runtimeJsonPath = path.join(root, '.cache/openchatcut-runtime.json');
if (!existsSync(runtimeJsonPath)) {
  console.log('[build-openchatcut-runtime] skipping: .cache/openchatcut-runtime.json not found');
  process.exit(0);
}
const dev = JSON.parse(readFileSync(runtimeJsonPath, 'utf8'));
const source = dev.source;
patchDraftRefinement(source);
patchDraftApproval(source);
patchSpeech(source);
patchRendererRuntime(source);
const requireUpstream = createRequire(path.join(source, 'package.json'));
const hash = createHash('sha256').update(dev.renderBundleId);
function hashTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) hashTree(file);
    else if (/\.(?:ts|tsx|js|mjs|json|css|frag)$/.test(file)) hash.update(path.relative(source, file)).update(readFileSync(file));
  }
}
for (const dir of ['src', 'shared', 'server', 'desktop', 'remotion']) hashTree(path.join(source, dir));
// The shipped corresponding-source archive must match the host code as well.
for (const dir of ['src', 'scripts', 'integrations']) hashTree(path.join(root, dir));
for (const file of ['package.json', 'package-lock.json', 'forge.config.ts']) hash.update(readFileSync(path.join(root, file)));
hash.update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(path.join(root, 'integrations/openchatcut/production-server.mjs')));
hash.update(readFileSync(path.join(source, 'package-lock.json')));
const buildId = hash.digest('hex');
const pointerFile = path.join(root, '.cache/openchatcut-package.json');
const previous = existsSync(pointerFile) ? JSON.parse(readFileSync(pointerFile, 'utf8')) : null;
const destination = previous?.directory ?? path.join(root, '.cache/package-resources/video-editor');
const manifestPath = path.join(destination, 'runtime.json');
if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).buildId === buildId) {
  console.log('Packaged editor resources already current.');
  process.exit(0);
}
// Build fresh, then publish. Never recursively delete a checkout or the previous runtime.
const stage = path.join(root, '.cache/package-resources', `build-${Date.now()}`, 'video-editor');
mkdirSync(stage, { recursive: true });
const { build: buildServer } = requireUpstream('esbuild');
const result = await buildServer({
  stdin: { contents: readFileSync(path.join(root, 'integrations/openchatcut/production-server.mjs'), 'utf8'), resolveDir: source, sourcefile: 'reizo-production-server.mjs', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external',
  outfile: path.join(stage, 'server.mjs'), metafile: true,
  loader: { '.frag': 'text', '.vert': 'text' },
  plugins: [{ name: 'raw-text', setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const { build: buildUi } = await import(pathToFileURL(requireUpstream.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(requireUpstream.resolve('@vitejs/plugin-react')).href);
await buildUi({
  root: source, configFile: false, publicDir: false, plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(path.join(source, 'package.json'))).version), __CONFIGURED_CAPS__: '{}' },
  build: { outDir: path.join(stage, 'ui'), emptyOutDir: false, chunkSizeWarningLimit: 3000 },
});
copyTree(path.join(source, 'assets'), path.join(stage, 'ui'));
cpSync(dev.node, path.join(stage, 'node.exe'));
copyTree(path.dirname(dev.browserExecutable), path.join(stage, 'browser'));
const uploads = path.join(dev.renderBundle, 'media', 'uploads');
copyTree(dev.renderBundle, path.join(stage, 'render-bundle'), [uploads]);

// Copy the exact installed dependency closure. Preserve nested resolution when two
// packages need different versions; do not install newer ranges or ship dev caches.
const copied = new Map();
const notices = [];
function locate(name, from) {
  const resolver = createRequire(path.join(from, 'package.json'));
  for (const base of resolver.resolve.paths(name) ?? []) {
    const candidate = path.join(base, name);
    if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
  }
  return null;
}
function copyPackage(name, from, parentDestination = stage, optional = false) {
  if (isBuiltin(name)) return;
  const installed = locate(name, from);
  if (!installed) { if (optional) return; throw new Error(`Missing runtime package: ${name} (from ${from})`); }
  const info = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  if (info.os && !info.os.includes('win32') || info.cpu && !info.cpu.includes('x64')) { if (optional) return; throw new Error(`Incompatible runtime package: ${name}`); }
  let target = path.join(stage, 'node_modules', name);
  if (copied.has(target)) {
    if (copied.get(target) === installed) return;
    target = path.join(parentDestination, 'node_modules', name);
    if (copied.get(target) === installed) return;
    if (copied.has(target)) throw new Error(`Conflicting package resolution: ${name}`);
  }
  copied.set(target, installed);
  mkdirSync(path.dirname(target), { recursive: true });
  const excluded = ['node_modules', '.git', '.cache'];
  // These packages expose compiled dist entries. Their deep authoring-source
  // paths exceed Squirrel's legacy Windows path limit and are not executable inputs.
  if (info.name.startsWith('@ai-sdk/') && info.main?.startsWith('./dist/') && !JSON.stringify(info.exports ?? {}).includes('./src/')) excluded.push(path.join(installed, 'src'));
  copyTree(installed, target, excluded, ['*.d.ts', '*.d.cts', '*.d.mts', '*.map']);
  notices.push({ name: info.name, version: info.version, license: info.license, directory: path.relative(stage, target) });
  if (copied.size % 50 === 0) console.log(`Copied ${copied.size} runtime packages`);
  for (const dependency of Object.keys(info.dependencies ?? {})) copyPackage(dependency, installed, target, Object.hasOwn(info.optionalDependencies ?? {}, dependency));
  for (const dependency of Object.keys(info.optionalDependencies ?? {})) copyPackage(dependency, installed, target, true);
  for (const dependency of Object.keys(info.peerDependencies ?? {})) copyPackage(dependency, installed, target, info.peerDependenciesMeta?.[dependency]?.optional === true);
}
const external = new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(i => i.external && !isBuiltin(i.path)).map(i => i.path.startsWith('@') ? i.path.split('/').slice(0, 2).join('/') : i.path.split('/')[0])));
// These use createRequire / computed platform names and are not esbuild imports.
for (const name of ['ffmpeg-static', '@ffprobe-installer/ffprobe', '@remotion/compositor-win32-x64-msvc']) external.add(name);
for (const name of external) copyPackage(name, source);
writeFileSync(path.join(stage, 'THIRD_PARTY_PACKAGES.json'), JSON.stringify(notices, null, 2));
cpSync(path.join(source, 'LICENSE'), path.join(stage, 'OPENCHATCUT-LICENSE'));
// Ship the modified corresponding source and rebuild instructions alongside binaries.
// Git's explicit inventory excludes local credentials, QA data and runtime uploads.
const JSZip = createRequire(path.join(root, 'package.json'))('jszip');
const sourceZip = new JSZip();
for (const [directory, prefix] of [[source, 'OpenChatCut'], [root, 'reizo-studio']]) {
  const listing = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: directory, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (listing.status !== 0) throw new Error(`Cannot enumerate corresponding source: ${prefix}`);
  for (const file of new Set(listing.stdout.split('\0').filter(Boolean))) {
    if (file.split('/').some(part => ['.git', '.cache', 'node_modules'].includes(part)) || /(^|\/)\.env(?:\.|$)/.test(file)) continue;
    const absolute = path.join(directory, file);
    if (existsSync(absolute)) sourceZip.file(`${prefix}/${file}`, createReadStream(absolute));
  }
}
sourceZip.file('REBUILD.txt', `Windows x64; Node.js 24.x and npm. Upstream revision: ${dev.revision}.\nClone https://github.com/0xsline/OpenChatCut at that revision, then overlay the OpenChatCut directory from this archive.\nIn reizo-studio, run npm ci, then npm run setup:video-editor -- --source <the-clone> --browser <absolute-path-to-this-runtime/browser/chrome-headless-shell.exe> --cache-runtime, then npm run make.\nThe browser directory is included next to this archive; keep its companion files beside chrome-headless-shell.exe. Setup builds the render bundle from source automatically and caches the runtime in the new checkout. The make/package launcher supplies an 8 GiB build heap unless NODE_OPTIONS already specifies a limit.\nThe source snapshot includes local integration modifications. Preserve upstream AGPL notices; Reizo's MIT notice does not relicense upstream code. Dependency licenses remain in each packaged node_modules directory; THIRD_PARTY_PACKAGES.json lists exact installed versions.\n`);
await pipeline(sourceZip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 1 } }), createWriteStream(path.join(stage, 'corresponding-source.zip')));
writeFileSync(path.join(stage, 'runtime.json'), JSON.stringify({
  kind: 'packaged', integrationVersion: 2, buildId, revision: dev.revision,
  entry: 'server.mjs', node: 'node.exe', browserExecutable: 'browser/chrome-headless-shell.exe',
  renderBundle: 'render-bundle', renderBundleId: dev.renderBundleId,
}, null, 2));
// Publish only a small pointer after all files close. Large directory renames can
// fail on Windows while a native build worker or virus scanner holds a file open.
// Forge copies this immutable directory under its stable basename "video-editor".
const pointerTemp = `${pointerFile}.${Date.now()}.tmp`;
writeFileSync(pointerTemp, JSON.stringify({ directory: stage, buildId }, null, 2));
renameSync(pointerTemp, pointerFile);
console.log(`Packaged editor prepared: ${stage} (${copied.size} runtime packages)`);
