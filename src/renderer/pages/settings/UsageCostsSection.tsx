import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, Settings2 } from 'lucide-react';
import type { PricingSnapshot, UsagePage, UsageRecord, UsageSummary } from '../../../shared/usage';
import { getUsageSummary, listPricingSnapshots, listUsageRecords } from '../../api';
import { useSettingsStore } from '../../state/useSettingsStore';
import UsageRecordDetails, { categoryLabels, identity, isLocalUsage, MetricList, metricLabels, money, reconciliationLabels } from '../../components/usage/UsageRecordDetails';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { Separator } from '../../components/ui/separator';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import UsagePricingForm from './UsagePricingForm';
import UsageBillForm from './UsageBillForm';

const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function UsageExecutionRow({ record, onBillSaved }: { record: UsageRecord; onBillSaved: (record: UsageRecord) => void }) {
  const local = isLocalUsage(record);
  return <article className="rounded-xl border border-line p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-medium [overflow-wrap:anywhere]">{identity(record.providerId)} / {identity(record.model)}</h3><p className="mt-1 text-xs text-ink-muted">{categoryLabels[record.category]}，{dateLabel(record.createdAt)}</p></div><div className="text-right text-xs"><p>{local ? '本地执行，无生成调用' : record.estimate ? `估算 ${money(record.estimate.amount, record.estimate.currency)}` : '估算未知'}</p><p className="mt-1 text-ink-muted">{local ? '无需供应商账单' : reconciliationLabels[record.reconciliation]}</p></div></div><details className="mt-3"><summary className="w-fit cursor-pointer rounded text-xs text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">{local ? '查看本地执行详情' : '查看用量与计费依据'}</summary><div className="mt-3 flex flex-col gap-4"><UsageRecordDetails record={record} />{!local ? <UsageBillForm record={record} onSaved={onBillSaved} /> : null}</div></details></article>;
}

