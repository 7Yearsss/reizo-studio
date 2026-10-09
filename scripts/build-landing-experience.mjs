import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const website = path.resolve(repo, '../../winlume');
const output = path.resolve(process.argv[2] ?? path.join(website, 'public/reizo/experience'));
// Build only into the explicit experience destination, never a general public/repo directory.
if (path.basename(output) !== 'experience') throw new Error('Output directory must end in experience');
await build({ configFile: false, root: path.join(repo, 'scripts/landing-experience'), base: '/reizo/experience/',
  plugins: [react(), tailwindcss(), wgslVitePlugin()],
  resolve: { alias: { '@': path.join(repo, 'src') } },
  build: { outDir: output, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1600 },
});
const mediaRoot = path.join(output, 'api/canvas/assets');
for (const [folder, name, source] of [
  ['film', 'source.jpg', '../../winlume/public/reizo/showcase/film-poster.jpg'],
  ['film', 'everyday.mp4', '../../winlume/public/reizo/showcase/everyday-film.mp4'],
  ['commerce', 'main.jpg', 'amazon-lint-shaver/01-full.jpg'],
  ['commerce', 'detail.jpg', 'amazon-lint-shaver/xqXgsj362NIUdi-EcO6WZ-mucek9bw-0.jpg'],
  ['commerce', 'features.jpg', 'amazon-lint-shaver/02-text.jpg'],
]) {
  await mkdir(path.join(mediaRoot, folder), { recursive: true });
  await copyFile(path.resolve(repo, source), path.join(mediaRoot, folder, name));
}
console.log('Built the real REIZO renderer with a browser-local experience adapter:', output);
await mkdir(path.join(mediaRoot, 'design'), { recursive: true });
for (const name of ['made-to-move', 'collection', 'city-duo', 'motion-bw', 'community', 'fabric-detail']) {
  await copyFile(path.join(website, 'public/reizo/assets/nynor', `${name}.jpg`), path.join(mediaRoot, 'design', `${name}.jpg`));
}
