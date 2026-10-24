import { z } from 'zod';
import type { AccountCheckout, AccountTopupInput, AccountWallet } from '../../shared/accountWallet';
import { isCashierUrl, type CashierPurchase } from './cashierPolicy';

interface Identity { token: string; userId: string; generation: number }
interface Dependencies { origin: string; fetch: typeof fetch; openCashier: (purchase: CashierPurchase) => Promise<void>; identity: () => Identity | null }
const text = z.string().min(1).max(512);
const reference = z.string().regex(/^RZ[A-Za-z0-9]{8,62}$/);
const method = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const amount = z.number().finite().min(0).max(1e9);
const orderSchema = z.object({ id: text, reference, status: z.enum(['pending', 'crediting', 'success', 'failed']),
  amount, currency: z.string().regex(/^[A-Z]{3}$/), credits: amount, provider: text, paymentMethod: method,
  createdAt: z.string().datetime(), paidAt: z.string().datetime().nullable() }).transform(order => ({ ...order, paidAt: order.paidAt ?? null }));
const walletSchema = z.object({ organization: z.object({ id: z.string().uuid(), name: text }),
  balance: z.object({ availableCredits: z.number().finite().min(-1e9).max(1e9), currency: z.string().regex(/^[A-Z]{3}$/), syncStatus: z.enum(['ready', 'unavailable']) }),
  canTopup: z.boolean(), config: z.object({ enabled: z.boolean(), provider: text, currency: z.string().regex(/^[A-Z]{3}$/), creditsPerUnit: z.number().finite().positive().max(1e9),
    minTopup: z.number().int().positive().max(1e9), maxTopup: z.number().int().positive().max(1e9),
    amountOptions: z.array(z.number().int().positive().max(1e9)).max(50), methods: z.array(z.object({ type: method, name: text })).max(20) }),
  orders: z.array(orderSchema).max(50), order: orderSchema.nullable().optional() });
const inputSchema = z.object({ organizationId: z.string().uuid(), amount: z.number().int().positive().max(1e9), paymentMethod: method, requestId: z.string().uuid() }).strict();
const readSchema = z.object({ organizationId: z.string().uuid().optional(), order: reference.optional() }).strict();
const purchaseSchema = z.object({ url: z.string().max(2048), params: z.object({
  pid: text, type: method, out_trade_no: reference, notify_url: z.string().max(2048), return_url: z.string().max(2048),
  name: text, money: z.string().regex(/^\d+\.\d{2}$/), device: z.enum(['pc', 'mobile']), sign_type: z.literal('MD5'), sign: z.string().regex(/^[a-f0-9]{32}$/i),
}).strict() });

/** Only public wallet data crosses IPC. Desktop credentials and cashier tickets stay in main. */
export class AccountWalletClient {
  private creating = new Map<string, Promise<AccountCheckout>>();
  constructor(private deps: Dependencies) {}