export default function UsageCostsSection({ onOpenProviders }: { onOpenProviders: () => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const provider = settings.providers.find((item) => item.id === settings.activeProviderId);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [page, setPage] = useState<UsagePage>({ records: [] });
  const [prices, setPrices] = useState<PricingSnapshot[]>([]);
  const [recordsReadable, setRecordsReadable] = useState(false);
  const [pricesReadable, setPricesReadable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const sequence = useRef(0);
  const summarySequence = useRef(0);
  const moreInFlight = useRef(false);
  const supplierRecords = page.records.filter((record) => !isLocalUsage(record));
  const localRecords = page.records.filter(isLocalUsage);

  const refresh = async () => {
    const attempt = ++sequence.current;
    const summaryAttempt = ++summarySequence.current;
    setLoading(true); setError('');
    const results = await Promise.allSettled([getUsageSummary(), listUsageRecords({ limit: 40 }), listPricingSnapshots()]);
    if (!mounted.current || attempt !== sequence.current) return;
    const [summaryResult, recordsResult, pricesResult] = results;
    if (summaryResult.status === 'fulfilled' && summaryAttempt === summarySequence.current) setSummary(summaryResult.value);
    setRecordsReadable(recordsResult.status === 'fulfilled');
    setPricesReadable(pricesResult.status === 'fulfilled');
    if (recordsResult.status === 'fulfilled') setPage(recordsResult.value);
    if (pricesResult.status === 'fulfilled') setPrices(pricesResult.value);
    setError(results.filter((result) => result.status === 'rejected').map((result) => result.status === 'rejected' && result.reason instanceof Error ? result.reason.message : '用量数据读取失败').join('；'));
    setLoading(false);
  };
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, []);

  const updateSummary = async () => {
    const attempt = ++summarySequence.current;
    try { const value = await getUsageSummary(); if (mounted.current && attempt === summarySequence.current) setSummary(value); }
    catch (error) { if (mounted.current && attempt === summarySequence.current) setError(error instanceof Error ? error.message : '汇总暂未更新'); }
  };
  const billSaved = (record: UsageRecord) => {
    ++sequence.current; setLoading(false);
    setPage((current) => ({ ...current, records: current.records.map((known) => known.id === record.id ? record : known) }));
    void updateSummary();
  };
  const priceSaved = (snapshot: PricingSnapshot) => {
    ++sequence.current; setLoading(false);
    setPrices((current) => [snapshot, ...current.filter((known) => known.id !== snapshot.id)]);
  };
  const loadMore = async () => {
    if (moreInFlight.current || loading || !page.nextCursor) return;
    const attempt = sequence.current;
    moreInFlight.current = true; setMoreLoading(true);
    try {
      const next = await listUsageRecords({ limit: 40, cursor: page.nextCursor });
      if (mounted.current && attempt === sequence.current) setPage((current) => ({ nextCursor: next.nextCursor, records: [...current.records, ...next.records.filter((record) => !current.records.some((known) => known.id === record.id))] }));
    } catch (error) { if (mounted.current && attempt === sequence.current) setError(error instanceof Error ? error.message : '更多记录未能加载'); }
    finally { moreInFlight.current = false; if (mounted.current) setMoreLoading(false); }
  };

  return <div className="flex max-w-4xl flex-col gap-6">
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">用量与费用</h1><p className="mt-2 text-sm leading-relaxed text-ink-muted">查看实际执行身份、已报告用量、价格依据和人工账单记录。</p></div><Button type="button" variant="ghost" size="icon-sm" aria-label="刷新用量与费用" title="刷新用量与费用" disabled={loading} onClick={() => void refresh()}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}</Button></header>
    <section className="flex flex-wrap items-center justify-between gap-3" aria-label="当前模型配置"><div className="min-w-0 text-xs leading-relaxed text-ink-muted"><p className="[overflow-wrap:anywhere]">当前对话配置：{provider ? `${provider.name}（${provider.id}） / ${identity(provider.model)}` : '供应商未知'}</p><p>新任务会按节点与供应商设置解析；下方记录保留实际执行身份。</p></div><Button type="button" variant="outline" size="sm" onClick={onOpenProviders}><Settings2 data-icon="inline-start" />模型供应商设置</Button></section>
    {error ? <Alert variant="destructive"><AlertTitle>用量数据未能完整更新</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error}<Button type="button" variant="ghost" size="xs" disabled={loading} onClick={() => void refresh()}>重新读取</Button></AlertDescription></Alert> : null}
    {loading && !summary ? <div className="flex flex-col gap-3" role="status" aria-label="正在读取用量"><Skeleton className="h-16 w-full" /><Skeleton className="h-12 w-full" /></div> : summary ? <section className="flex flex-col gap-4" aria-label="已记录用量概览">
      <p className="text-xs text-ink-muted">已记录 {summary.executionCount} 次执行；供应商执行 {summary.supplierExecutionCount} 次，本地执行 {summary.localCount} 次。</p>
      {summary.localCount ? <p className="text-xs leading-relaxed text-ink-muted">本地执行无供应商生成调用，单独记录次数，无需供应商账单核对。</p> : null}
      {summary.supplierExecutionCount ? <p className="text-xs text-ink-muted">供应商执行中：完整报告 {summary.reportedCount} 次，部分报告 {typeof summary.partialCount === 'number' ? summary.partialCount : '未知'} 次，观察产物 {summary.observedCount} 次，用量未知 {summary.unknownCount} 次。</p> : <p className="text-xs text-ink-muted">暂无供应商执行记录。</p>}
      {summary.warnings?.length ? <Alert><AlertTitle>汇总需要复核</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{summary.warnings.map((warning, index) => <p key={`${index}:${warning}`}>{warning}</p>)}</AlertDescription></Alert> : null}
      {summary.supplierExecutionCount ? <><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><h2 className="text-sm font-medium">供应商可估算记录合计</h2><div className="mt-2 flex flex-col gap-1 text-sm tabular-nums">{summary.estimates.length ? summary.estimates.map((value) => <p key={value.currency}>{money(value.amount, value.currency)}</p>) : <p className="text-ink-muted">未知，尚无可用估算</p>}</div></div><div><h2 className="text-sm font-medium">供应商已录入账单合计</h2><div className="mt-2 flex flex-col gap-1 text-sm tabular-nums">{summary.bills.length ? summary.bills.map((value) => <p key={value.currency}>{money(value.amount, value.currency)}</p>) : <p className="text-ink-muted">尚未录入</p>}</div></div></div><p className="text-xs leading-relaxed text-ink-muted">{summary.unreconciledCount} 次供应商执行未与账单核对。不同币种分别展示；执行次数不换算成金额，估算不等于实际收费。</p></> : null}
      {summary.metrics.length ? <details><summary className="w-fit cursor-pointer rounded text-xs text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">查看已记录的计量项</summary><div className="mt-3"><MetricList metrics={summary.metrics} /></div></details> : null}
    </section> : null}
    <Separator />
    <Tabs defaultValue="records"><TabsList variant="line"><TabsTrigger value="records">用量记录</TabsTrigger><TabsTrigger value="pricing">价格快照</TabsTrigger></TabsList>
      <TabsContent value="records" className="flex flex-col gap-3">
        {supplierRecords.length ? <section aria-label="供应商执行记录" className="flex flex-col gap-3"><h2 className="text-sm font-medium">供应商执行 · 已加载 {supplierRecords.length} 条</h2>{supplierRecords.map((record) => <UsageExecutionRow key={record.id} record={record} onBillSaved={billSaved} />)}</section> : null}
        {localRecords.length ? <section aria-label="本地执行记录" className="flex flex-col gap-3"><h2 className="text-sm font-medium">本地执行 · 已加载 {localRecords.length} 条</h2>{localRecords.map((record) => <UsageExecutionRow key={record.id} record={record} onBillSaved={billSaved} />)}</section> : null}
        {!page.records.length && !loading ? <Empty><EmptyHeader><EmptyTitle>{recordsReadable ? '暂无执行记录' : '执行记录暂不可用'}</EmptyTitle><EmptyDescription>{recordsReadable ? '供应商调用与本地执行会分别保留在这里。没有记录不表示供应商调用免费。' : '重新读取后可查看真实记录，当前无法判断用量和费用。'}</EmptyDescription></EmptyHeader></Empty> : null}
        {page.nextCursor ? <Button type="button" variant="ghost" size="sm" disabled={loading || moreLoading} onClick={() => void loadMore()}>{moreLoading ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : null}{moreLoading ? '正在加载' : '加载更多记录'}</Button> : null}
      </TabsContent>
      <TabsContent value="pricing" className="flex flex-col gap-4"><p className="text-xs leading-relaxed text-ink-muted">价格由你录入，并保留来源。估算只按录入的计费项计算；应用不内置未经核实的报价，旧执行使用提交时已有的快照。</p><UsagePricingForm onSaved={priceSaved} />{prices.length ? prices.map((snapshot) => <article key={snapshot.id} className="rounded-xl border border-line p-4"><h3 className="text-sm font-medium [overflow-wrap:anywhere]">{snapshot.providerId} / {snapshot.model}</h3><p className="mt-1 text-xs text-ink-muted">{categoryLabels[snapshot.category]}，生效于 {dateLabel(snapshot.effectiveAt)}</p><dl className="mt-3 flex flex-col gap-1">{snapshot.rates.map((rate) => <div key={rate.metric} className="flex flex-wrap justify-between gap-2 text-xs"><dt className="text-ink-muted">{metricLabels[rate.metric]}</dt><dd>{money(rate.rate, snapshot.currency)} / {rate.perUnits.toLocaleString('zh-CN', { maximumSignificantDigits: 15 })} 单位</dd></div>)}</dl><p className="mt-3 select-text text-xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">价格来源：{snapshot.source}</p></article>) : !loading ? <Empty><EmptyHeader><EmptyTitle>{pricesReadable ? '尚未录入价格' : '价格快照暂不可用'}</EmptyTitle><EmptyDescription>{pricesReadable ? '缺少有效价格时，费用估算会保持未知。' : '重新读取后可查看已保存的价格来源。'}</EmptyDescription></EmptyHeader></Empty> : null}</TabsContent>
    </Tabs>
  </div>;
}
