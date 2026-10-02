import { describe, expect, it, vi } from 'vitest';
import type { CanvasStore } from '../storage/canvasStore';
import { stopCanvasWork } from './workLifecycle';
import { createGenerationScheduler, generationSchedulerFor, GenerationSchedulerClosedError } from './generationScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('generation scheduler', () => {
  it('enforces default global 8 and provider 4 while skipping a provider-blocked queue entry', async () => {
    const scheduler = createGenerationScheduler();
    const a = await Promise.all(Array.from({ length: 4 }, () => scheduler.acquire('a')));
    const aGranted = vi.fn();
    const nextA = scheduler.acquire('a').then((release) => { aGranted(); return release; });
    const b = await Promise.all(Array.from({ length: 4 }, () => scheduler.acquire('b')));
    const cGranted = vi.fn();
    const nextC = scheduler.acquire('c').then((release) => { cGranted(); return release; });
    await Promise.resolve();
    expect(aGranted).not.toHaveBeenCalled();
    expect(cGranted).not.toHaveBeenCalled();
    b[0]();
    const releaseC = await nextC;
    expect(cGranted).toHaveBeenCalledTimes(1);
    expect(aGranted).not.toHaveBeenCalled();
    a[0]();
    const releaseA = await nextA;
    releaseA(); releaseC(); a.forEach((release) => release()); b.forEach((release) => release());
  });

  it('preserves FIFO among eligible requests and within each provider', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 2, providerLimit: 1 });
    const firstA = await scheduler.acquire('a');
    const order: string[] = [];
    const a2 = scheduler.acquire('a').then((release) => { order.push('a2'); return release; });
    const a3 = scheduler.acquire('a').then((release) => { order.push('a3'); return release; });
    const firstB = await scheduler.acquire('b');
    const b2 = scheduler.acquire('b').then((release) => { order.push('b2'); return release; });
    firstA();
    const secondA = await a2;
    expect(order).toEqual(['a2']);
    firstB();
    const secondB = await b2;
    expect(order).toEqual(['a2', 'b2']);
    secondA();
    const thirdA = await a3;
    expect(order).toEqual(['a2', 'b2', 'a3']);
    secondB(); thirdA();
  });

  it('idempotent release never gives the next owner an extra slot', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const first = await scheduler.acquire('a');
    const second = scheduler.acquire('a');
    const thirdGranted = vi.fn();
    const third = scheduler.acquire('a').then((release) => { thirdGranted(); return release; });
    first(); first();
    const secondRelease = await second;
    first();
    await Promise.resolve();
    expect(thirdGranted).not.toHaveBeenCalled();
    secondRelease();
    const thirdRelease = await third;
    expect(thirdGranted).toHaveBeenCalledTimes(1);
    thirdRelease();
  });

  it('removes an aborted waiter and its listener before another request is admitted', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const release = await scheduler.acquire('a');
    const abort = new AbortController();
    const removed = vi.spyOn(abort.signal, 'removeEventListener');
    const waiting = scheduler.acquire('a', abort.signal);
    const rejection = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await rejection;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    release();
    const next = await scheduler.acquire('a');
    next();
  });

  it('active abort automatically releases capacity and a late manual release remains harmless', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const abort = new AbortController();
    const first = await scheduler.acquire('a', abort.signal);
    const second = scheduler.acquire('a');
    abort.abort();
    const secondRelease = await second;
    const thirdGranted = vi.fn();
    const third = scheduler.acquire('a').then((release) => { thirdGranted(); return release; });
    first();
    await Promise.resolve();
    expect(thirdGranted).not.toHaveBeenCalled();
    secondRelease();
    (await third)();
  });

  it('an active abort never grants queued siblings that share the aborted signal', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const abort = new AbortController();
    await scheduler.acquire('a', abort.signal);
    const firstSibling = scheduler.acquire('a', abort.signal);
    const secondSibling = scheduler.acquire('a', abort.signal);
    const firstRejection = expect(firstSibling).rejects.toMatchObject({ name: 'AbortError' });
    const secondRejection = expect(secondSibling).rejects.toMatchObject({ name: 'AbortError' });
    const unaffected = scheduler.acquire('b');
    abort.abort();
    await Promise.all([firstRejection, secondRejection]);
    (await unaffected)();
  });

  it('does not execute a paid callback if cancellation follows permit grant before its continuation', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const release = await scheduler.acquire('a');
    const abort = new AbortController();
    const execute = vi.fn(async () => 'paid');
    const pending = scheduler.run('a', execute, abort.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release();
    abort.abort();
    await rejection;
    expect(execute).not.toHaveBeenCalled();
    (await scheduler.acquire('a'))();
  });

  it('releases a cancelled run even when its provider ignores abort and observes its late failure', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const abort = new AbortController();
    const provider = deferred<string>();
    const firstStarted = vi.fn();
    const first = scheduler.run('a', async () => { firstStarted(); return provider.promise; }, abort.signal);
    await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledTimes(1));
    const second = scheduler.run('a', async () => 'second');
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await rejection;
    expect(await second).toBe('second');
    provider.reject(new Error('late provider failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('returns capacity after an execution failure', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const failed = scheduler.run('a', async () => { throw new Error('failed provider'); });
    const next = scheduler.run('a', async () => 'next');
    await expect(failed).rejects.toThrow('failed provider');
    expect(await next).toBe('next');
  });

  it('shutdown rejects waiters and running wrappers and prevents all further admission', async () => {
    const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
    const provider = deferred<string>();
    const started = vi.fn();
    const running = scheduler.run('a', async () => { started(); return provider.promise; });
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    const queued = scheduler.acquire('b');
    const runningRejection = expect(running).rejects.toBeInstanceOf(GenerationSchedulerClosedError);
    const queuedRejection = expect(queued).rejects.toBeInstanceOf(GenerationSchedulerClosedError);
    scheduler.shutdown(); scheduler.shutdown();
    await Promise.all([runningRejection, queuedRejection]);
    expect(scheduler.isAccepting()).toBe(false);
    await expect(scheduler.acquire('a')).rejects.toBeInstanceOf(GenerationSchedulerClosedError);
    provider.resolve('late success');
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('shares one scheduler per repository, isolates repositories and closes with host work', async () => {
    const firstStore = {} as CanvasStore;
    const secondStore = {} as CanvasStore;
    const first = generationSchedulerFor(firstStore, { globalLimit: 1, providerLimit: 1 });
    expect(generationSchedulerFor(firstStore)).toBe(first);
    const second = generationSchedulerFor(secondStore, { globalLimit: 1, providerLimit: 1 });
    expect(second).not.toBe(first);
    const release = await first.acquire('a');
    const queued = first.acquire('a');
    const rejection = expect(queued).rejects.toBeInstanceOf(GenerationSchedulerClosedError);
    stopCanvasWork(firstStore);
    await rejection;
    expect(first.isAccepting()).toBe(false);
    expect(second.isAccepting()).toBe(true);
    release();
    (await second.acquire('a'))();
    second.shutdown();
  });

  it('rejects invalid limits and starts closed when its lifecycle signal already ended', async () => {
    expect(() => createGenerationScheduler({ globalLimit: 0 })).toThrow(RangeError);
    expect(() => createGenerationScheduler({ providerLimit: 1.5 })).toThrow(RangeError);
    const abort = new AbortController(); abort.abort();
    const scheduler = createGenerationScheduler({ signal: abort.signal });
    await expect(scheduler.acquire('a')).rejects.toBeInstanceOf(GenerationSchedulerClosedError);
  });
});
