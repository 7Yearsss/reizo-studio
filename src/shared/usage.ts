export const USAGE_METRICS = ['total_tokens', 'input_tokens', 'uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'images', 'audio_seconds', 'video_seconds', 'characters'] as const;
export type UsageMetricName = typeof USAGE_METRICS[number];
export type UsageCategory = 'llm' | 'image' | 'video' | 'audio' | 'local';
export interface UsageMetric {
  metric: UsageMetricName;
  unit: 'token' | 'image' | 'second' | 'character';
  quantity: number;
  source: 'provider_reported' | 'observed_output';
}
export interface PricingSnapshot {
  id: string;
  providerId: string;
  model: string;
  category: UsageCategory;
  currency: string;
  source: string;
  effectiveAt: string;
  createdAt: string;
  rates: Array<{ metric: UsageMetricName; rate: number; perUnits: number }>;
}
export type PricingSnapshotInput = Omit<PricingSnapshot, 'createdAt' | 'id' | 'effectiveAt'> & { id?: string; effectiveAt?: string };
export interface UsageBill {
  id: string;
  executionId: string;
  amount: number;
  currency: string;
  source: string;
  reference: string;
  createdAt: string;
}
export type UsageBillInput = Omit<UsageBill, 'createdAt'>;
export interface UsageRecord {
  id: string;
  executionId: string;
  jobId?: string;
  sessionId?: string;
  sessionTitle?: string;
  jobStatus?: import('./canvasJobs').CanvasJobStatus;
  jobError?: string;
  canvasId?: string;
  nodeId?: string;
  category: UsageCategory;
  providerId: string;
  model: string;
  createdAt: string;
  metrics: UsageMetric[];
  usageState: 'reported' | 'partial' | 'observed' | 'unknown';
  reportCount: number;
  unknownReportCount: number;
  partialReportCount?: number;
  reportOutcomes?: Array<'completed' | 'incomplete' | 'failed'>;
  requestIds?: string[];
  reportedModels?: string[];
  estimate?: { amount: number; currency: string; pricingSnapshotId: string; source: string };
  estimateUnknownReason?: string;
  bill?: UsageBill;
  reconciliation: 'unreconciled' | 'bill_recorded' | 'amount_differs' | 'currency_mismatch';
}
export interface UsageSummary {
  executionCount: number;
  localCount: number;
  supplierExecutionCount: number;
  /** Remaining counters and totals cover supplier executions, excluding reliable local identities. */
  reportedCount: number;
  partialCount: number;
  observedCount: number;
  unknownCount: number;
  unreconciledCount: number;
  billedCount?: number;
  estimatedOnlyCount?: number;
  unpricedCount?: number;
  metrics: UsageMetric[];
  estimates: Array<{ currency: string; amount: number }>;
  bills: Array<{ currency: string; amount: number }>;
  warnings?: string[];
}
export interface UsagePage { records: UsageRecord[]; nextCursor?: string }
export interface UsageQuery {
  category?: UsageCategory;
  search?: string;
  from?: string;
  to?: string;
  cost?: 'billed' | 'estimated' | 'unpriced';
}
export function metricUnit(metric: UsageMetricName): UsageMetric['unit'] {
  return metric.endsWith('_tokens') ? 'token' : metric === 'images' ? 'image' : metric === 'characters' ? 'character' : 'second';
}

/** Only explicit finite provider fields are reported; missing usage never becomes a fabricated zero. */
export function providerUsageMetrics(value: unknown): UsageMetric[] {
  if (!value || typeof value !== 'object') return [];
  const normalized = value as Record<string, any>;
  // Language SDKs can normalize missing component fields to zero. Prefer their raw report.
  const usage = normalized.raw && typeof normalized.raw === 'object' && !Array.isArray(normalized.raw) ? normalized.raw : normalized;
  const number = (...values: unknown[]): number | undefined => values.find((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= Number.MAX_SAFE_INTEGER) as number | undefined;
  const input = number(usage.inputTokens, usage.input_tokens, usage.prompt_tokens);
  const output = number(usage.outputTokens, usage.output_tokens, usage.completion_tokens);
  const total = number(usage.totalTokens, usage.total_tokens);
  const cached = number(usage.inputTokenDetails?.cacheReadTokens, usage.cachedInputTokens, usage.cached_input_tokens, usage.input_tokens_details?.cached_tokens, usage.prompt_tokens_details?.cached_tokens);
  const written = number(usage.inputTokenDetails?.cacheWriteTokens, usage.cache_write_tokens, usage.input_tokens_details?.cache_write_tokens, usage.prompt_tokens_details?.cache_write_tokens);
  const uncached = number(usage.inputTokenDetails?.noCacheTokens, input !== undefined && cached !== undefined && written !== undefined && cached + written <= input ? input - cached - written : undefined);
  if (input !== undefined && (cached !== undefined && cached > input || written !== undefined && written > input || uncached !== undefined && uncached > input ||
      cached !== undefined && written !== undefined && cached + written > input || cached !== undefined && written !== undefined && uncached !== undefined && cached + written + uncached !== input) ||
    total !== undefined && (input !== undefined && input > total || output !== undefined && output > total || input !== undefined && output !== undefined && input + output !== total)) return [];
  const fields: Array<[UsageMetricName, number | undefined]> = [
    ['total_tokens', total], ['input_tokens', input], ['cached_input_tokens', cached], ['cache_write_tokens', written], ['uncached_input_tokens', uncached],
    ['output_tokens', output],
    ['images', number(usage.images)], ['audio_seconds', number(usage.audio_seconds)], ['video_seconds', number(usage.video_seconds)], ['characters', number(usage.characters)],
  ];
  return fields.filter(([metric, quantity]) => quantity !== undefined && (metricUnit(metric) === 'second' || Number.isSafeInteger(quantity)))
    .map(([metric, quantity]) => ({ metric, unit: metricUnit(metric), quantity, source: 'provider_reported' }));
}
