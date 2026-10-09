import { expect, it } from 'vitest';
import { openDb } from '../../db/client';
import { createUsageStore } from '../../storage/usageStore';
import { createGenerationScheduler } from '../../canvas/generationScheduler';
import { quotaFetch } from './quotaFetch';
import { usageFetch } from './usageFetch';

it('keeps streaming permits until consumption, persists only final counters once, and keeps cancelled usage unknown', async () => {
  const handle = openDb(':memory:'); const usage = createUsageStore(handle);
  const scheduler = createGenerationScheduler({ globalLimit: 1, providerLimit: 1 });
  try {
    let controller: ReadableStreamDefaultController<Uint8Array>; let calls = 0;
    const measured = usageFetch(usage, { providerId: 'fixture', model: 'fixture-model', category: 'llm' }, async () => {
      calls++;
      if (calls === 2) return new Response(JSON.stringify({ id: 'response-two', model: 'reported-model', usage: { prompt_tokens: 2, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
      return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': `request-${calls}` } });
    });
    const send = quotaFetch(scheduler, 'fixture', measured);
    const first = await send('https://fixture.invalid');
    const pending = send('https://fixture.invalid');
    await Promise.resolve(); expect(calls).toBe(1);
    expect(usage.summary().unknownCount).toBe(1);
    const encoder = new TextEncoder();
    const frame = (input: number, output: number) => `data: ${JSON.stringify({ id: 'response-one', model: 'reported-model', choices: [], usage: { prompt_tokens: input, completion_tokens: output }, private: 'private-response-text' })}\n\n`;
    const bytes = frame(10, 1) + frame(100, 20) + 'data: [DONE]\n\n';
    controller.enqueue(encoder.encode(bytes)); controller.close();
    expect(await first.text()).toBe(bytes);
    await (await pending).text();
    const records = usage.list().records;
    const reported = records.find((record) => record.requestIds?.includes('request-1'));
    expect(reported).toMatchObject({ usageState: 'reported', reportCount: 1, unknownReportCount: 0, reportedModels: ['reported-model'] });
    expect(reported.metrics.find((metric) => metric.metric === 'input_tokens').quantity).toBe(100);
    expect(reported.estimate).toBeUndefined();
    const cancelled = await send('https://fixture.invalid');
    controller.enqueue(encoder.encode(frame(999, 99)));
    await cancelled.body.cancel();
    const record = usage.list().records.find((record) => record.requestIds?.includes('request-3'));
    expect(record).toMatchObject({ usageState: 'unknown', unknownReportCount: 1, metrics: [] });
    const failed = await send('https://fixture.invalid');
    const failedBytes = 'data: null\n\ndata: {"response":null}\n\n' + frame(777, 77) +
      'data: {"error":{"message":"failed"},"usage":{"prompt_tokens":999,"completion_tokens":99}}\n\ndata: [DONE]\n\n';
    controller.enqueue(encoder.encode(failedBytes)); controller.close();
    expect(await failed.text()).toBe(failedBytes);
    expect(usage.list().records.find((value) => value.requestIds?.includes('request-4'))).toMatchObject({ usageState: 'unknown', metrics: [], reportOutcomes: ['failed'] });
    const incomplete = await send('https://fixture.invalid');
    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.incomplete', response: { id: 'incomplete-id', object: 'response', status: 'incomplete',
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } } }) + '\n\n')); controller.close();
    await incomplete.text();
    expect(usage.list().records.find((value) => value.requestIds?.includes('request-5'))).toMatchObject({ usageState: 'partial', partialReportCount: 1, reportOutcomes: ['incomplete'] });
    const inconsistent = await send('https://fixture.invalid');
    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [], usage: { input_tokens: 10, cached_input_tokens: 100, output_tokens: 2, total_tokens: 12 } }) + '\n\ndata: [DONE]\n\n')); controller.close();
    await inconsistent.text();
    expect(usage.list().records.find((value) => value.requestIds?.includes('request-6'))).toMatchObject({ usageState: 'unknown', metrics: [] });
    expect(JSON.stringify(handle.raw.prepare('SELECT * FROM usage_reports').all())).not.toContain('private-response-text');
  } finally { scheduler.shutdown(); handle.close(); }
});
