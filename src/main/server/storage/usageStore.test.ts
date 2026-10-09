import { expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createUsageStore } from './usageStore';
import { providerUsageMetrics } from '../../../shared/usage';

it('keeps final reported counters, frozen explicit estimates and bill evidence distinct; missing reports stay unknown', () => {
  const handle = openDb(':memory:'); const usage = createUsageStore(handle);
  try {
    const price = { id: 'fixture-price', providerId: 'fixture-provider', model: 'fixture-model', category: 'llm' as const, currency: 'USD', source: 'fixture rate sheet',
      rates: [{ metric: 'input_tokens' as const, rate: 2, perUnits: 1_000 }, { metric: 'output_tokens' as const, rate: 6, perUnits: 1_000 }] };
    const snapshot = usage.createPrice(price);
    expect(usage.createPrice(price)).toEqual(snapshot);
    usage.ensure({ executionId: 'first', category: 'llm', providerId: price.providerId, model: price.model });
    usage.setReport('first', 'request-one', []);
    expect(usage.get('first').estimate).toBeUndefined();
    expect(usage.get('first').usageState).toBe('unknown');
    usage.setReport('first', 'request-one', providerUsageMetrics({ input_tokens: 100, output_tokens: 20, secret: 'private-body' }), { requestId: 'actual-request' });
    usage.setReport('first', 'request-one', providerUsageMetrics({ input_tokens: 200, output_tokens: 30 }), { requestId: 'actual-request' });
    expect(usage.get('first')).toMatchObject({ reportCount: 1, usageState: 'reported', estimate: { amount: 0.58, currency: 'USD', pricingSnapshotId: snapshot.id }, reconciliation: 'unreconciled' });
    usage.createPrice({ ...price, id: 'new-price', rates: [{ metric: 'input_tokens', rate: 100, perUnits: 1_000 }] });
    usage.setReport('first', 'request-one', providerUsageMetrics({ input_tokens: 200, output_tokens: 30 }));
    expect(usage.get('first').estimate.amount).toBe(0.58);
    const bill = { id: 'fixture-bill', executionId: 'first', amount: 0.65, currency: 'USD', source: 'fixture invoice', reference: 'invoice#request-one' };
    expect(usage.recordBill(bill)).toMatchObject({ reconciliation: 'amount_differs', bill: { amount: 0.65 }, estimate: { amount: 0.58 } });
    expect(usage.recordBill(bill).bill.id).toBe(bill.id);
    expect(() => usage.recordBill({ ...bill, id: 'duplicate' })).toThrow('重复记账');
    usage.ensure({ executionId: 'unknown', category: 'audio', providerId: 'unpriced', model: 'unreported' });
    usage.setReport('unknown', 'uncertain-request', []);
    expect(() => usage.setReport('unknown', 'uncertain-request', [{ metric: 'audio_seconds', unit: 'second', quantity: 1e300, source: 'provider_reported' }])).toThrow();
    expect(() => usage.recordBill({ ...bill, id: 'overflow', executionId: 'unknown', amount: 1e300 })).toThrow();
    expect(usage.get('unknown')).toMatchObject({ usageState: 'unknown', metrics: [] });
    expect(providerUsageMetrics({ input_tokens: 10, output_tokens: 2, total_tokens: 30 })).toEqual([]);
    expect(providerUsageMetrics({ input_tokens: 10, input_tokens_details: { cached_tokens: 9, cache_write_tokens: 2 } })).toEqual([]);
    expect(() => usage.recordBill({ ...bill, id: 'duplicate-evidence', executionId: 'unknown' })).toThrow('重复记账');
    usage.recordBill({ id: 'eur-bill', executionId: 'unknown', amount: 3, currency: 'EUR', source: 'fixture invoice', reference: 'invoice#unknown' });
    expect(usage.get('unknown')).toMatchObject({ usageState: 'unknown', reconciliation: 'bill_recorded' });
    expect(usage.get('unknown').estimate).toBeUndefined();
    const summary = usage.summary();
    expect(summary.estimates).toEqual([{ currency: 'USD', amount: 0.58 }]);
    expect(summary.bills).toEqual([{ currency: 'EUR', amount: 3 }, { currency: 'USD', amount: 0.65 }]);
    expect(summary.unknownCount).toBe(1);
    expect(summary.metrics.find((metric) => metric.metric === 'input_tokens').quantity).toBe(200);
    usage.ensure({ executionId: 'local-export', category: 'local', providerId: 'local', model: 'pptxgenjs-4.0.1' });
    expect(usage.summary()).toMatchObject({ executionCount: 3, localCount: 1, supplierExecutionCount: 2, unknownCount: 1, unreconciledCount: 0,
      estimates: summary.estimates, bills: summary.bills, metrics: summary.metrics });
    expect(JSON.stringify(handle.raw.prepare('SELECT * FROM usage_reports').all())).not.toContain('private-body');
    expect(() => usage.createPrice({ ...price, id: 'overlapping-price', rates: [{ metric: 'input_tokens', rate: 1, perUnits: 1 }, { metric: 'cached_input_tokens', rate: 1, perUnits: 1 }] })).toThrow('重叠');
    usage.createPrice({ ...price, id: 'tiny-price', category: 'image', rates: [{ metric: 'images', rate: 1e-12, perUnits: 1 }] });
    usage.ensure({ executionId: 'tiny-image', category: 'image', providerId: price.providerId, model: price.model });
    usage.setReport('tiny-image', 'output', [{ metric: 'images', unit: 'image', quantity: 1, source: 'observed_output' }]);
    expect(usage.get('tiny-image').estimate.amount).toBe(1e-12);
  } finally { handle.close(); }
});
