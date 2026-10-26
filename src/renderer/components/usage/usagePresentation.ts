import type { UsageMetric, UsageMetricName, UsageRecord } from '../../../shared/usage';

export function metricValue(metrics: UsageMetric[], name: UsageMetricName): UsageMetric | undefined {
  return metrics.find(item => item.metric === name && item.source === 'provider_reported') ?? metrics.find(item => item.metric === name);
}

export function usageHighlights(record: Pick<UsageRecord, 'category' | 'metrics'>): string[] {
  const number = (value: number) => value.toLocaleString('zh-CN', { maximumSignificantDigits: 21 });
  const result: string[] = [];
  for (const [metric, label, unit] of [['images', '图片', '张'], ['video_seconds', '视频', '秒'], ['audio_seconds', '音频', '秒']] as const) {
    const item = metricValue(record.metrics, metric);
    if (item) result.push(`${item.source === 'observed_output' ? '产物 ' : ''}${number(item.quantity)} ${unit}${label}`);
  }
  const input = metricValue(record.metrics, 'input_tokens'); const output = metricValue(record.metrics, 'output_tokens');
  if (input || output) result.push([input ? `输入 ${number(input.quantity)}` : '', output ? `输出 ${number(output.quantity)}` : ''].filter(Boolean).join(' · ') + ' Token');
  else {
    const total = metricValue(record.metrics, 'total_tokens');
    if (total) result.push(`${number(total.quantity)} Token`);
  }
  const cached = metricValue(record.metrics, 'cached_input_tokens');
  if (cached) result.push(`其中缓存读取 ${number(cached.quantity)} Token`);
  const characters = metricValue(record.metrics, 'characters');
  if (characters) result.push(`${number(characters.quantity)} 字符`);
  return result;
}

export function usageStatus(record: Pick<UsageRecord, 'jobStatus' | 'reportOutcomes' | 'usageState'>): { label: string; tone: 'muted' | 'positive' | 'danger' } {
  if (record.jobStatus) {
    const labels = { queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已停止' };
    return { label: labels[record.jobStatus], tone: record.jobStatus === 'succeeded' ? 'positive' : ['failed', 'interrupted'].includes(record.jobStatus) ? 'danger' : 'muted' };
  }
  if (record.reportOutcomes?.includes('failed')) return { label: '报告含失败', tone: 'danger' };
  if (record.reportOutcomes?.includes('incomplete')) return { label: '报告未完整', tone: 'muted' };
  return { label: record.usageState === 'reported' ? '用量已报告' : record.usageState === 'partial' ? '部分用量' : record.usageState === 'observed' ? '产物统计' : '用量未报告', tone: 'muted' };
}
