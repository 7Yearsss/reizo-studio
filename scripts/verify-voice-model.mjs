// Load the actual recognition Worker in native Electron, with all external network blocked.
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const resources = path.resolve(process.argv[2] || '.cache');
const root = await mkdtemp(path.join(tmpdir(), 'reizo-voice-check-'));
try {
  await build({ entryPoints: ['src/renderer/lib/voice/recognition.worker.ts'], bundle: true, platform: 'browser', format: 'esm', define: { 'import.meta.env.DEV': 'false' }, outfile: path.join(root, 'worker.js') });
  const entry = `
import { app, BrowserWindow, session } from 'electron';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createVoiceRouter } from './src/main/server/routes/voice';
import { createVoiceModelStore } from './src/main/server/voice/modelStore';
import { VOICE_MODEL, VOICE_REVISION, VOICE_FILES } from './src/shared/voiceInput';
app.setPath('userData', ${JSON.stringify(root)});
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
 try {
  const resources = ${JSON.stringify(resources)};
  process.env.REIZO_VOICE_RUNTIME = path.join(resources, 'voice-runtime');
  process.env.REIZO_VOICE_MODEL = path.join(resources, 'voice-model', VOICE_REVISION);
  globalThis.fetch = async () => { throw new Error('External network is disabled'); };
  const store = createVoiceModelStore(path.join(${JSON.stringify(root)}, 'fresh-data'), fetch, process.env.REIZO_VOICE_MODEL);
  if (!(await store.status()).ready) throw new Error('Bundled voice model missing or corrupt');
  await store.prepare();
  for (const [name] of VOICE_FILES) if (!(await store.read(name))) throw new Error('Cannot read bundled model: '+name);
  const router = new Hono();
  router.route('/api/voice', createVoiceRouter(path.join(${JSON.stringify(root)}, 'fresh-router-data')));
  router.get('/worker.js', async c => c.body(await readFile(path.join(${JSON.stringify(root)}, 'worker.js'), 'utf8'), 200, {'Content-Type':'text/javascript'}));
  router.get('/', c => c.html('<script>const worker = new Worker("/worker.js", {type:"module"}); worker.onmessage = event => console.log("REIZO_OFFLINE_VOICE:"+JSON.stringify(event.data)); worker.onerror = event => console.log("REIZO_OFFLINE_VOICE:"+JSON.stringify({type:"error",message:event.message})); worker.postMessage({type:"load",origin:location.origin});</script>'));
  const server = serve({fetch:router.fetch,hostname:'127.0.0.1',port:0});
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const origin = 'http://127.0.0.1:'+server.address().port;
  const profile = session.fromPartition('voice-offline-check');
  profile.webRequest.onBeforeRequest((details, callback) => callback({cancel:!details.url.startsWith(origin+'/') && !details.url.startsWith('blob:'+origin+'/')}));
  const win = new BrowserWindow({show:false, webPreferences:{session:profile,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message', (_event, ...args) => {
    const message = typeof args[0] === 'object' ? args[0].message : args[1];
    if (!message?.startsWith('REIZO_OFFLINE_VOICE:')) return;
    const result = JSON.parse(message.slice('REIZO_OFFLINE_VOICE:'.length));
    if (result.type === 'ready') {console.log(JSON.stringify({offlineVoiceReady:true,platform:process.platform,arch:process.arch,model:VOICE_MODEL,revision:VOICE_REVISION,files:VOICE_FILES.length})); app.exit(0);}
    else {console.error(result);app.exit(1);}
  });
  await win.loadURL(origin);
 } catch(error) { console.error(error); app.exit(1); }
});
`;
  await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'main.cjs') });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'reizo-voice-check', version: '0.0.0', main: 'main.cjs' }));
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [root], { stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Offline voice loading timed out')); }, 180000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Offline voice check failed (' + code + ')')); });
  });
} finally {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('reizo-voice-check-')) throw new Error('Unexpected test directory');
  await rm(root, { recursive: true, force: true });
}
