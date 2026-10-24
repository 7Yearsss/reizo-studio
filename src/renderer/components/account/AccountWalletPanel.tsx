import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, RefreshCw, Wallet } from 'lucide-react';
import type { AccountCheckout, AccountTopupInput, AccountWallet } from '../../../shared/accountWallet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const statuses = { pending: '待支付', crediting: '到账处理中', success: '已到账', failed: '已失败' };
const money = (amount: number, currency: string) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
const walletError = (cause: unknown, fallback: string) => cause instanceof Error
  ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;

export default function AccountWalletPanel() {
  const [wallet, setWallet] = useState<AccountWallet>(); const current = useRef<AccountWallet | undefined>(undefined);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [amount, setAmount] = useState<string | null>(null); const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const mounted = useRef(true);
  const [revision, setRevision] = useState(0);
  const attempt = useRef<{ signature: string; input: AccountTopupInput; order?: string } | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>; let count = 0; let failures = 0;
    const read = async () => {
      let settled = false;
      try {
        const next = await window.reizo.accountWallet();
        if (!active) return;
        if (current.current && current.current.organization.id !== next.organization.id) {
          attempt.current = undefined; setAmount(null); setMethod(''); setMessage('工作区已变化，请核对到账工作区后重新选择。');
        }
        settled = !!current.current?.orders.some(old => old.status !== 'success' && next.orders.some(order => order.reference === old.reference && order.status === 'success'));
        if (attempt.current?.order && next.orders.some(order => order.reference === attempt.current?.order && ['success', 'failed'].includes(order.status))) attempt.current = undefined;
        current.current = next; setWallet(next); setError(''); failures = 0;
      } catch (cause) { if (active) { failures++; setError(walletError(cause, '充值信息暂不可用，请稍后刷新。')); } }
      finally {
        if (active) {
          setLoading(false); count++;
          if (settled || failures || current.current?.orders.some(order => ['pending', 'crediting'].includes(order.status))) {
            timer = setTimeout(() => void read(), failures ? Math.min(30_000, 3000 * 2 ** Math.min(failures - 1, 4)) : count > 20 ? 10_000 : 3000);
          }
        }
      }
    };
    void read();
    const focus = () => setRevision(value => value + 1);
    window.addEventListener('focus', focus);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('focus', focus); };
  }, [revision]);
  const config = wallet?.config;
  const selectedMethod = config?.methods.some(item => item.type === method) ? method : config?.methods[0]?.type ?? '';
  const selectedAmount = amount ?? String(config?.amountOptions[0] ?? config?.minTopup ?? '');
  const numeric = Number(selectedAmount);
  const valid = !!config && Number.isSafeInteger(numeric) && numeric >= config.minTopup && numeric <= config.maxTopup;
  const ready = !!(wallet?.canTopup && config?.enabled && selectedMethod && valid && !busy && !error);
  const showCheckout = (result: AccountCheckout) => {
    if (!mounted.current) return;
    setMessage(result.order.status !== 'pending' ? `订单${statuses[result.order.status]}。` : result.cashierOpened
      ? '已打开客户端收银台，请扫码或按页面提示付款。这里会自动查询到账状态。'
      : '订单已创建，但未能打开收银台。可在下方充值记录中继续付款。');
    setRevision(value => value + 1);
  };
  async function pay(order?: string) {
    if (!wallet || busyRef.current || !order && !ready) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (order) showCheckout(await window.reizo.accountTopupOpen({ organizationId: wallet.organization.id, order }));
      else {
        const signature = JSON.stringify([wallet.organization.id, numeric, selectedMethod]);
        if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature,
          input: { organizationId: wallet.organization.id, amount: numeric, paymentMethod: selectedMethod, requestId: crypto.randomUUID() } };
        const submitted = attempt.current;
        const result = await window.reizo.accountTopup(submitted.input);
        if (attempt.current === submitted) {
          if (['pending', 'crediting'].includes(result.order.status)) submitted.order = result.order.reference;
          else attempt.current = undefined;
        }
        showCheckout(result);
      }
    } catch (cause) {
      if (mounted.current) { setMessage(walletError(cause, '订单提交状态未确认，请先刷新充值记录。')); setRevision(value => value + 1); }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="max-h-[min(620px,calc(100dvh-220px))] space-y-5 overflow-y-auto pr-1">
    <div className="rounded-xl border border-line bg-paper p-4"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs text-ink-muted"><Wallet size={14} />{error ? '上次同步的可用积分' : '可用积分'}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{wallet?.balance.syncStatus === 'ready' ? wallet.balance.availableCredits.toLocaleString('zh-CN', { maximumSignificantDigits: 15 }) : '—'}</p></div><Button type="button" size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)} disabled={loading || busy}><RefreshCw className="size-3.5" />刷新</Button></div>
      <p className="mt-2 text-xs text-ink-muted">到账工作区：<strong className="font-medium text-ink">{wallet?.organization.name ?? (loading ? '正在读取…' : '暂不可用')}</strong></p>{wallet?.balance.syncStatus === 'unavailable' ? <p className="mt-1 text-xs text-ink-muted">余额暂未同步，请刷新后查看。</p> : null}</div>
    {error ? <p role="alert" className="text-xs leading-relaxed text-danger">{error}</p> : null}
    {message ? <p role="status" className="rounded-lg bg-paper-inset p-3 text-xs leading-relaxed text-ink-muted">{message}</p> : null}
    {loading && !wallet ? <p role="status" className="flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle size={14} className="animate-spin" />正在读取充值配置…</p> : null}
    {wallet && config ? config.enabled && wallet.canTopup ? <form aria-label="充值金额与支付方式" className="space-y-4" onSubmit={event => { event.preventDefault(); void pay(); }}><fieldset disabled={busy} className="space-y-4">
      <div><h3 className="mb-2 text-xs font-medium">充值金额（{config.currency}）</h3><div className="grid grid-cols-4 gap-2">{[...new Set(config.amountOptions)].filter(value => value >= config.minTopup && value <= config.maxTopup).map(value => <button key={value} type="button" aria-pressed={selectedAmount === String(value)} onClick={() => setAmount(String(value))} className={`rounded-lg border px-2 py-2.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedAmount === String(value) ? 'border-ink bg-ink text-paper' : 'border-line hover:bg-paper-inset'}`}>{money(value, config.currency)}</button>)}</div></div>
      <label className="block text-xs text-ink-muted">自定义金额<Input aria-label="自定义充值金额" type="number" step="1" min={config.minTopup} max={config.maxTopup} value={selectedAmount} onChange={event => setAmount(event.target.value)} className="mt-2" /><span className="mt-1 block">{config.minTopup}–{config.maxTopup}，整数金额</span></label>
      <div><h3 className="mb-2 text-xs font-medium">支付方式</h3><div className="flex flex-wrap gap-2">{config.methods.map(item => <button type="button" key={item.type} aria-pressed={selectedMethod === item.type} onClick={() => setMethod(item.type)} className={`rounded-lg border px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedMethod === item.type ? 'border-ink bg-paper-inset' : 'border-line hover:bg-paper-inset'}`}>{item.name}</button>)}</div></div>
      {valid && numeric * config.creditsPerUnit <= Number.MAX_SAFE_INTEGER ? <p className="text-xs text-ink-muted">预计到账 {(numeric * config.creditsPerUnit).toLocaleString('zh-CN')} 积分，实际以订单记录为准。</p> : null}
      <Button type="submit" className="w-full" disabled={!ready}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}{busy ? '正在打开收银台…' : `去付款${valid ? ` ${money(numeric, config.currency)}` : ''}`}</Button>
    </fieldset></form> : <p className="text-sm text-ink-muted">{!wallet.canTopup ? '当前角色无充值权限，请联系工作区所有者或管理员。' : '当前暂未开放在线充值。'}</p> : null}
    <p className="text-[11px] leading-relaxed text-ink-muted">充值用于上方 Reizo 工作区。自行配置的第三方 API Key 不使用此余额。付款在客户端收银台完成，到账状态以服务端确认结果为准。</p>
    {wallet?.orders.length ? <section aria-label="充值记录" className="space-y-2"><h3 className="text-xs font-medium">最近充值记录</h3>{wallet.orders.map(order => <div key={order.reference} className="rounded-lg border border-line p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-medium tabular-nums">{money(order.amount, order.currency)}</span><span className={order.status === 'success' ? 'text-success' : order.status === 'failed' ? 'text-danger' : 'text-ink-muted'}>{statuses[order.status]}</span></div><p className="mt-1 text-ink-muted">{new Date(order.createdAt).toLocaleString('zh-CN')} · {config?.methods.find(item => item.type === order.paymentMethod)?.name ?? order.paymentMethod}</p><p className="mt-1 select-text break-all text-[11px] text-ink-muted">{order.reference}</p>{order.status === 'pending' && wallet.canTopup ? <Button type="button" variant="ghost" size="xs" className="mt-1" disabled={busy} onClick={() => void pay(order.reference)}>继续付款<ArrowUpRight className="size-3" /></Button> : null}</div>)}</section> : null}
  </div>;
}
