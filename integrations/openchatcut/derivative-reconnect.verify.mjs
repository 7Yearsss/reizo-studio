import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('.cache/openchatcut-runtime.json', 'utf8')).source;
const { DerivativeQueue } = await import(pathToFileURL(path.join(source, 'server/derivative-queue.ts')));
for (const concurrency of [1, 2]) {
  const queue = new DerivativeQueue(concurrency);
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  let oldFinished = false;
  let freshRuns = 0;
  const old = queue.acquire('same-source', async signal => {
    started.resolve();
    try { await gate.promise; signal.throwIfAborted(); return 'old'; }
    finally { oldFinished = true; }
  });
  const cancelled = old.promise.catch(error => error.name);
  await started.promise;
  old.release();
  const fresh = queue.acquire('same-source', async () => {
    assert(oldFinished, 'a replacement must wait for cancelled work to stop touching its cache');
    freshRuns++; return 'fresh';
  });
  const shared = queue.acquire('same-source', async () => { throw new Error('duplicate work'); });
  gate.resolve();
  assert.equal(await cancelled, 'AbortError');
  assert.equal(await fresh.promise, 'fresh', 'reconnecting consumers cannot inherit an aborted job');
  assert.equal(await shared.promise, 'fresh');
  assert.equal(freshRuns, 1);
  fresh.release(); shared.release();
}
// Both slots are occupied. A cancelled queued replacement cannot erase the old
// writer's barrier when a third consumer reconnects and another slot becomes free.
{
  const queue = new DerivativeQueue(2);
  const oldStarted = Promise.withResolvers(), oldGate = Promise.withResolvers();
  const otherStarted = Promise.withResolvers(), otherGate = Promise.withResolvers();
  let oldFinished = false;
  const old = queue.acquire('same', async signal => {
    oldStarted.resolve();
    try { await oldGate.promise; signal.throwIfAborted(); }
    finally { oldFinished = true; }
  });
  const oldResult = old.promise.catch(error => error.name);
  const other = queue.acquire('other', async () => { otherStarted.resolve(); await otherGate.promise; });
  await Promise.all([oldStarted.promise, otherStarted.promise]);
  old.release();
  const queued = queue.acquire('same', async () => { throw new Error('cancelled queued work ran'); });
  const queuedResult = queued.promise.catch(error => error.name);
  queued.release();
  const fresh = queue.acquire('same', async () => { assert(oldFinished); return 'fresh'; });
  otherGate.resolve(); await other.promise;
  await new Promise(resolve => setImmediate(resolve));
  oldGate.resolve();
  assert.equal(await oldResult, 'AbortError');
  assert.equal(await queuedResult, 'AbortError');
  assert.equal(await fresh.promise, 'fresh');
  other.release(); fresh.release();
}
console.log('Derivative cancellation/reconnection regression passed (concurrency 1 and 2).');
