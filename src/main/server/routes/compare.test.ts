import { describe, expect, it } from 'vitest';
import { createCompareRouter } from './compare';

const post = (router: ReturnType<typeof createCompareRouter>, body: unknown) =>
  router.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const targets = [{ providerId: 'a', model: 'fast' }, { providerId: 'b', model: 'slow' }, { providerId: 'c', model: 'broken' }];

describe('compare route', () => {
  it('asks every model at once; one failing does not block the others', async () => {
    const started: string[] = [];
    const router = createCompareRouter(async (t) => {
      started.push(t.model);
      if (t.model === 'broken') throw new Error('No API Key configured for c');
      await new Promise((r) => setTimeout(r, t.model === 'slow' ? 60 : 5));
      return `answer from ${t.model}`;
    });
    const res = await post(router, { text: '一句话介绍你自己', targets });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: Array<{ model: string; ok: boolean; text?: string; error?: string }> };
    expect(started).toEqual(['fast', 'slow', 'broken']); // all started before any finished
    expect(results.map((r) => r.model)).toEqual(['fast', 'slow', 'broken']);
    expect(results[0]).toMatchObject({ ok: true, text: 'answer from fast' });
    expect(results[1].ok).toBe(true);
    expect(results[2]).toMatchObject({ ok: false, error: 'No API Key configured for c' });
  });

  it('validates the question and the model choice', async () => {
    const router = createCompareRouter(async () => 'x');
    expect((await post(router, { text: '  ', targets })).status).toBe(400);
    expect((await post(router, { text: 'q', targets: [targets[0]] })).status).toBe(400);
    expect((await post(router, { text: 'x'.repeat(30_000), targets })).status).toBe(413);
  });

  it('an empty answer is reported as a failure, not a blank column', async () => {
    const router = createCompareRouter(async () => '   ');
    const { results } = (await (await post(router, { text: 'q', targets: targets.slice(0, 2) })).json()) as { results: Array<{ ok: boolean; error?: string }> };
    expect(results.every((r) => !r.ok && r.error)).toBe(true);
  });
});
