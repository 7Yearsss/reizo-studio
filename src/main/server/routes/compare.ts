import { Hono } from 'hono';
import { MAX_COMPARE_PROMPT, parseCompareTargets, type CompareResult } from '../../../shared/compare';

/** Ask one model; throws on any failure (no key, bad model, provider error). */
export type GenerateOnce = (target: { providerId: string; model: string }, prompt: string, signal?: AbortSignal) => Promise<string>;

/**
 * Same question to 2–4 models at once, answers returned side by side. Plain completions: no tools, no conversation
 * history, no memory, so the comparison is about the models and nothing else. One model failing never blocks the rest.
 */
export function createCompareRouter(generate: GenerateOnce) {
  const router = new Hono();
  router.post('/', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as { text?: unknown; targets?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json({ error: '请输入要比较的问题' }, 400);
    if (text.length > MAX_COMPARE_PROMPT) return c.json({ error: `问题太长（超过 ${MAX_COMPARE_PROMPT} 字）` }, 413);
    const targets = parseCompareTargets(body?.targets);
    if (!targets) return c.json({ error: '请选择 2–4 个不同的模型' }, 400);
    const signal = AbortSignal.timeout(120_000);
    const results: CompareResult[] = await Promise.all(targets.map(async (target): Promise<CompareResult> => {
      const started = Date.now();
      try {
        const answer = (await generate(target, text, signal)).trim();
        return { ...target, ok: Boolean(answer), text: answer, ...(answer ? {} : { error: '模型没有返回内容' }), ms: Date.now() - started };
      } catch (error) {
        return { ...target, ok: false, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
      }
    }));
    return c.json({ results });
  });
  return router;
}
