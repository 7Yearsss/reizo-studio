import { expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createUsageStore } from '../storage/usageStore';
import { createUsageRouter } from './usage';
import { providerUsageMetrics } from '../../../shared/usage';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';

it('filters all records and totals consistently, preserves zero bills, and pages within the same query', async () => {
  const handle = openDb(':memory:'); const usage = createUsageStore(handle); const app = createUsageRouter(handle);
  try {
    const time = Date.parse('2026-10-24T04:00:00Z');
    usage.createPrice({ providerId: 'account', model: 'priced', category: 'image', currency: 'USD', source: 'invoice rates',
      effectiveAt: '2026-10-23T00:00:00Z', rates: [{ metric: 'images', rate: 0.2, perUnits: 1 }] });
    for (let i = 0; i < 45; i++) {
      usage.ensure({ executionId: `image-${i}`, providerId: 'account', model: 'priced', category: 'image', createdAt: time + i });
      usage.setReport(`image-${i}`, 'report', [{ metric: 'images', unit: 'image', quantity: 1, source: 'provider_reported' }], { requestId: `request-${i}` });
    }
    usage.recordBill({ id: 'zero', executionId: 'image-0', amount: 0, currency: 'CNY', source: 'invoice', reference: 'waived-item' });
    usage.ensure({ executionId: 'older', providerId: 'account', model: 'unpriced', category: 'image', createdAt: time - 86400_000 });
    usage.ensure({ executionId: 'text', providerId: 'manual', model: 'chat', category: 'llm', createdAt: time });
    usage.setReport('text', 'report', providerUsageMetrics({ input_tokens: 100, output_tokens: 20 }));
    usage.ensure({ executionId: 'local', providerId: 'local', model: 'export', category: 'local', createdAt: time });
    const filter = 'category=image&from=2026-10-24T00%3A00%3A00Z&cost=estimated';
    const first = await (await app.request(`/records?${filter}&limit=1`)).json();
    const second = await (await app.request(`/records?${filter}&limit=1&cursor=${first.nextCursor}`)).json();
    expect(first.records).toHaveLength(1); expect(second.records[0].id).not.toBe(first.records[0].id);
    const summary = await (await app.request(`/summary?${filter}`)).json();
    expect(summary).toMatchObject({ executionCount: 44, supplierExecutionCount: 44, estimatedOnlyCount: 44, billedCount: 0, unpricedCount: 0, estimates: [{ currency: 'USD', amount: 8.8 }] });
    const billed = await (await app.request('/summary?cost=billed')).json();
    expect(billed).toMatchObject({ executionCount: 1, bills: [{ currency: 'CNY', amount: 0 }] });
    expect(usage.summary({ cost: 'unpriced' }).executionCount).toBe(2);
    expect(usage.list({ search: 'request-0' }).records[0].executionId).toBe('image-0');
    expect(usage.summary({ search: "' OR 1=1 --" }).executionCount).toBe(0);
    for (const params of ['category=bogus', 'from=invalid', 'cost=paid', 'from=2026-10-25T00:00:00Z&to=2026-10-24T00:00:00Z']) {
      expect((await app.request(`/records?${params}`)).status).toBe(400);
      expect((await app.request(`/summary?${params}`)).status).toBe(400);
    }
  } finally { handle.close(); }
});

it('includes real job status and session title without inferring success from reported usage', async () => {
  const handle = openDb(':memory:'); const usage = createUsageStore(handle);
  try {
    const session = await createSqliteSessionStore(handle).create('雨夜车辆', null, null);
    const canvas = createCanvasStore(handle); const canvasId = canvas.ensureCanvas(session.id).id;
    const node = canvas.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: {} }).node;
    const job = canvas.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: {} });
    canvas.jobs.markSubmitted(job.id, { providerId: 'account', model: 'image' });
    canvas.jobs.finish(job.id, 'failed', { error: 'no channel' });
    usage.setReport(`job:${job.id}`, 'report', [{ metric: 'images', unit: 'image', quantity: 1, source: 'provider_reported' }]);
    expect(usage.list({ search: '雨夜' }).records[0]).toMatchObject({ sessionTitle: '雨夜车辆', jobStatus: 'failed', jobError: 'no channel', usageState: 'reported' });
    expect(usage.summary({ search: '雨夜' }).executionCount).toBe(1);
  } finally { handle.close(); }
});
