import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { creditAmount, type AccountBilling } from '../../../shared/accountBilling';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export default function AccountBillingSection() {
  const [data, setData] = useState<AccountBilling | null>(null);
  const [page, setPage] = useState(1), [kind, setKind] = useState<'consume' | 'error'>('consume');
  const [revision, setRevision] = useState(0), [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [signedOut, setSignedOut] = useState(false);
  const sequence = useRef(0), identity = useRef(''), lastQuery = useRef('');
  useEffect(() => {
    let active = true;
    const attempt = ++sequence.current;
    setLoading(true); setError('');
    const query = `${page}:${kind}`;
    if (lastQuery.current !== query) setData(null);
    lastQuery.current = query;
    void (async () => {
      try {
        const state = await window.reizo.accountStatus();
        if (!active || attempt !== sequence.current) return;
        if (state.status !== 'authenticated' || !state.user) { setSignedOut(!state.user); setData(null); if (state.user) setError('当前账号离线，请刷新后查看消费。'); return; }
        setSignedOut(false);
        const scope = `${state.user.id}:${state.models?.organizationId || ''}`;
        if (identity.current !== scope) setData(null);
        identity.current = scope;
        const next = await window.reizo.accountBilling({ page, type: kind, ...(state.models?.organizationId ? { organizationId: state.models.organizationId } : {}) });
        if (active && attempt === sequence.current) setData(next);
      } catch (cause) {
        if (active && attempt === sequence.current) { setData(null); setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '账户消费暂不可用，请刷新重试。'); }
      } finally { if (active && attempt === sequence.current) setLoading(false); }
    })();
    return () => { active = false; };
  }, [page, kind, revision]);
  useEffect(() => {
    let active = true, reading = false;
    const refresh = () => setRevision(value => value + 1);
    const checkIdentity = async () => {
      if (reading) return; reading = true;
      try {
        const state = await window.reizo.accountStatus();
        if (!active) return;
        const current = state.status === 'authenticated' && state.user ? `${state.user.id}:${state.models?.organizationId || ''}` : '';
        if (identity.current !== current) { identity.current = current; ++sequence.current; setData(null); setPage(1); refresh(); }
      } catch { if (active) { ++sequence.current; setData(null); setError('账号状态暂不可用，请刷新。'); } }
      finally { reading = false; }
    };
    const timer = setInterval(() => void checkIdentity(), 2000), sync = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); clearInterval(sync); window.removeEventListener('focus', refresh); };
  }, []);
  const prices = data?.pricing.items.filter(item => item.model.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const reload = () => setRevision(value => value + 1);
  return <section aria-label="账户消费与定价" className="flex min-w-0 flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{data?.organization.name || 'Reizo 账户'}</span><Button variant="ghost" size="icon-sm" aria-label="刷新账户消费" disabled={loading} onClick={reload}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></div>
    {signedOut ? <div className="rounded-xl border border-line p-8 text-center text-sm text-ink-muted">登录后查看账户消费</div> : <>
      <div className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-xl border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-4"><p className="text-xs text-ink-muted">余额 · 积分</p><p className="mt-2 font-mono text-2xl font-medium tabular-nums">{creditAmount(data?.balance.availableCredits)}</p><p className="mt-2 text-[11px] text-ink-muted">¥1 = 1 积分</p></div>
        <div className="p-4"><p className="text-xs text-ink-muted">累计消耗 · 积分</p><p className="mt-2 font-mono text-2xl font-medium tabular-nums">{creditAmount(data?.balance.usedCredits)}</p></div>
        <div className="p-4"><p className="text-xs text-ink-muted">套餐</p><p className="mt-2 text-sm font-medium" title="套餐价格与额度尚未配置">待定价</p></div>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-danger/30 p-3 text-xs text-danger">{error}</p> : null}
      <Tabs defaultValue="charges"><TabsList variant="line"><TabsTrigger value="charges">账户消费记录</TabsTrigger><TabsTrigger value="prices">模型定价</TabsTrigger></TabsList>
        <TabsContent value="charges" className="space-y-3">
          <div className="flex items-center justify-between gap-3"><select aria-label="账户消费类型" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(1); }} className="rounded-md border border-line bg-paper px-3 py-2 text-xs"><option value="consume">已结算请求</option><option value="error">失败请求</option></select><span className="text-xs text-ink-muted">{data?.usage.total == null ? '—' : data.usage.total} 条</span></div>
          <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-line bg-paper-inset/40 text-ink-muted"><tr>{['模型 / 时间', '用量', '实扣积分', '折合人民币', '请求编号'].map(label => <th key={label} className="px-4 py-3 font-normal">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{data?.usage.items.map((row, index) => <tr key={`${row.id}-${index}`}><td className="max-w-60 px-4 py-3"><p className="break-words font-medium">{row.model}</p><p className="mt-1 text-[11px] text-ink-muted">{row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : '—'}</p></td><td className="px-4 py-3 text-ink-muted"><p>输入 {creditAmount(row.promptTokens)}</p><p className="mt-1">输出 {creditAmount(row.completionTokens)}</p></td><td className="px-4 py-3 font-mono font-medium tabular-nums">{creditAmount(row.credits)}</td><td className="px-4 py-3 font-mono tabular-nums">{row.credits == null ? '未同步' : `¥${creditAmount(row.credits)}`}</td><td className="max-w-32 truncate px-4 py-3 font-mono text-[11px] text-ink-muted" title={row.requestId || row.tokenName}>{row.requestId || '—'}</td></tr>)}</tbody></table>
          {!data?.usage.items.length ? <div role="status" className="p-8 text-center text-sm text-ink-muted">{loading ? '正在同步' : data?.usage.status === 'ready' ? '暂无消费记录' : '消费记录未同步'}</div> : null}</div>
          <div className="flex items-center justify-end gap-3"><Button size="icon-sm" variant="outline" aria-label="上一页消费" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></Button><span className="text-xs tabular-nums">第 {page} 页</span><Button size="icon-sm" variant="outline" aria-label="下一页消费" disabled={loading || data?.usage.status !== 'ready' || data.usage.total == null || page * data.usage.pageSize >= data.usage.total} onClick={() => setPage(value => value + 1)}><ChevronRight /></Button></div>
        </TabsContent>
        <TabsContent value="prices" className="space-y-3"><div className="relative"><Search className="absolute left-3 top-3 size-3.5 text-ink-muted" /><Input className="pl-9 text-xs" aria-label="搜索模型定价" placeholder="搜索模型" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="overflow-hidden rounded-xl border border-line"><div className="flex justify-between border-b border-line bg-paper-inset/40 px-4 py-3 text-xs text-ink-muted"><span>当前账户模型费率 · 积分</span><span title={data?.pricing.updatedAt || ''}>{data?.pricing.updatedAt ? new Date(data.pricing.updatedAt).toLocaleTimeString('zh-CN') : '未同步'}</span></div>
            {prices.map(price => <article key={price.model} className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 last:border-0"><h3 className="min-w-0 break-all text-xs font-medium">{price.model}</h3><div className="space-y-1 text-right text-xs tabular-nums">{price.status === 'priced' ? price.rates.map(rate => <p key={`${rate.label}-${rate.unit}`}><span className="mr-2 text-ink-muted">{rate.label}</span>{creditAmount(rate.min)}{rate.max !== rate.min ? `–${creditAmount(rate.max)}` : ''} / {rate.unit}</p>) : <p className="text-ink-muted">{price.status === 'dynamic' ? '按实际参数计费' : '价格未同步'}</p>}</div></article>)}
            {!prices.length ? <div className="p-8 text-center text-sm text-ink-muted">{loading ? '正在同步' : data?.pricing.status === 'ready' ? '暂无匹配模型' : '模型价格未同步'}</div> : null}</div>
        </TabsContent>
      </Tabs>
    </>}
  </section>;
}
