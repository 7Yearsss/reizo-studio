import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DbHandle } from '../db/client';
import { metricUnit, USAGE_METRICS, type PricingSnapshot, type PricingSnapshotInput, type UsageBill, type UsageBillInput, type UsageCategory, type UsageMetric, type UsagePage, type UsageRecord, type UsageSummary, type UsageQuery } from '../../../shared/usage';

interface ExecutionRow {
  id: string; execution_id: string; job_id: string | null; session_id: string | null; canvas_id: string | null; node_id: string | null;
  category: UsageCategory; provider_id: string; model: string; pricing_json: string | null; metrics_json: string;
  usage_state: UsageRecord['usageState']; report_count: number; unknown_report_count: number;
  estimate_amount: number | null; estimate_currency: string | null; estimate_reason: string | null; created_at: number;
}
interface BillRow { id: string; execution_id: string; amount: number; currency: string; source: string; reference: string; created_at: number }
export class UsageStoreError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
const currency = z.string().regex(/^[A-Z]{3}$/);
const text = z.string().trim().min(1).max(512);
const metricsSchema = z.array(z.object({ metric: z.enum(USAGE_METRICS), unit: z.enum(['token', 'image', 'second', 'character']),
  quantity: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER), source: z.enum(['provider_reported', 'observed_output']) }).strict()).max(32);
