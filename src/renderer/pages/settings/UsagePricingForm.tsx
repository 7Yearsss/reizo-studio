import { useRef, useState } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { USAGE_METRICS, type PricingSnapshot, type PricingSnapshotInput, type UsageCategory, type UsageMetricName } from '../../../shared/usage';
import { createPricingSnapshot } from '../../api';
import { categoryLabels, metricLabels } from '../../components/usage/UsageRecordDetails';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

type RateDraft = { id: string; metric: UsageMetricName; rate: string; perUnits: string };
const initialRates = (): RateDraft[] => [{ id: nanoid(), metric: 'input_tokens', rate: '', perUnits: '1000000' }, { id: nanoid(), metric: 'output_tokens', rate: '', perUnits: '1000000' }];
const tokenComponents: UsageMetricName[] = ['input_tokens', 'uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens'];
function nextRateMetric(rates: RateDraft[]) {
  const selected = new Set(rates.map((rate) => rate.metric));
  return USAGE_METRICS.find((metric) => !selected.has(metric)
    && !(metric === 'total_tokens' && tokenComponents.some((item) => selected.has(item)))
    && !(tokenComponents.includes(metric) && selected.has('total_tokens'))
    && !(metric === 'input_tokens' && ['uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens'].some((item) => selected.has(item as UsageMetricName)))
    && !(['uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens'].includes(metric) && selected.has('input_tokens')));
}

export default function UsagePricingForm({ onSaved }: { onSaved: (snapshot: PricingSnapshot) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<UsageCategory>('llm');
  const [rates, setRates] = useState(initialRates);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  if (!open) return <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Plus data-icon="inline-start" />录入价格快照</Button>;
  return <form className="flex flex-col gap-4 rounded-xl border border-line p-4" aria-busy={busy} onSubmit={(event) => {
    event.preventDefault(); if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    const input: PricingSnapshotInput = { providerId: String(data.get('providerId')).trim(), model: String(data.get('model')).trim(), category,
      currency: String(data.get('currency')).trim().toUpperCase(), source: String(data.get('source')).trim(),
      rates: rates.map(({ metric, rate, perUnits }) => ({ metric, rate: Number(rate), perUnits: Number(perUnits) })) };
    const keys = new Set(input.rates.map((rate) => rate.metric));
    if (keys.size !== input.rates.length || keys.has('total_tokens') && ['input_tokens', 'output_tokens', 'uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens'].some((metric) => keys.has(metric as UsageMetricName)) || keys.has('input_tokens') && ['uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens'].some((metric) => keys.has(metric as UsageMetricName))) { setError('计量项不能重复。Token 总数与重叠的拆分项不能同时计费。'); return; }
    if (!/^[A-Z]{3}$/.test(input.currency) || input.rates.some((rate) => !Number.isFinite(rate.rate) || rate.rate < 0 || !Number.isFinite(rate.perUnits) || rate.perUnits <= 0)) { setError('请填写三位币种代码、有效单价和大于零的计费数量。'); return; }
    const signature = JSON.stringify(input);
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, id: nanoid() };
    submitting.current = true; setBusy(true); setError('');
    void createPricingSnapshot({ ...input, id: attempt.current.id }).then((snapshot) => { onSaved(snapshot); setOpen(false); attempt.current = null; setRates(initialRates()); })
      .catch((error) => setError(error instanceof Error ? error.message : '价格快照未能保存，保留输入后可重试'))
      .finally(() => { submitting.current = false; setBusy(false); });
  }}>
    <div><h3 className="text-sm font-medium">录入价格快照</h3><p className="mt-1 text-xs leading-relaxed text-ink-muted">录入你已确认的报价和来源。新报价用于之后提交的执行，不会改写旧任务的估算。</p></div>
    <FieldGroup className="gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field data-disabled={busy}><FieldLabel htmlFor="pricing-provider">供应商 ID</FieldLabel><Input id="pricing-provider" name="providerId" placeholder="与用量记录中的 ID 一致" maxLength={512} required disabled={busy} autoFocus /></Field><Field data-disabled={busy}><FieldLabel htmlFor="pricing-model">模型 ID</FieldLabel><Input id="pricing-model" name="model" maxLength={512} required disabled={busy} /></Field></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field data-disabled={busy}><FieldLabel htmlFor="pricing-category">类型</FieldLabel><Select value={category} onValueChange={(value) => setCategory(value as UsageCategory)} disabled={busy}><SelectTrigger id="pricing-category" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field data-disabled={busy}><FieldLabel htmlFor="pricing-currency">币种</FieldLabel><Input id="pricing-currency" name="currency" placeholder="USD / CNY" maxLength={3} required disabled={busy} /></Field></div>
      <Field data-disabled={busy}><FieldLabel htmlFor="pricing-source">价格来源</FieldLabel><Input id="pricing-source" name="source" placeholder="官方价格页、已签署报价或计费说明" maxLength={512} required disabled={busy} /><FieldDescription>记录来源，便于之后核对估算依据。</FieldDescription></Field>
      {rates.map((item, index) => <FieldGroup key={item.id} className="gap-2"><div className="flex items-center justify-between"><p className="text-xs font-medium text-ink">计费项 {index + 1}</p>{rates.length > 1 ? <Button type="button" variant="ghost" size="icon-xs" aria-label={`移除计费项${index + 1}`} disabled={busy} onClick={() => setRates((current) => current.filter((rate) => rate.id !== item.id))}><X /></Button> : null}</div><Field data-disabled={busy}><FieldLabel className="sr-only" htmlFor={`pricing-metric-${item.id}`}>计量项</FieldLabel><Select value={item.metric} disabled={busy} onValueChange={(value) => setRates((current) => current.map((rate) => rate.id === item.id ? { ...rate, metric: value as UsageMetricName } : rate))}><SelectTrigger id={`pricing-metric-${item.id}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{USAGE_METRICS.map((metric) => <SelectItem key={metric} value={metric}>{metricLabels[metric]}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><div className="grid grid-cols-2 gap-3"><Field data-disabled={busy}><FieldLabel htmlFor={`pricing-rate-${item.id}`}>单价</FieldLabel><Input id={`pricing-rate-${item.id}`} type="number" min="0" step="any" required disabled={busy} value={item.rate} onChange={(event) => setRates((current) => current.map((rate) => rate.id === item.id ? { ...rate, rate: event.target.value } : rate))} /></Field><Field data-disabled={busy}><FieldLabel htmlFor={`pricing-per-${item.id}`}>每多少单位</FieldLabel><Input id={`pricing-per-${item.id}`} type="number" min="0.000000001" step="any" required disabled={busy} value={item.perUnits} onChange={(event) => setRates((current) => current.map((rate) => rate.id === item.id ? { ...rate, perUnits: event.target.value } : rate))} /></Field></div></FieldGroup>)}
    </FieldGroup>
    {nextRateMetric(rates) ? <Button type="button" variant="ghost" size="xs" disabled={busy} className="self-start" onClick={() => setRates((current) => { const metric = nextRateMetric(current); return metric ? [...current, { id: nanoid(), metric, rate: '', perUnits: '1' }] : current; })}><Plus data-icon="inline-start" />增加计费项</Button> : null}
    {error ? <Alert variant="destructive"><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error}</AlertDescription></Alert> : null}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="submit" size="sm" disabled={busy}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : null}{busy ? '正在保存' : '保存价格快照'}</Button></div>
  </form>;
}
