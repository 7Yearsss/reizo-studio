/** Check the real browser module graph; type checks do not catch Vite 504 dependencies. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.resolve('vite'));
const { init, parse } = require('es-module-lexer');
await init;
const origin = process.argv[2] || 'http://127.0.0.1:46173';
const queue = [new URL('/src/renderer/components/workspace/ArtifactPanel.tsx', origin).href];
const seen = new Set(queue), failures = [];
let checked = 0;
async function check(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const code = await response.text();
    if (!response.ok) { failures.push(`${response.status} ${url}\n${code.slice(0, 800)}`); return; }
    checked++;
    if (!/javascript|typescript/.test(response.headers.get('content-type') ?? '')) return;
    const [imports] = parse(code);
    for (const entry of imports) {
      if (entry.d !== -1 || !entry.n?.startsWith('/')) continue;
      const next = new URL(entry.n, origin).href;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  } catch (error) { failures.push(`${url}: ${error.message}`); }
}
while (queue.length && seen.size < 2000) await Promise.all(queue.splice(0, 8).map(check));
if (queue.length) failures.push('Module graph exceeded 2000 entries');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ArtifactPanel and ${checked - 1} static dependencies are fetchable`);
