import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, Search, Settings2 } from 'lucide-react';
import type { PricingSnapshot, UsageCategory, UsagePage, UsageQuery, UsageSummary } from '../../../shared/usage';
import { getUsageSummary, listPricingSnapshots, listUsageRecords } from '../../api';
import { useSettingsStore } from '../../state/useSettingsStore';
import { categoryLabels, MetricList, metricLabels, money } from '../../components/usage/UsageRecordDetails';
import UsageExecutionRow from '../../components/usage/UsageExecutionRow';
import { metricValue, usageLoadFailureText } from '../../components/usage/usagePresentation';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import UsagePricingForm from './UsagePricingForm';

type Period = 'all' | 'today' | 'week' | 'month';
const periodLabels: Record<Period, string> = { all: '全部时间', today: '今天', week: '最近 7 天', month: '最近 30 天' };
const selectClass = 'h-9 rounded-md border border-line bg-paper px-2.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring';
const number = (value: number) => value.toLocaleString('zh-CN', { maximumSignificantDigits: 21 });

function MoneyTotals({ values, empty }: { values: Array<{ currency: string; amount: number }>; empty: string }) {
  return values.length ? <div className="space-y-1 tabular-nums">{values.map(value => <p key={value.currency} className="text-lg font-semibold tracking-tight">{money(value.amount, value.currency)}</p>)}</div> : <p className="text-base text-ink-muted">{empty}</p>;
}

function Overview({ summary }: { summary: UsageSummary }) {
  const input = metricValue(summary.metrics, 'input_tokens'); const output = metricValue(summary.metrics, 'output_tokens');
  const cached = metricValue(summary.metrics, 'cached_input_tokens');
  return <section aria-label="筛选范围内的用量与费用" className="overflow-hidden rounded-xl border border-line">
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 lg:grid-cols-4">
      <div><p className="text-xs text-ink-muted">执行记录</p><p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{number(summary.executionCount)}<span className="ml-1 text-xs font-normal text-ink-muted">次</span></p><p className="mt-2 text-[11px] leading-relaxed text-ink-muted">模型调用 {number(summary.supplierExecutionCount)} · 本地 {number(summary.localCount)}</p></div>
      <div><p className="text-xs text-ink-muted">输入 / 输出 Token</p><p className="mt-2 text-lg font-semibold tabular-nums tracking-tight">{input ? number(input.quantity) : '—'}<span className="mx-1 text-ink-muted">/</span>{output ? number(output.quantity) : '—'}</p><p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{cached ? `其中缓存读取 ${number(cached.quantity)}` : `未报告用量 ${number(summary.unknownCount)} 次`}</p></div>
      <div><p className="mb-2 text-xs text-ink-muted">已录入账单</p><MoneyTotals values={summary.bills} empty="尚无账单" /><p className="mt-2 text-[11px] text-ink-muted">{number(summary.billedCount ?? 0)} 条记录有账单依据</p></div>
      <div><p className="mb-2 text-xs text-ink-muted">按价格估算</p><MoneyTotals values={summary.estimates} empty="暂无可用估算" /><p className="mt-2 text-[11px] text-ink-muted">{number(summary.unpricedCount ?? summary.unreconciledCount)} 次调用尚未计价</p></div>
    </div>
    <div className="border-t border-line/70 px-4 py-3 text-xs leading-relaxed text-ink-muted">账单金额与估算分别统计，不相加；不同币种分别显示。当前不会自动同步供应商扣费，缺少价格或账单时保留为未计价。</div>
    {summary.metrics.length ? <details className="border-t border-line/70 px-4 py-3"><summary className="w-fit cursor-pointer rounded text-xs text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">完整用量 · 图片、视频、缓存等计量项</summary><div className="mt-3 max-w-xl"><MetricList metrics={summary.metrics} /></div></details> : null}
  </section>;
}

