import { createHash } from 'node:crypto';
import type { AccountModelCredential, AccountState, AccountUser } from '../../shared/account';
import { parseModelCatalog } from '../../shared/modelCatalog';

export interface AccountCredential { token: string; origin: string; expiresAt: string; user: AccountUser; models?: AccountModelCredential }
export interface AccountDependencies {
  origin: string;
  fetch: typeof fetch;
  read: () => AccountCredential | null;
  write: (credential: AccountCredential | null) => void;
  open: (url: string) => Promise<void>;
  connected: () => void;
  now?: () => number;
  modelSessions?: boolean;
}

export function accountOrigin(value: string, development = false): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('账号服务地址必须为 HTTPS 网站地址。');
  }
  return url.origin;
}

function isUser(value: unknown): value is AccountUser {
  if (!value || typeof value !== 'object') return false;
  const u = value as AccountUser;
  return typeof u.id === 'string' && typeof u.username === 'string' && typeof u.displayName === 'string' && (u.email === null || typeof u.email === 'string');
}
function future(value: unknown, now: number): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now; }
class AccountHttpError extends Error { constructor(public readonly status: number, message: string) { super(message); } }

export class AccountService {
  private credential: AccountCredential | null = null;
  private pending: { token: string; url: string; code: string; expiresAt: string } | null = null;
  private state: AccountState;
  private generation = 0;
  private starting = false;
  private refreshing: Promise<AccountState> | null = null;
  private now: () => number;
  constructor(private deps: AccountDependencies) {
    this.now = deps.now ?? Date.now;
    this.state = { status: 'signed-out', webOrigin: deps.origin };
    try {
      const saved = deps.read();
      if (saved && saved.origin === deps.origin && /^[A-Za-z0-9_-]{43}$/.test(saved.token) && isUser(saved.user) && future(saved.expiresAt, this.now())) {
        this.credential = saved;
        this.state = { status: 'offline', webOrigin: deps.origin, user: saved.user, expiresAt: saved.expiresAt, message: '正在验证登录状态…' };
      } else if (saved) deps.write(null);
    } catch { this.state.message = '无法读取已保存的登录信息，请重新登录。'; }
  }
  snapshot(): AccountState {
    const models = this.state.models ? { ...this.state.models } : undefined;
    if (models?.ready && !this.modelCredential()) {
      models.ready = false;
      models.message = '账号模型凭据已过期或连接中断，请刷新状态。';
    }
    return { ...this.state, ...(this.state.user ? { user: { ...this.state.user } } : {}), ...(models ? { models } : {}) };
  }
  /** Cached disk credentials are unusable until this process has revalidated the account. */
  modelCredential(): AccountModelCredential | null {
    const models = this.credential?.models;
    return this.state.status === 'authenticated' && models && future(models.expiresAt, this.now()) && future(this.credential?.expiresAt, this.now())
      ? structuredClone(models) : null;
  }
  dispose(): void { ++this.generation; this.credential = null; this.pending = null; this.state = { status: 'signed-out', webOrigin: this.deps.origin }; }
  private invalidate(message: string) {
    ++this.generation; this.pending = null; this.credential = null;
    this.state = { status: 'signed-out', webOrigin: this.deps.origin, message };
    try { this.deps.write(null); }
    catch { this.state.message += ' 本机旧凭据文件未能移除，下次启动仍会重新验证。'; }
  }
  private async request(path: string, method: string, token?: string): Promise<Record<string, unknown>> {
    const response = await this.deps.fetch(`${this.deps.origin}/api/desktop-auth/${path}`, {
      method, headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    // Never surface remote response text (which could contain sensitive details).
    if (!response.ok) throw new AccountHttpError(response.status, response.status === 404 ? '网站尚未启用桌面登录，请先更新网页服务。' : response.status === 429 ? '请求过于频繁，请稍后重试。' : '账号服务暂不可用，请稍后重试。');
    return await response.json() as Record<string, unknown>;
  }
  private revoke(token: string) { return this.request('session', 'DELETE', token); }
  async start(): Promise<AccountState> {
    if (this.starting) return this.snapshot();
    if (this.pending) { await this.reopen(); return this.snapshot(); }
    if (this.credential) return this.snapshot();
    this.starting = true;
    const generation = ++this.generation;
    let issuedToken: string | undefined;
    try {
      const result = await this.request('start', 'POST');
      if (typeof result.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(result.token)) issuedToken = result.token;
      if (!issuedToken || typeof result.code !== 'string' || !/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(result.code) || !future(result.expiresAt, this.now()) || typeof result.requestId !== 'string') throw new Error('登录服务响应无效，请稍后重试。');
      const url = new URL(String(result.verificationUrl));
      if (url.origin !== this.deps.origin || url.username || url.password || url.pathname !== '/desktop/connect' || url.search !== `?request=${result.requestId}` || url.hash) throw new Error('登录服务返回了不受信任的地址。');
      if (generation !== this.generation) { await this.revoke(issuedToken).catch((): void => undefined); return this.snapshot(); }
      this.pending = { token: issuedToken, url: url.href, code: result.code, expiresAt: result.expiresAt };
      this.state = { status: 'pending', webOrigin: this.deps.origin, code: result.code, expiresAt: result.expiresAt };
      try { await this.deps.open(url.href); }
      catch { if (generation === this.generation) this.state.message = '未能打开浏览器，请点击“重新打开浏览器”。'; }
    } catch (error) {
      if (issuedToken) await this.revoke(issuedToken).catch((): void => undefined);
      if (generation === this.generation) {
        this.pending = null;
        this.state = { status: 'signed-out', webOrigin: this.deps.origin, message: error instanceof AccountHttpError ? error.message : '无法发起登录，请检查网络和账号服务。' };
      }
    } finally { this.starting = false; }
    return this.snapshot();
  }
  async reopen(): Promise<void> {
    if (this.pending) await this.deps.open(this.pending.url);
  }
  refresh(): Promise<AccountState> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshOnce().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  private async refreshOnce(): Promise<AccountState> {
    const active = this.pending ?? this.credential;
    if (!active) return this.snapshot();
    const generation = this.generation;
    if (!future(active.expiresAt, this.now())) {
      this.invalidate('登录已过期，请重新登录。');
      void this.revoke(active.token).catch((): void => undefined);
      return this.snapshot();
    }
    try {
      const result = await this.request('session', 'GET', active.token);
      if (generation !== this.generation) return this.snapshot();
      if (result.status === 'pending' && this.pending) { this.state.message = undefined; return this.snapshot(); }
      if (result.status !== 'authenticated' || !isUser(result.user) || !future(result.expiresAt, this.now())) throw new Error('Invalid session');
      const newlyConnected = Boolean(this.pending);
      let models: AccountModelCredential | undefined;
      let modelMessage: string | undefined;
      if (this.deps.modelSessions) {
        try {
          const payload = await this.request('model-session', 'GET', active.token);
          if (generation !== this.generation) return this.snapshot();
          const value = payload.credential as AccountModelCredential | undefined;
          const catalog = parseModelCatalog(value?.catalog);
          const url = new URL(value?.baseUrl ?? '');
          const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
          if (!value || typeof value.organizationId !== 'string' || !value.organizationId || typeof value.organizationName !== 'string' ||
            typeof value.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]+$/.test(value.apiKey) || !future(value.expiresAt, this.now()) ||
            Date.parse(value.expiresAt) > Date.parse(result.expiresAt) || url.username || url.password || url.search || url.hash ||
            (url.protocol !== 'https:' && !(local && new URL(this.deps.origin).protocol === 'http:' && url.protocol === 'http:')) ||
            !Array.isArray(value.models) || (!value.models.length && !catalog?.image.length && !catalog?.video.length) || value.models.some(m => !m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string')) throw new Error('Invalid model session');
          models = { organizationId: value.organizationId, organizationName: value.organizationName, apiKey: value.apiKey, baseUrl: url.href.replace(/\/$/, ''), expiresAt: value.expiresAt,
            models: value.models.map(m => ({ id: m.id, name: m.name })), ...(catalog ? { catalog } : {}) };
        } catch (error) {
          if (generation !== this.generation) return this.snapshot();
          if (error instanceof AccountHttpError && error.status === 401) { this.invalidate('登录已失效，请重新登录。'); return this.snapshot(); }
          modelMessage = error instanceof AccountHttpError && error.status === 404 ? '网站尚未启用账号模型，请更新网页服务。' : '账号模型暂不可用，请刷新状态或联系工作区管理员。';
        }
      }
      if (generation !== this.generation) return this.snapshot();
      const saved: AccountCredential = { token: active.token, origin: this.deps.origin, expiresAt: result.expiresAt, user: result.user, ...(models ? { models } : {}) };
      try { this.deps.write(saved); }
      catch {
        this.pending = null; this.credential = null; ++this.generation;
        this.state = { status: 'signed-out', webOrigin: this.deps.origin, message: '无法安全保存登录凭据，请检查系统加密服务或磁盘空间后重试。' };
        await this.revoke(active.token).catch((): void => undefined);
        return this.snapshot();
      }
      this.credential = saved; this.pending = null;
      this.state = { status: 'authenticated', webOrigin: this.deps.origin, user: saved.user, expiresAt: saved.expiresAt,
        ...(this.deps.modelSessions ? { models: { ready: !!models, organizationId: models?.organizationId, organizationName: models?.organizationName,
          catalogVersion: models ? createHash('sha256').update(JSON.stringify([models.models, models.catalog])).digest('hex') : undefined, message: modelMessage } } : {}) };
      if (newlyConnected) {
        try { this.deps.connected(); }
        catch { this.state.message = '已登录，请手动返回工作台。'; }
      }
    } catch (error) {
      if (generation !== this.generation) return this.snapshot();
      if (error instanceof AccountHttpError && [401, 403].includes(error.status)) {
        this.invalidate('登录已失效或账号状态已变化，请重新登录。');
      } else {
        this.state = { ...this.state, status: this.pending ? 'pending' : 'offline', message: error instanceof AccountHttpError ? error.message : '暂时无法连接账号服务，恢复网络后将重试。' };
      }
    }
    return this.snapshot();
  }
  async logout(): Promise<AccountState> {
    const token = (this.pending ?? this.credential)?.token;
    // Clear durable credentials before declaring success. A write failure is surfaced.
    this.deps.write(null); ++this.generation; this.pending = null; this.credential = null;
    const generation = this.generation;
    this.state = { status: 'signed-out', webOrigin: this.deps.origin };
    if (token) {
      try { await this.revoke(token); }
      catch { if (generation === this.generation) this.state.message = '已退出本机登录；网络异常，服务器凭据撤销尚未确认。'; }
    }
    return this.snapshot();
  }
}
