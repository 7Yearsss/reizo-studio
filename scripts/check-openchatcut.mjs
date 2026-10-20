import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
function check(name, run) {
  try { const detail = run(); checks.push({ name, ok: true, detail }); }
  catch (error) { checks.push({ name, ok: false, detail: error.message }); }
}
function requireFile(file) { if (!file || !path.isAbsolute(file) || !existsSync(file)) throw new Error(`Missing: ${file || '(not configured)'}`); return file; }
let config;
check('Runtime manifest', () => {
  config = JSON.parse(readFileSync(path.join(root, '.cache/openchatcut-runtime.json'), 'utf8'));
  if (config.integrationVersion !== 2) throw new Error('Run npm run setup:video-editor -- --skip-install to update the bridge');
  return config.source;
});
if (config) {
  check('Pinned source revision', () => {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: config.source, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || result.stdout.trim() !== '2e6f4a29b784200cfb32b859b16f2561592bc3e8') throw new Error('Expected OpenChatCut v0.2.16 pinned commit');
    return result.stdout.trim();
  });
  check('Node runtime', () => {
    const result = spawnSync(requireFile(config.node), ['--version'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || Number(result.stdout.trim().slice(1).split('.')[0]) < 24) throw new Error('Node.js 24+ must start successfully');
    return result.stdout.trim();
  });
  check('Locked editing dependencies', () => {
    const lock = JSON.parse(readFileSync(path.join(config.source, 'package-lock.json'), 'utf8'));
    for (const name of ['vite', 'react', 'remotion', '@remotion/renderer', '@remotion/bundler', 'mediabunny']) {
      const installed = JSON.parse(readFileSync(path.join(config.source, 'node_modules', name, 'package.json'), 'utf8'));
      if (installed.version !== lock.packages[`node_modules/${name}`]?.version) throw new Error(`${name}: version differs from upstream lockfile`);
    }
    return 'Vite / React / Remotion / Mediabunny match package-lock.json';
  });
  check('FFmpeg', () => {
    const require = createRequire(path.join(config.source, 'package.json'));
    const executable = require('ffmpeg-static');
    const result = spawnSync(requireFile(executable), ['-version'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('FFmpeg failed to start; run its install script or restore the binary');
    return result.stdout.split('\n')[0];
  });
  check('Render browser', () => requireFile(config.browserExecutable));
  check('Prebuilt render bundle', () => {
    const file = requireFile(config.renderBundle && path.join(config.renderBundle, 'index.html'));
    const marker = JSON.parse(readFileSync(path.join(config.renderBundle, '.reizo-render.json'), 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(config.renderBundleId ?? '') || marker.id !== config.renderBundleId || marker.background !== 'opaque-black-v1') throw new Error('Render bundle is stale; run setup:video-editor');
    return file;
  });
  check('Integration overlays', () => {
    for (const [from, to] of [['App.tsx', 'src/App.tsx'], ['EditorWorkspaceView.tsx', 'src/editor/EditorWorkspaceView.tsx'], ['reizoMediaBridge.ts', 'src/editor/reizoMediaBridge.ts'], ['ReizoPoolActions.tsx', 'src/editor/ReizoPoolActions.tsx'], ['ReizoSpeechSettings.tsx', 'src/editor/ReizoSpeechSettings.tsx'], ['reizoSpeech.ts', 'src/agent/reizoSpeech.ts'], ['reizoSpeechJobs.ts', 'src/agent/reizoSpeechJobs.ts'], ['server.mjs', 'reizo-server.mjs']]) {
      if (readFileSync(path.join(root, 'integrations/openchatcut', from), 'utf8') !== readFileSync(path.join(config.source, to), 'utf8')) throw new Error(`Overlay is stale: ${to}`);
    }
    if (!readFileSync(path.join(config.source, 'src/export/exportDestination.ts'), 'utf8').includes('await saveReizoExport')) throw new Error('Export return bridge is missing');
    if (!readFileSync(path.join(config.source, 'src/export/agentExportTracking.ts'), 'utf8').includes('await saveReizoRenderedExport')) throw new Error('Agent export return bridge is missing');
    if (!readFileSync(path.join(config.source, 'src/export/renderJobClient.ts'), 'utf8').includes('reizoRenderRequest')) throw new Error('Durable host export bridge is missing');
    if (!readFileSync(path.join(config.source, 'src/export/videoExportOperation.ts'), 'utf8').includes('isReizoEmbedded')) throw new Error('Embedded background-render routing is missing');
    if (!readFileSync(path.join(config.source, 'src/agent/external-bridge-runtime.ts'), 'utf8').includes('reportReizoActivity')) throw new Error('Editor terminal-state feedback is missing');
    if (!readFileSync(path.join(config.source, 'src/agent/external-bridge-runtime.ts'), 'utf8').includes('private reizoApply:')) throw new Error('Apply/status synchronization is missing');
    if (!readFileSync(path.join(config.source, 'src/media/MediaPoolPanel.tsx'), 'utf8').includes('ReizoPoolActions')) throw new Error('Selected source-media return is missing');
    if (!readFileSync(path.join(config.source, 'src/editor/storeCommandBuilder.ts'), 'utf8').includes('transcriptGenerationId: identity.transcriptGenerationId')) throw new Error('Stable transcript draft replay is missing');
    return 'Media import/return, live selection and terminal-state feedback are installed';
  });
}
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