  private current(): Identity {
    const identity = this.deps.identity();
    if (!identity) throw new Error('请先登录 Reizo 并刷新账号状态。');
    return identity;
  }
  private assertCurrent(identity: Identity) {
    const current = this.deps.identity();
    if (!current || current.token !== identity.token || current.userId !== identity.userId || current.generation !== identity.generation) throw new Error('账号状态已变化，请重新打开充值面板。');
  }
  private async request(identity: Identity, query = '', input?: AccountTopupInput): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await this.deps.fetch(`${this.deps.origin}/api/desktop-auth/wallet${query}`, {
      method: input ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${identity.token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }); } catch { throw new Error(input ? '订单提交状态未确认，请先刷新充值记录。重试会沿用本次请求编号。' : '暂时无法连接充值服务，请稍后刷新。'); }
    this.assertCurrent(identity);
    if (!response.ok) {
      if (response.status === 401) throw new Error('登录已失效，请重新登录 Reizo。');
      let message = response.status === 404 ? '网页服务尚未启用客户端充值，请更新网页服务。' : response.status === 403 ? '当前账号没有此工作区的充值权限。' : response.status === 429 ? '操作过于频繁，请稍后重试。' : '充值服务暂不可用，请稍后刷新。';
      try {
        const body = await response.json();
        if (typeof body?.code === 'string' && /^(desktop_wallet_error|invalid_topup_amount|invalid_payment_method|topup_|organization_)/.test(body.code) && typeof body.error === 'string') {
          message = body.error.split(identity.token).join('[已隐藏]').replace(/sk-[A-Za-z0-9_-]+/g, '[已隐藏]').replace(/\p{Cc}/gu, ' ').slice(0, 200);
        }
      } catch { /* Never display raw remote error pages. */ }
      throw new Error(message);
    }
    const body = await response.json(); this.assertCurrent(identity);
    return body;
  }
  private parseWallet(body: unknown): AccountWallet {
    const result = walletSchema.safeParse(body);
    if (!result.success || result.data.config.minTopup > result.data.config.maxTopup) throw new Error('充值服务返回的信息无效，请稍后刷新。');
    return result.data;
  }
  async read(input: unknown = {}): Promise<AccountWallet> {
    const parsed = readSchema.safeParse(input);
    if (!parsed.success) throw new Error('充值查询参数无效。');
    const identity = this.current(); const query = new URLSearchParams(parsed.data);
    const wallet = this.parseWallet(await this.request(identity, query.size ? `?${query}` : ''));
    if (parsed.data.organizationId && wallet.organization.id !== parsed.data.organizationId || parsed.data.order && wallet.order?.reference !== parsed.data.order) throw new Error('工作区或订单已变化，请刷新充值信息。');
    return wallet;
  }
  private async checkout(identity: Identity, body: Record<string, unknown>): Promise<AccountCheckout> {
    const order = orderSchema.parse(body.order);
    if (order.status !== 'pending') return { order, cashierOpened: false };
    if (typeof body.cashierUrl !== 'string') throw new Error('订单已创建，但收银台地址暂不可用。请刷新订单后继续付款。');
    const url = new URL(body.cashierUrl);
    const ticket = url.searchParams.get('ticket');
    if (url.origin !== this.deps.origin || url.pathname !== '/api/desktop-auth/cashier' || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].join(',') !== 'ticket' || !ticket || ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('收银台地址无效，请联系管理员。');
    this.assertCurrent(identity);
    let response: Response;
    try { response = await this.deps.fetch(url.href, { headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new Error('暂时无法读取收银台，请在原订单中继续付款。'); }
    this.assertCurrent(identity);
    if (!response.ok) throw new Error('收银台链接已失效或服务暂不可用，请在原订单中重新点击继续付款。');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('网页服务尚未启用客户端内置收银台，请更新网页服务。');
    const parsed = purchaseSchema.safeParse(await response.json());
    if (!parsed.success || !isCashierUrl(parsed.data.url)) throw new Error('收银台支付信息无效，请刷新原订单后重试。');
    const purchase = parsed.data;
    const expectedReturn = new URL('/account/wallet', this.deps.origin); expectedReturn.searchParams.set('order', order.reference);
    if (purchase.params.out_trade_no !== order.reference || purchase.params.type !== order.paymentMethod || purchase.params.money !== order.amount.toFixed(2) ||
      purchase.params.notify_url !== `${this.deps.origin}/api/pay/epay/notify` || purchase.params.return_url !== expectedReturn.href) throw new Error('收银台与原订单信息不符，请刷新后核对。');
    this.assertCurrent(identity);
    try { await this.deps.openCashier({ ...purchase, reference: order.reference, amount: order.amount, currency: order.currency }); return { order, cashierOpened: true }; }
    catch { return { order, cashierOpened: false }; }
  }
  create(value: unknown): Promise<AccountCheckout> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) return Promise.reject(new Error('请选择有效的工作区、金额和支付方式。'));
    const identity = this.current(); const input = parsed.data;
    const key = JSON.stringify([identity.token, identity.generation, input]);
    const active = this.creating.get(key); if (active) return active;
    const pending = this.request(identity, '', input).then(body => {
      const order = orderSchema.parse(body.order);
      if (order.amount !== input.amount || order.paymentMethod !== input.paymentMethod) throw new Error('订单金额或支付方式与本次选择不符，请刷新后核对。');
      return this.checkout(identity, body);
    }).finally(() => this.creating.delete(key));
    this.creating.set(key, pending); return pending;
  }
  async open(value: unknown): Promise<AccountCheckout> {
    const parsed = readSchema.required().parse(value); const identity = this.current();
    const body = await this.request(identity, `?${new URLSearchParams(parsed)}`);
    const wallet = this.parseWallet(body);
    if (wallet.organization.id !== parsed.organizationId || wallet.order?.reference !== parsed.order) throw new Error('此订单不属于当前工作区。');
    return this.checkout(identity, body);
  }
}
