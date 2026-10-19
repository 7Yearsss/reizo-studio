import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fromTransformers = createRequire(require.resolve('@huggingface/transformers'));
const source = path.dirname(fromTransformers.resolve('onnxruntime-web'));
const destination = path.resolve('.cache/voice-runtime');
mkdirSync(destination, { recursive: true });
for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  copyFileSync(path.join(source, name), path.join(destination, name));
}
console.log('Voice runtime prepared.');
