// Native browser/codec smoke test, run with Node on Windows and macOS release runners.
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'reizo-video-check-'));
try {
  await build({ entryPoints: ['src/main/videoReader.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'reader.cjs') });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'reizo-video-check', version: '0.0.0', main: 'main.cjs' }));
  await writeFile(path.join(root, 'main.cjs'), `
const { app, nativeImage } = require('electron');
const { createHash } = require('node:crypto');
app.setPath('userData', __dirname);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const result = await require('./reader.cjs').readBrowserVideo({ url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', frameCount: 3 }, AbortSignal.timeout(90000));
    const hashes = result.frames.map(frame => createHash('sha256').update(frame.jpeg).digest('hex'));
    if (result.duration < 4 || result.frames.length !== 3 || new Set(hashes).size < 2) throw new Error('Video sampling failed');
    const image = nativeImage.createFromBuffer(result.frames[1].jpeg), size = image.getSize(), pixels = image.toBitmap();
    let coloured = 0;
    for (let y = Math.floor(size.height * .2); y < size.height * .8; y += 10) for (let x = Math.floor(size.width * .2); x < size.width * .8; x += 10) {
      const i = (y * size.width + x) * 4;
      if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) - Math.min(pixels[i], pixels[i+1], pixels[i+2]) > 25) coloured++;
    }
    if (coloured < 100) throw new Error('Decoder returned blank frames');
    console.log(JSON.stringify({ platform: process.platform, duration: result.duration, timestamps: result.frames.map(f => f.timestamp), distinctFrames: new Set(hashes).size, colouredPixels: coloured }));
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
`);
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [root], { stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native video verification timed out')); }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Native video verification failed (${code})`)); });
  });
} finally {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('reizo-video-check-')) throw new Error('Unexpected test directory');
  await rm(root, { recursive: true, force: true });
}