export default function UsageCostsSection({ onOpenProviders }: { onOpenProviders: () => void }) {
  const settings = useSettingsStore(state => state.settings);
  const [tab, setTab] = useState('records');
  const [period, setPeriod] = useState<Period>('all');
  const [category, setCategory] = useState<UsageCategory | ''>('');
  const [cost, setCost] = useState<UsageQuery['cost'] | ''>('');
  const [search, setSearch] = useState(''); const [searchTerm, setSearchTerm] = useState('');
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [page, setPage] = useState<UsagePage>({ records: [] });
  const [prices, setPrices] = useState<PricingSnapshot[]>([]);
  const [recordsReadable, setRecordsReadable] = useState(false);
  const [pricesReadable, setPricesReadable] = useState(false);
  const [loading, setLoading] = useState(true); const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true); const sequence = useRef(0); const priceSequence = useRef(0); const moreInFlight = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setSearchTerm(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const query = useMemo<UsageQuery>(() => {
    const value: UsageQuery = {};
    if (category) value.category = category;
    if (cost) value.cost = cost;
    if (searchTerm) value.search = searchTerm;
    if (period !== 'all') {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      from.setDate(from.getDate() - (period === 'week' ? 6 : period === 'month' ? 29 : 0));
      value.from = from.toISOString(); value.to = to.toISOString();
    }
    return value;
  }, [category, cost, searchTerm, period, revision]);
  const reload = useCallback(async () => {
    const attempt = ++sequence.current;
    const priceAttempt = priceSequence.current;
    setLoading(true); setError(''); setPage({ records: [] }); setSummary(null); setRecordsReadable(false);
    const results = await Promise.allSettled([getUsageSummary(query), listUsageRecords({ ...query, limit: 40 }), listPricingSnapshots()]);
    if (!mounted.current || attempt !== sequence.current) return;
    const [summaryResult, recordsResult, pricesResult] = results;
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
    setRecordsReadable(recordsResult.status === 'fulfilled'); setPricesReadable(pricesResult.status === 'fulfilled');
    if (recordsResult.status === 'fulfilled') setPage(recordsResult.value);
    if (pricesResult.status === 'fulfilled' && priceAttempt === priceSequence.current) setPrices(pricesResult.value);
    setError(results.filter(result => result.status === 'rejected').map(result => result.status === 'rejected' && result.reason instanceof Error ? result.reason.message : '用量数据读取失败').join('；'));
    setLoading(false);
  }, [query]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++sequence.current; }; }, []);
  useEffect(() => { void reload(); }, [reload]);
  const refresh = () => setRevision(value => value + 1);
  const loadMore = async () => {
    if (moreInFlight.current || loading || !page.nextCursor) return;
    const attempt = sequence.current; moreInFlight.current = true; setMoreLoading(true);
    try {
      const next = await listUsageRecords({ ...query, limit: 40, cursor: page.nextCursor });
      if (mounted.current && attempt === sequence.current) setPage(current => ({ nextCursor: next.nextCursor, records: [...current.records, ...next.records.filter(record => !current.records.some(known => known.id === record.id))] }));
    } catch (cause) { if (mounted.current && attempt === sequence.current) setError(cause instanceof Error ? cause.message : '更多记录未能加载'); }
    finally { moreInFlight.current = false; if (mounted.current) setMoreLoading(false); }
  };
  const filtered = !!(category || cost || searchTerm || period !== 'all');
  const reset = () => { setCategory(''); setCost(''); setSearch(''); setSearchTerm(''); setPeriod('all'); };

  return <div className="flex max-w-5xl flex-col gap-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">用量与费用</h1><p className="mt-1.5 text-sm text-ink-muted">查看每次对话与创作的用量、费用和来源。</p></div><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon-sm" aria-label="刷新用量与费用" title="刷新用量与费用" disabled={loading} onClick={refresh}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}</Button><Button type="button" variant="ghost" size="sm" onClick={onOpenProviders}><Settings2 className="size-3.5" />模型设置</Button></div></header>
    <Tabs value={tab} onValueChange={setTab}><TabsList variant="line"><TabsTrigger value="records">用量记录</TabsTrigger><TabsTrigger value="pricing">价格设置</TabsTrigger></TabsList>
      <TabsContent value="records" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3" aria-label="用量记录筛选">
          <div className="flex flex-wrap items-center gap-2"><div className="relative min-w-44 flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-3.5 text-ink-muted" /><Input className="pl-9 text-xs" aria-label="搜索用量记录" placeholder="搜索模型、供应商、对话或请求编号" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></div>
            <select aria-label="时间范围" className={selectClass} value={period} onChange={event => setPeriod(event.target.value as Period)}>{Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select aria-label="费用状态" className={selectClass} value={cost} onChange={event => setCost(event.target.value as typeof cost)}><option value="">全部费用状态</option><option value="billed">已有账单</option><option value="estimated">仅有估算</option><option value="unpriced">未计价</option></select>
          </div>
          <div className="flex flex-wrap items-center gap-1" aria-label="调用类型"><button type="button" aria-pressed={!category} className={`rounded-md px-3 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${!category ? 'bg-ink text-paper' : 'text-ink-muted hover:bg-paper-inset'}`} onClick={() => setCategory('')}>全部</button>{Object.entries(categoryLabels).map(([value, label]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value as UsageCategory)} className={`rounded-md px-3 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${category === value ? 'bg-ink text-paper' : 'text-ink-muted hover:bg-paper-inset'}`}>{label}</button>)}{filtered ? <button type="button" onClick={reset} className="ml-auto rounded px-2 py-1.5 text-xs text-ink-muted underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">清除筛选</button> : null}</div>
        </div>
        {error ? <Alert variant="destructive"><AlertTitle>部分用量数据未能更新</AlertTitle><AlertDescription>{usageLoadFailureText(error)}<Button type="button" variant="ghost" size="xs" disabled={loading} onClick={refresh}>重新读取</Button></AlertDescription></Alert> : null}
        {loading ? <div role="status" aria-label="正在读取用量"><Skeleton className="h-40 w-full" /></div> : summary ? <Overview summary={summary} /> : null}
        {summary?.warnings?.length ? <Alert><AlertTitle>部分汇总需要复核</AlertTitle><AlertDescription>{summary.warnings.map(warning => <p key={warning}>{warning}</p>)}</AlertDescription></Alert> : null}
        <section aria-label="执行记录" className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-medium">{periodLabels[period]}{category ? ` · ${categoryLabels[category]}` : ''}{summary ? <span className="ml-2 font-normal text-ink-muted">{summary.executionCount} 条</span> : null}</h2><span className="text-xs text-ink-muted">已加载 {page.records.length} 条</span></div>
          {page.records.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[680px] table-fixed text-left"><colgroup><col className="w-[26%]" /><col className="w-[25%]" /><col className="w-[21%]" /><col className="w-[21%]" /><col className="w-[7%]" /></colgroup><thead className="border-b border-line bg-paper-inset/40 text-[11px] font-normal text-ink-muted"><tr><th className="py-2.5 pl-4 pr-3 font-normal">模型与调用</th><th className="px-3 py-2.5 font-normal">已记录用量</th><th className="px-3 py-2.5 font-normal">费用与依据</th><th className="px-3 py-2.5 font-normal">对话来源</th><th><span className="sr-only">详情</span></th></tr></thead><tbody>{page.records.map(record => <UsageExecutionRow key={record.id} record={record} providerName={settings.providers.find(provider => provider.id === record.providerId)?.name ?? record.providerId} onBillSaved={refresh} />)}</tbody></table></div> : !loading ? <Empty><EmptyHeader><EmptyTitle>{recordsReadable ? filtered ? '没有符合筛选条件的记录' : '暂无用量记录' : '用量记录暂不可用'}</EmptyTitle><EmptyDescription>{recordsReadable ? filtered ? '试试其他类型、时间或关键词。' : '对话和创作调用会自动记录在这里。' : '请重新读取，暂时无法判断用量与费用。'}</EmptyDescription></EmptyHeader>{filtered && recordsReadable ? <Button variant="outline" size="sm" onClick={reset}>清除筛选</Button> : null}</Empty> : null}
          {page.nextCursor ? <Button type="button" variant="ghost" className="mt-3 w-full" size="sm" disabled={loading || moreLoading} onClick={() => void loadMore()}>{moreLoading ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}{moreLoading ? '正在加载' : '加载更多记录'}</Button> : null}
        </section>
      </TabsContent>
      <TabsContent value="pricing" className="flex flex-col gap-4"><div className="rounded-lg border border-line p-4"><h2 className="text-sm font-medium">为后续调用设置价格依据</h2><p className="mt-2 text-xs leading-relaxed text-ink-muted">价格需有明确来源，按模型与供应商分别记录。新价格只用于后续调用；历史记录保留原有依据，可在记录详情中补充已有账单。录入账单不会发起扣款。</p></div><UsagePricingForm onSaved={snapshot => { ++priceSequence.current; setPricesReadable(true); setPrices(current => [snapshot, ...current.filter(known => known.id !== snapshot.id)]); }} />{prices.map(snapshot => <article key={snapshot.id} className="rounded-xl border border-line p-4"><h3 className="text-sm font-medium [overflow-wrap:anywhere]">{snapshot.providerId} / {snapshot.model}</h3><p className="mt-1 text-xs text-ink-muted">{categoryLabels[snapshot.category]} · {new Date(snapshot.effectiveAt).toLocaleString('zh-CN')}</p><dl className="mt-3 space-y-1">{snapshot.rates.map(rate => <div key={rate.metric} className="flex flex-wrap justify-between gap-2 text-xs"><dt className="text-ink-muted">{metricLabels[rate.metric]}</dt><dd>{money(rate.rate, snapshot.currency)} / {number(rate.perUnits)} 单位</dd></div>)}</dl><p className="mt-3 text-xs text-ink-muted [overflow-wrap:anywhere]">来源：{snapshot.source}</p></article>)}{!prices.length && !loading ? <p className="text-xs text-ink-muted">{pricesReadable ? '尚未设置价格。没有价格依据的调用会显示为未计价。' : '价格暂不可读取，请刷新后重试。'}</p> : null}</TabsContent>
    </Tabs>
  </div>;
}