const priceSchema = z.object({ id: z.string().min(1).max(128).optional(), providerId: text, model: text,
  category: z.enum(['llm', 'image', 'video', 'audio', 'local']), currency, source: text, effectiveAt: z.string().datetime().optional(),
  rates: z.array(z.object({ metric: z.enum(USAGE_METRICS), rate: z.number().finite().min(0).max(1e12), perUnits: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).min(1).max(10) }).strict();
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UsageStoreError(result.error.message);
  return result.data;
}
// Preserve tiny nonzero estimates and exact integer counters while removing binary float noise.
const round = (value: number) => Number.isInteger(value) ? value : Number(value.toPrecision(15));

function usageFilter(options: UsageQuery) {
  const checked = parsed(z.object({ category: z.enum(['llm', 'image', 'video', 'audio', 'local']).optional(),
    search: z.string().trim().max(200).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(),
    cost: z.enum(['billed', 'estimated', 'unpriced']).optional() }), options);
  const where = ['1=1']; const args: Array<string | number> = [];
  if (checked.from && checked.to && Date.parse(checked.from) >= Date.parse(checked.to)) throw new UsageStoreError('开始时间须早于结束时间');
  if (checked.category) { where.push('e.category = ?'); args.push(checked.category); }
  if (checked.from) { where.push('e.created_at >= ?'); args.push(Date.parse(checked.from)); }
  if (checked.to) { where.push('e.created_at < ?'); args.push(Date.parse(checked.to)); }
  if (checked.search) {
    where.push(`(instr(lower(e.model || ' ' || e.provider_id || ' ' || COALESCE((SELECT title FROM sessions WHERE id = e.session_id), '')), lower(?)) > 0
      OR EXISTS (SELECT 1 FROM usage_reports r WHERE r.execution_id = e.execution_id AND instr(lower(COALESCE(r.request_id, '')), lower(?)) > 0))`);
    args.push(checked.search, checked.search);
  }
  if (checked.cost) {
    where.push("NOT (e.category = 'local' AND e.provider_id = 'local')");
    const bill = 'EXISTS (SELECT 1 FROM usage_bills b WHERE b.execution_id = e.execution_id)';
    where.push(checked.cost === 'billed' ? bill : `NOT ${bill}`);
    if (checked.cost !== 'billed') where.push(`e.estimate_amount IS ${checked.cost === 'estimated' ? 'NOT ' : ''}NULL`);
  }
  return { where, args };
}

/** Pricing snapshots and attached bill evidence are immutable; no defaults or vendor prices are invented. */
export function createUsageStore(handle: DbHandle) {
  const raw = handle.raw;
  const find = (executionId: string) => raw.prepare('SELECT * FROM usage_executions WHERE execution_id = ?').get(executionId) as unknown as ExecutionRow | undefined;
  const billFor = (executionId: string): UsageBill | undefined => {
    const row = raw.prepare('SELECT * FROM usage_bills WHERE execution_id = ?').get(executionId) as unknown as BillRow | undefined;
    return row ? { id: row.id, executionId: row.execution_id, amount: row.amount, currency: row.currency, source: row.source, reference: row.reference, createdAt: new Date(row.created_at).toISOString() } : undefined;
  };
  const record = (row: ExecutionRow): UsageRecord => {
    const session = row.session_id ? raw.prepare('SELECT title FROM sessions WHERE id = ?').get(row.session_id) as { title: string } | undefined : undefined;
    const job = row.job_id ? raw.prepare('SELECT status, error FROM canvas_jobs WHERE id = ?').get(row.job_id) as { status: UsageRecord['jobStatus']; error: string | null } | undefined : undefined;
    const pricing = row.pricing_json ? JSON.parse(row.pricing_json) as PricingSnapshot : undefined;
    const estimate = row.estimate_amount === null ? undefined : { amount: row.estimate_amount, currency: row.estimate_currency, pricingSnapshotId: pricing.id, source: pricing.source };
    const bill = billFor(row.execution_id);
    const reports = raw.prepare('SELECT request_id, reported_model, outcome, metrics_json FROM usage_reports WHERE execution_id = ?').all(row.execution_id) as { request_id: string | null; reported_model: string | null; outcome: 'completed' | 'incomplete' | 'failed' | null; metrics_json: string }[];
    const requestIds = [...new Set(reports.map((report) => report.request_id).filter(Boolean))];
    const reportedModels = [...new Set(reports.map((report) => report.reported_model).filter(Boolean))];
    const reportOutcomes = [...new Set(reports.map((report) => report.outcome).filter(Boolean))];
    const partialReportCount = reports.filter((report) => {
      const metrics = JSON.parse(report.metrics_json) as UsageMetric[];
      return metrics.some((metric) => metric.source === 'provider_reported') && (report.outcome === 'incomplete' || report.outcome === 'failed' ||
        row.category === 'llm' && !['input_tokens', 'output_tokens'].every((name) => metrics.some((metric) => metric.metric === name)));
    }).length;
    return { id: row.id, executionId: row.execution_id, ...(row.job_id ? { jobId: row.job_id } : {}), ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(session ? { sessionTitle: session.title } : {}), ...(job ? { jobStatus: job.status, ...(job.error ? { jobError: job.error } : {}) } : {}),
      ...(row.canvas_id ? { canvasId: row.canvas_id } : {}), ...(row.node_id ? { nodeId: row.node_id } : {}), category: row.category, providerId: row.provider_id, model: row.model,
      createdAt: new Date(row.created_at).toISOString(), metrics: JSON.parse(row.metrics_json), usageState: row.usage_state, reportCount: row.report_count, unknownReportCount: row.unknown_report_count,
      ...(requestIds.length ? { requestIds } : {}), ...(reportedModels.length ? { reportedModels } : {}),
      partialReportCount, ...(reportOutcomes.length ? { reportOutcomes } : {}),
      ...(estimate ? { estimate } : {}), ...(row.estimate_reason ? { estimateUnknownReason: row.estimate_reason } : {}), ...(bill ? { bill } : {}),
      reconciliation: !bill ? 'unreconciled' : estimate && bill.currency !== estimate.currency ? 'currency_mismatch'
        : estimate && Math.abs(bill.amount - estimate.amount) > 1e-8 ? 'amount_differs' : 'bill_recorded' };
  };
  function recompute(executionId: string) {
    const execution = find(executionId);
    if (!execution) throw new UsageStoreError('用量记录不存在', 404);
    const reports = raw.prepare('SELECT metrics_json, outcome FROM usage_reports WHERE execution_id = ?').all(executionId) as { metrics_json: string; outcome: string | null }[];
    const totals = new Map<string, UsageMetric>(); const unsafeTotals = new Set<string>(); let unknown = 0;
    const values = reports.map((row) => JSON.parse(row.metrics_json) as UsageMetric[]);
    for (const metrics of values) {
      if (!metrics.length) unknown++;
      for (const metric of metrics) {
        const key = `${metric.metric}:${metric.source}`; const current = totals.get(key);
        if (unsafeTotals.has(key)) continue;
        const quantity = (current?.quantity ?? 0) + metric.quantity;
        if (!Number.isFinite(quantity) || quantity > Number.MAX_SAFE_INTEGER || metric.unit !== 'second' && !Number.isSafeInteger(quantity)) {
          totals.delete(key); unsafeTotals.add(key); continue;
        }
        totals.set(key, { ...metric, quantity: round(quantity) });
      }
    }
    const metrics = [...totals.values()];
    const reported = metrics.some((metric) => metric.source === 'provider_reported');
    const partial = unknown > 0 || unsafeTotals.size > 0 || reports.some((report, index) => values[index].some((metric) => metric.source === 'provider_reported') &&
      (report.outcome === 'incomplete' || report.outcome === 'failed' || execution.category === 'llm' && !['input_tokens', 'output_tokens'].every((name) => values[index].some((metric) => metric.metric === name))));
    const state = reported ? partial ? 'partial' : 'reported' : metrics.length ? 'observed' : 'unknown';
    const pricing = execution.pricing_json ? JSON.parse(execution.pricing_json) as PricingSnapshot : undefined;
    let amount: number | null = null;
    let reason = !pricing ? '未设置明确价格快照' : '供应商未报告完整计费用量';
    if (pricing && values.length && values.every((metrics) => pricing.rates.every((rate) => metrics.some((metric) => metric.metric === rate.metric)))) {
      amount = round(values.reduce((total, metrics) => total + pricing.rates.reduce((value, rate) => {
        // A provider-reported quantity takes precedence over observing the same output metric.
        const quantity = metrics.find((metric) => metric.metric === rate.metric && metric.source === 'provider_reported') ?? metrics.find((metric) => metric.metric === rate.metric);
        return value + quantity.quantity * rate.rate / rate.perUnits;
      }, 0), 0));
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) { amount = null; reason = '计费用量超出安全计算范围'; }
    }
    raw.prepare(`UPDATE usage_executions SET metrics_json = ?, usage_state = ?, report_count = ?, unknown_report_count = ?,
      estimate_amount = ?, estimate_currency = ?, estimate_reason = ? WHERE execution_id = ?`).run(
      JSON.stringify(metrics), state, values.length, unknown, amount, amount === null ? null : pricing.currency, amount === null ? reason : null, executionId);
  }

  return {
    ensure(input: { executionId: string; category: UsageCategory; providerId: string; model: string; jobId?: string; sessionId?: string; canvasId?: string; nodeId?: string; createdAt?: number }) {
      for (const value of [input.executionId, input.providerId, input.model]) if (!value?.trim() || value.length > 512) throw new UsageStoreError('用量执行身份无效');
      const existing = find(input.executionId);
      if (existing) {
        if (existing.provider_id !== input.providerId || existing.model !== input.model || existing.category !== input.category || existing.job_id !== (input.jobId ?? null))
          throw new UsageStoreError('该执行身份已用于其他供应商或模型', 409);
        return record(existing);
      }
      const createdAt = input.createdAt ?? Date.now();
      const pricing = raw.prepare('SELECT snapshot_json FROM usage_pricing WHERE provider_id = ? AND model = ? AND category = ? AND effective_at <= ? ORDER BY effective_at DESC, created_at DESC, id DESC LIMIT 1')
        .get(input.providerId, input.model, input.category, createdAt) as { snapshot_json: string } | undefined;
      raw.prepare(`INSERT INTO usage_executions (id, execution_id, job_id, session_id, canvas_id, node_id, category, provider_id, model,
        pricing_json, metrics_json, usage_state, report_count, unknown_report_count, estimate_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'unknown', 0, 0, ?, ?)`).run(
        nanoid(), input.executionId, input.jobId ?? null, input.sessionId ?? null, input.canvasId ?? null, input.nodeId ?? null, input.category, input.providerId, input.model,
        pricing?.snapshot_json ?? null, pricing ? '供应商未报告完整计费用量' : '未设置明确价格快照', createdAt);
      return record(find(input.executionId));
    },
    setReport(executionId: string, reportId: string, metrics: UsageMetric[], metadata: { requestId?: string; reportedModel?: string; outcome?: 'completed' | 'incomplete' | 'failed' } = {}) {
      if (!reportId?.trim() || reportId.length > 256) throw new UsageStoreError('供应商报告身份无效');
      const checked = parsed(metricsSchema, metrics);
      if (checked.some((metric) => metric.unit !== metricUnit(metric.metric) || metric.unit !== 'second' && !Number.isSafeInteger(metric.quantity)) || new Set(checked.map((metric) => `${metric.metric}:${metric.source}`)).size !== checked.length)
        throw new UsageStoreError('计量单位无效或报告重复');
      if (!find(executionId)) throw new UsageStoreError('用量记录不存在', 404);
      for (const value of Object.values(metadata)) if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 512)) throw new UsageStoreError('供应商报告元数据无效');
      if (metadata.outcome && !['completed', 'incomplete', 'failed'].includes(metadata.outcome)) throw new UsageStoreError('供应商报告终态无效');
      raw.exec('SAVEPOINT usage_report');
      try {
        raw.prepare(`INSERT INTO usage_reports (execution_id, report_id, metrics_json, request_id, reported_model, outcome, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(execution_id, report_id) DO UPDATE SET metrics_json = excluded.metrics_json, request_id = COALESCE(excluded.request_id, request_id),
          reported_model = COALESCE(excluded.reported_model, reported_model), outcome = COALESCE(excluded.outcome, outcome), updated_at = excluded.updated_at`)
          .run(executionId, reportId, JSON.stringify(checked), metadata.requestId ?? null, metadata.reportedModel ?? null, metadata.outcome ?? null, Date.now());
        recompute(executionId); raw.exec('RELEASE SAVEPOINT usage_report');
      } catch (error) { raw.exec('ROLLBACK TO SAVEPOINT usage_report'); raw.exec('RELEASE SAVEPOINT usage_report'); throw error; }
    },
    get(executionId: string) { const row = find(executionId); return row ? record(row) : null; },
    list(options: UsageQuery & { jobId?: string; limit?: number; cursor?: string } = {}): UsagePage {
      const limit = options.limit ?? 40;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageStoreError('用量分页上限为 100');
      const { where, args } = usageFilter(options);
      if (options.jobId) { where.push('e.job_id = ?'); args.push(options.jobId); }
      if (options.cursor) {
        let cursor: [number, string];
        try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')); } catch { throw new UsageStoreError('用量分页游标无效'); }
        if (!Array.isArray(cursor) || !Number.isSafeInteger(cursor[0]) || typeof cursor[1] !== 'string') throw new UsageStoreError('用量分页游标无效');
        where.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))'); args.push(cursor[0], cursor[0], cursor[1]);
      }
      const rows = raw.prepare(`SELECT e.* FROM usage_executions e WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`).all(...args, limit + 1) as unknown as ExecutionRow[];
      const visible = rows.slice(0, limit); const last = visible.at(-1);
      return { records: visible.map(record), ...(rows.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') } : {}) };
    },
    summary(options: UsageQuery = {}): UsageSummary {
      const { where, args } = usageFilter(options);
      const prefix = `WITH filtered AS (SELECT e.* FROM usage_executions e WHERE ${where.join(' AND ')}) `;
      const supplier = "NOT (category = 'local' AND provider_id = 'local')";
      const executionCount = (raw.prepare(prefix + 'SELECT COUNT(*) AS count FROM filtered').get(...args) as { count: number }).count;
      const row = raw.prepare(prefix + `SELECT COUNT(*) AS executionCount, SUM(usage_state = 'reported') AS reportedCount, SUM(usage_state = 'partial') AS partialCount, SUM(usage_state = 'observed') AS observedCount,
        SUM(usage_state = 'unknown') AS unknownCount, SUM(NOT EXISTS(SELECT 1 FROM usage_bills b WHERE b.execution_id = e.execution_id)) AS unreconciledCount,
        SUM(EXISTS(SELECT 1 FROM usage_bills b WHERE b.execution_id = e.execution_id)) AS billedCount,
        SUM(estimate_amount IS NOT NULL AND NOT EXISTS(SELECT 1 FROM usage_bills b WHERE b.execution_id = e.execution_id)) AS estimatedOnlyCount,
        SUM(estimate_amount IS NULL AND NOT EXISTS(SELECT 1 FROM usage_bills b WHERE b.execution_id = e.execution_id)) AS unpricedCount
        FROM filtered e WHERE ${supplier}`).get(...args) as Record<string, number>;
      const metricRows = raw.prepare(prefix + `SELECT json_extract(m.value, '$.metric') AS metric, json_extract(m.value, '$.unit') AS unit,
        json_extract(m.value, '$.source') AS source, SUM(json_extract(m.value, '$.quantity')) AS quantity
        FROM filtered, json_each(metrics_json) m WHERE ${supplier} GROUP BY metric, unit, source`).all(...args) as unknown as UsageMetric[];
      const warnings: string[] = [];
      const money = (table: 'usage_executions' | 'usage_bills', amount: string, currency: string) => (raw.prepare(prefix + `SELECT ${currency} AS currency, SUM(${amount}) AS amount FROM ${table} WHERE ${amount} IS NOT NULL AND execution_id IN (SELECT execution_id FROM filtered WHERE ${supplier}) GROUP BY ${currency}`).all(...args) as { currency: string; amount: number }[])
        .filter((value) => { const valid = Number.isFinite(value.amount) && Math.abs(value.amount) <= 1e12; if (!valid) warnings.push(`${value.currency} 合计超出安全计算范围，需人工核对`); return valid; }).map((value) => ({ ...value, amount: round(value.amount) }));
      const metrics = metricRows.filter((metric) => { const valid = typeof metric.quantity === 'number' && Number.isFinite(metric.quantity) && metric.quantity <= Number.MAX_SAFE_INTEGER;
        if (!valid) warnings.push('计量合计超出安全计算范围，需人工复核'); return valid; });
      const estimates = money('usage_executions', 'estimate_amount', 'estimate_currency'); const bills = money('usage_bills', 'amount', 'currency');
      return { executionCount, localCount: executionCount - row.executionCount, supplierExecutionCount: row.executionCount, reportedCount: row.reportedCount ?? 0, partialCount: row.partialCount ?? 0, observedCount: row.observedCount ?? 0, unknownCount: row.unknownCount ?? 0,
        billedCount: row.billedCount ?? 0, estimatedOnlyCount: row.estimatedOnlyCount ?? 0, unpricedCount: row.unpricedCount ?? 0,
        unreconciledCount: row.unreconciledCount ?? 0, metrics, estimates, bills, ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}) };
    },
    prices(): PricingSnapshot[] { return (raw.prepare('SELECT snapshot_json FROM usage_pricing ORDER BY effective_at DESC, created_at DESC').all() as { snapshot_json: string }[]).map((row) => JSON.parse(row.snapshot_json)); },
    createPrice(input: PricingSnapshotInput): PricingSnapshot {
      const checked = parsed(priceSchema, input);
      const keys = new Set(checked.rates.map((rate) => rate.metric));
      if (keys.size !== checked.rates.length || keys.has('total_tokens') && checked.rates.some((rate) => rate.metric !== 'total_tokens' && rate.metric.endsWith('_tokens')) ||
        keys.has('input_tokens') && (keys.has('uncached_input_tokens') || keys.has('cached_input_tokens') || keys.has('cache_write_tokens')))
        throw new UsageStoreError('价格计量项重复或包含重叠的输入 token');
      const createdAt = Date.now();
      const value: PricingSnapshot = { ...checked, id: checked.id ?? nanoid(), effectiveAt: checked.effectiveAt ?? new Date(createdAt).toISOString(), createdAt: new Date(createdAt).toISOString() };
      const previous = raw.prepare('SELECT snapshot_json FROM usage_pricing WHERE id = ?').get(value.id) as { snapshot_json: string } | undefined;
      if (previous) {
        const snapshot = JSON.parse(previous.snapshot_json) as PricingSnapshot;
        if (snapshot.providerId !== value.providerId || snapshot.model !== value.model || snapshot.category !== value.category || snapshot.currency !== value.currency || snapshot.source !== value.source ||
          checked.effectiveAt && checked.effectiveAt !== snapshot.effectiveAt || JSON.stringify(snapshot.rates) !== JSON.stringify(value.rates))
          throw new UsageStoreError('价格快照 ID 已存在；请创建新的价格版本', 409);
        return snapshot;
      }
      raw.prepare('INSERT INTO usage_pricing (id, provider_id, model, category, effective_at, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(value.id, value.providerId, value.model, value.category, Date.parse(value.effectiveAt), JSON.stringify(value), createdAt);
      return value;
    },
    recordBill(input: UsageBillInput): UsageRecord {
      const checked = parsed(z.object({ id: text, executionId: text, amount: z.number().finite().min(0).max(1e12), currency, source: text, reference: text }).strict(), input);
      if (!find(checked.executionId)) throw new UsageStoreError('账单目标用量记录不存在', 404);
      const previous = raw.prepare('SELECT * FROM usage_bills WHERE id = ? OR execution_id = ? OR (source = ? AND reference = ?)')
        .get(checked.id, checked.executionId, checked.source, checked.reference) as unknown as BillRow | undefined;
      if (previous) {
        if (previous.id !== checked.id || previous.execution_id !== checked.executionId || previous.amount !== checked.amount || previous.currency !== checked.currency || previous.source !== checked.source || previous.reference !== checked.reference)
          throw new UsageStoreError('该账单或执行已有关联记录，不能重复记账', 409);
        return record(find(checked.executionId));
      }
      raw.prepare('INSERT INTO usage_bills (id, execution_id, amount, currency, source, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(checked.id, checked.executionId, checked.amount, checked.currency, checked.source, checked.reference, Date.now());
      return record(find(checked.executionId));
    },
  };
}
export type UsageStore = ReturnType<typeof createUsageStore>;
