import type { UsageMetric, UsageMetricName, UsageRecord } from '../../../shared/usage';

export const metricLabels: Record<UsageMetricName, string> = {
  total_tokens: '总 Token（与拆分项重叠）',
  input_tokens: '输入 Token 总数', uncached_input_tokens: '未缓存输入 Token', cached_input_tokens: '缓存读取 Token', cache_write_tokens: '缓存写入 Token',
  output_tokens: '输出 Token', images: '图片', audio_seconds: '音频时长', video_seconds: '视频时长', characters: '字符',
};
export const categoryLabels = { llm: '对话', image: '图片', video: '视频', audio: '音频', local: '本地' };
export const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString('zh-CN', { maximumSignificantDigits: 15 })}`;
export const identity = (value?: string) => !value || value === 'unknown' ? '未知' : value;
export const isLocalPresentationUsage = (record: Pick<UsageRecord, 'providerId' | 'model'>) => record.providerId === 'local' && record.model === 'pptxgenjs-4.0.1';
export const isLocalUsage = (record: Pick<UsageRecord, 'category' | 'providerId'>) => record.category === 'local' && record.providerId === 'local';
export const reconciliationLabels: Record<UsageRecord['reconciliation'], string> = {
  unreconciled: '未与账单核对', bill_recorded: '已录入账单金额', amount_differs: '估算与账单金额不同', currency_mismatch: '币种不同，无法比较',
};

export function MetricList({ metrics }: { metrics: UsageMetric[] }) {
  return <dl className="flex flex-col gap-2">{metrics.map((item) => <div key={`${item.metric}:${item.source}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs">
    <dt className="text-ink-muted">{metricLabels[item.metric]}<span className="ml-1">（{item.source === 'provider_reported' ? '供应商报告' : '观察产物'}）</span></dt>
    <dd className="tabular-nums text-ink">{item.quantity.toLocaleString('zh-CN', { maximumSignificantDigits: 15 })}{item.unit === 'second' ? ' 秒' : item.unit === 'image' ? ' 张' : item.unit === 'character' ? ' 字符' : ''}</dd>
  </div>)}</dl>;
}

export default function UsageRecordDetails({ record, compact = false }: { record: UsageRecord; compact?: boolean }) {
  const localExport = isLocalUsage(record);
  return <div className="flex min-w-0 flex-col gap-3 text-xs leading-relaxed">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-ink-muted">{localExport ? '执行环境' : '实际供应商'}</dt><dd className="select-text text-ink [overflow-wrap:anywhere]">{identity(record.providerId)}</dd>
      <dt className="text-ink-muted">{localExport ? '本地执行器' : '提交模型'}</dt><dd className="select-text text-ink [overflow-wrap:anywhere]">{identity(record.model)}</dd>
      {record.reportedModels?.length ? <><dt className="text-ink-muted">报告模型</dt><dd className="select-text text-ink [overflow-wrap:anywhere]">{record.reportedModels.join('，')}</dd></> : null}
    </dl>
    <p className="text-ink-muted">{localExport ? `${isLocalPresentationUsage(record) ? '本地 PPTX 导出' : '本地执行'}，无供应商生成调用，无需供应商用量报告或账单核对。` : <>{record.usageState === 'reported' ? '已有供应商报告用量' : record.usageState === 'partial' ? '供应商仅提供部分报告，不能视为完整计费用量' : record.usageState === 'observed' ? '仅有观察到的产物用量，供应商未报告计费用量' : '用量未知'}{record.unknownReportCount ? `；${record.unknownReportCount} 份报告未提供用量` : ''}{record.partialReportCount ? `；${record.partialReportCount} 份报告不完整` : ''}</>}</p>
    {record.reportOutcomes?.length ? <p className="text-ink-muted">报告终态：{record.reportOutcomes.map((outcome) => outcome === 'completed' ? '已完成' : outcome === 'incomplete' ? '未完成' : '失败').join('，')}</p> : null}
    {record.metrics.length ? <MetricList metrics={record.metrics} /> : null}
    {record.metrics.some((metric) => metric.metric === 'total_tokens') || record.metrics.some((metric) => metric.metric === 'input_tokens') && record.metrics.some((metric) => ['cached_input_tokens', 'uncached_input_tokens', 'cache_write_tokens'].includes(metric.metric)) ? <p className="text-ink-muted">Token 总数和拆分项分别展示，未相加。</p> : null}
    {!localExport ? <div className="flex flex-col gap-1 text-ink">
      <p>估算：{record.estimate ? money(record.estimate.amount, record.estimate.currency) : '未知'}</p>
      <p className="select-text text-ink-muted [overflow-wrap:anywhere]">{record.estimate ? `价格来源：${record.estimate.source}` : record.estimateUnknownReason || '没有可用价格或计费用量'}</p>
      {record.estimate && !compact ? <p className="select-text text-ink-muted [overflow-wrap:anywhere]">价格快照：{record.estimate.pricingSnapshotId}</p> : null}
      <p>账单金额：{record.bill ? money(record.bill.amount, record.bill.currency) : '未知'}</p>
      <p className="text-ink-muted">{reconciliationLabels[record.reconciliation]}</p>
      {record.bill ? <p className="select-text text-ink-muted [overflow-wrap:anywhere]">人工录入来源：{record.bill.source}；凭据：{record.bill.reference}</p> : null}
    </div> : record.estimate || record.bill ? <div className="select-text text-ink-muted [overflow-wrap:anywhere]">{record.estimate ? <p>已有价格记录估算：{money(record.estimate.amount, record.estimate.currency)}；来源：{record.estimate.source}</p> : null}{record.bill ? <p>已有人工账单记录：{money(record.bill.amount, record.bill.currency)}；来源：{record.bill.source}；凭据：{record.bill.reference}</p> : null}<p>保留历史录入依据，不计入供应商执行费用。</p></div> : null}
    {!compact ? <details><summary className="w-fit cursor-pointer rounded text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">执行标识</summary><p className="mt-1 select-text text-ink-muted [overflow-wrap:anywhere]">{record.executionId}</p>{record.requestIds?.length ? <p className="mt-1 select-text text-ink-muted [overflow-wrap:anywhere]">请求：{record.requestIds.join('，')}</p> : null}</details> : null}
  </div>;
}
