import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, ChevronsUpDown, Copy, Gauge, Info, LoaderCircle, LogIn, LogOut, Monitor, Moon, Palette, RefreshCw, Settings, Sun, UserRound, Wallet } from 'lucide-react';
import { DropdownMenu as Menu } from 'radix-ui';
import { APP_VERSION } from '../../../shared/constants';
import type { AccountState } from '../../../shared/account';
import type { AccountPasswordLogin } from '../../../shared/accountLogin';
import type { Appearance } from '../../../shared/settings';
import { useSettingsStore } from '../../state/useSettingsStore';
import { loadSettings, patchSettings } from '../../state/settingsStore';
import { openSettings } from '../../state/uiStore';
import { toast } from '../../lib/toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import AccountWalletPanel from '../account/AccountWalletPanel';
import AccountPasswordForm from '../account/AccountPasswordForm';

const item = 'flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-paper-inset data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-muted';
const panel = 'z-50 overflow-y-auto rounded-2xl border border-line/70 bg-paper-raised p-1.5 text-ink shadow-[0_8px_36px_-10px_rgba(0,0,0,0.28)] outline-none';
const themes = [{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const;

export default function AccountControl() {
  const [state, setState] = useState<AccountState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'login' | 'account' | 'wallet' | null>(null);
  const [loginMethod, setLoginMethod] = useState<'browser' | 'password'>('browser');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const previous = useRef<AccountState | null>(null);
  const attempt = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const acting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const appearance = useSettingsStore((value) => value.settings.appearance);
  useEffect(() => { setCopiedCode(null); }, [dialog, state?.code]);
  useEffect(() => {
    if (!copiedCode) return;
    const timer = window.setTimeout(() => setCopiedCode(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedCode]);
  const accept = useCallback((next: AccountState) => {
    const completed = next.status === 'authenticated' && (attempt.current || previous.current?.status === 'pending');
    const before = previous.current;
    if (before?.status !== next.status || before?.models?.ready !== next.models?.ready || before?.models?.organizationId !== next.models?.organizationId || before?.models?.catalogVersion !== next.models?.catalogVersion) {
      void loadSettings().catch((): void => undefined);
    }
    previous.current = next;
    setState(next);
    if (completed) {
      attempt.current = false;
      setDialog(null); setMenuOpen(false); setError('');
      toast.success('登录成功', `欢迎回来，${next.user?.displayName || next.user?.username || 'Reizo 用户'}`);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true, reading = false;
    const read = async () => {
      if (reading || acting.current) return;
      reading = true;
      const version = epoch.current;
      try {
        const next = await window.reizo.accountStatus();
        if (active && version === epoch.current) accept(next);
      } catch { if (active && version === epoch.current) setError('账号状态暂不可用，请稍后重试。'); }
      finally { reading = false; }
    };
    void read(); const timer = window.setInterval((): void => { void read(); }, 2000);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',' && !event.altKey && !event.isComposing) {
        event.preventDefault(); setMenuOpen(false); setDialog(null); openSettings();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => { active = false; mounted.current = false; window.clearInterval(timer); window.removeEventListener('keydown', shortcut); };
  }, [accept]);
  async function action(method: 'accountLogin' | 'accountPasswordLogin' | 'accountLogout' | 'accountReopen' | 'accountRefresh', input?: AccountPasswordLogin) {
    if (acting.current) return;
    acting.current = true;
    const version = ++epoch.current;
    setBusy(true); setError('');
    const loggingIn = method === 'accountLogin' || method === 'accountPasswordLogin';
    if (loggingIn) attempt.current = true;
    if (method === 'accountLogout') attempt.current = false;
    try {
      let next: AccountState;
      if (method === 'accountPasswordLogin') {
        if (!input) return;
        next = await window.reizo.accountPasswordLogin(input);
      } else next = await window.reizo[method]();
      if (!mounted.current || version !== epoch.current) return;
      accept(next);
      if (method === 'accountLogout') {
        setDialog(null);
        if (next.message) toast.info('已退出本机登录', next.message);
        else toast.info('已退出登录');
      }
      if (loggingIn && next.status === 'signed-out') {
        attempt.current = false;
        if (next.message) { setError(next.message); toast.error('登录未完成', next.message); }
      }
    } catch {
      if (mounted.current && version === epoch.current) {
        const message = '操作未完成，请稍后重试。若持续失败，请重启工作台。';
        setError(message); toast.error(message);
        if (loggingIn) attempt.current = false;
      }
    } finally {
      acting.current = false;
      if (mounted.current && version === epoch.current) { ++epoch.current; setBusy(false); }
    }
  }
  async function changeAppearance(next: string) {
    try { await patchSettings({ appearance: next as Appearance }); }
    catch { toast.error('外观设置未保存，请重试。'); }
  }
  async function copyLoginCode() {
    const code = state?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      if (mounted.current) setCopiedCode(code);
    } catch { toast.error('复制失败，请选中确认码后手动复制。'); }
  }
  const codeCopied = Boolean(state?.code && copiedCode === state.code);
  const pending = state?.status === 'pending';
  const user = state?.user;
  const name = user?.displayName || user?.username || (pending ? '等待登录' : '未登录');
  const initials = user ? Array.from(name).slice(0, 2).join('').toUpperCase() : '';
  const subtitle = state?.status === 'offline' ? '暂时离线' : state?.models?.ready ? state.models.organizationName || '账号模型已就绪' : user ? user.email || `@${user.username}` : pending ? '在浏览器中继续' : '登录以连接 Reizo 账号';
  const button = 'rounded-lg border border-line px-4 py-2 text-sm hover:bg-paper-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50';
  const avatar = <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold tracking-wide text-ink">{user ? initials : <UserRound size={16} />}</span>;
  const showDialog = (value: 'login' | 'account' | 'wallet') => { setMenuOpen(false); setError(''); if (value === 'login') setLoginMethod('browser'); setDialog(value); };
  return <>
    <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Menu.Trigger asChild>
        <button ref={trigger} type="button" className="group flex w-full items-center gap-3 rounded-xl bg-[var(--sidebar-account)] px-3 py-2.5 text-left outline-none transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-[var(--sidebar-selected)] motion-reduce:transition-none" aria-label="账号菜单">
          {avatar}<span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium leading-5 text-ink">{name}</span><span className="block truncate text-[11px] leading-4 text-ink-muted">{subtitle}</span></span>
          <ChevronsUpDown size={14} aria-hidden className="shrink-0 text-ink-muted opacity-60 group-hover:opacity-100" />
        </button>
      </Menu.Trigger>
      <Menu.Portal><Menu.Content side="top" align="start" sideOffset={8} collisionPadding={12} className={`${panel} w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-24px)] max-h-[var(--radix-dropdown-menu-content-available-height)]`} onCloseAutoFocus={(event) => { if (dialog) event.preventDefault(); }}>
        <Menu.Label className="flex items-center gap-2.5 px-2.5 py-3 font-normal">{avatar}<span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-ink-muted">{subtitle}</span></span></Menu.Label>
        <Menu.Separator className="mx-1 my-1 h-px bg-line/70" />
        {user ? <Menu.Item className={item} onSelect={() => showDialog('account')}><UserRound />账号信息{state?.status === 'offline' && <span className="ml-auto text-xs text-ink-muted">离线</span>}</Menu.Item> :
          <Menu.Item className={item} onSelect={() => showDialog('login')}><LogIn />{pending ? '继续登录' : '登录 Reizo'}</Menu.Item>}
        <Menu.Item className={item} onSelect={() => openSettings('usage')}><Gauge />本机用量</Menu.Item>
        {user ? <Menu.Item className={item} onSelect={() => showDialog('wallet')}><Wallet />钱包与充值</Menu.Item> : null}
        <Menu.Sub><Menu.SubTrigger className={item}><Palette />外观<span className="ml-auto text-xs text-ink-muted">{themes.find((theme) => theme.value === appearance)?.label}</span><ChevronRight className="!size-3" /></Menu.SubTrigger>
          <Menu.Portal><Menu.SubContent sideOffset={5} collisionPadding={12} className={`${panel} min-w-40`}>
            <Menu.RadioGroup value={appearance} onValueChange={(value) => void changeAppearance(value)}>
              {themes.map(({ value, label, icon: Icon }) => <Menu.RadioItem key={value} value={value} className={item}><Icon />{label}<Menu.ItemIndicator className="ml-auto"><Check size={14} /></Menu.ItemIndicator></Menu.RadioItem>)}
            </Menu.RadioGroup>
          </Menu.SubContent></Menu.Portal>
        </Menu.Sub>
        <Menu.Item className={item} onSelect={() => openSettings()}><Settings />设置<span className="ml-auto text-xs text-ink-muted">{window.reizo?.platform === 'darwin' ? '⌘' : 'Ctrl'}+,</span></Menu.Item>
        <Menu.Item className={item} onSelect={() => openSettings('about')}><Info />关于 Reizo<span className="ml-auto text-xs tabular-nums text-ink-muted">{APP_VERSION}</span></Menu.Item>
        {user && <><Menu.Separator className="mx-1 my-1 h-px bg-line/70" /><Menu.Item className={item} disabled={busy} onSelect={() => void action('accountLogout')}><LogOut />退出登录</Menu.Item></>}
        {!dialog && error && <p role="status" className="px-2.5 py-2 text-xs text-ink-muted">{error}</p>}
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
      <DialogContent className={`rounded-2xl border-line bg-paper-raised text-ink ${dialog === 'wallet' ? 'sm:max-w-[560px]' : 'sm:max-w-[400px]'}`} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogHeader className="pr-6"><DialogTitle>{dialog === 'wallet' && user ? '钱包与充值' : dialog === 'account' && user ? '账号信息' : '登录 Reizo Studio'}</DialogTitle>
          <DialogDescription>{dialog === 'wallet' && user ? '选择金额和支付方式，在客户端收银台完成付款。' : dialog === 'account' ? '本机项目保存在当前设备，不会自动同步到账号。' : !pending && loginMethod === 'password' ? '使用 Reizo 账号的用户名或邮箱和密码登录。' : '使用已有的 Reizo 网页账号，在浏览器中完成登录。'}</DialogDescription></DialogHeader>
        {dialog === 'wallet' && user ? <AccountWalletPanel key={user.id} /> : <>
        {!user && !pending && <div role="group" aria-label="登录方式" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-paper-inset p-1">
          {([{ value: 'browser', label: '浏览器登录' }, { value: 'password', label: '账号密码登录' }] as const).map(method => <button key={method.value} type="button" disabled={busy} aria-pressed={loginMethod === method.value} onClick={() => { setLoginMethod(method.value); setError(''); }} className={`rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${loginMethod === method.value ? 'bg-paper-raised font-medium text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}>{method.label}</button>)}
        </div>}
        {user ? <div className="flex items-center gap-3 rounded-xl bg-paper-inset p-4">{avatar}<div className="min-w-0"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-ink-muted">{user.email || `@${user.username}`}</p></div></div> : pending ?
          <div className="space-y-3"><p className="flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />等待浏览器授权</p>
            <div className="relative rounded-xl bg-paper-inset px-5 pb-11 pt-5">
              <p className="select-all text-center font-mono text-3xl tracking-[0.18em]" aria-label="登录确认码">{state.code}</p>
              <button type="button" disabled={!state.code} onClick={() => void copyLoginCode()} aria-label="复制确认码" className="absolute bottom-2 right-2 flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-paper-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
                {codeCopied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}<span aria-live="polite">{codeCopied ? '已复制' : '复制'}</span>
              </button>
            </div>
            <p className="text-xs leading-5 text-ink-muted">在网页中输入上方确认码。授权成功后，此窗口会自动关闭。</p></div> :
          loginMethod === 'password' ? <AccountPasswordForm busy={busy || !state} onSubmit={input => action('accountPasswordLogin', input)} /> : <p className="py-2 text-sm text-ink-muted">点击下方按钮后，将打开系统默认浏览器。</p>}
        {(error || state?.message) && <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-danger' : 'text-ink-muted'}`}>{error || state?.message}</p>}
        {state?.models && <p role="status" className="text-sm text-ink-muted">{state.models.ready ? `账号模型已就绪 · ${state.models.organizationName}` : state.models.message || '账号模型暂不可用，请刷新状态。'}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {user ? <button disabled={busy} className={button} onClick={() => void action('accountRefresh')}><RefreshCw size={13} className="mr-2 inline" />刷新状态</button> : pending ?
            <><button disabled={busy} className={button} onClick={() => void action('accountLogout')}>取消登录</button><button disabled={busy} className={button} onClick={() => void action('accountReopen')}>重新打开浏览器</button></> :
            loginMethod === 'browser' ? <button disabled={busy || !state} className={`${button} !border-transparent bg-accent text-accent-ink hover:!bg-accent/90`} onClick={() => void action('accountLogin')}>{busy ? '正在打开…' : '使用浏览器登录'}</button> : null}
        </div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
