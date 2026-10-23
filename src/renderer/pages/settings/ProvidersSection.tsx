import { useEffect, useRef, useState } from 'react';
import { Check, KeyRound, Search, ShieldCheck } from 'lucide-react';
import type { PublicProvider } from '../../../shared/settings';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import { Input } from '../../components/motion/input';

export default function ProvidersSection() {
  const settings = useSettingsStore((s) => s.settings);
  const [selectedId, setSelectedId] = useState(settings.activeProviderId);
  const [query, setQuery] = useState('');
  const selected = settings.providers.find((p) => p.id === selectedId) ?? settings.providers[0];
  const visible = settings.providers.filter((p) => `${p.name} ${p.tag} ${p.model}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="mb-5 pr-7">
        <h1 className="text-xl font-semibold tracking-tight">模型</h1>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">选择供应商，配置密钥和默认对话模型。</p>
      </header>
      <div className="flex min-h-0 flex-1 gap-5 max-lg:flex-col">
        <aside aria-label="模型供应商" className="flex w-48 shrink-0 flex-col border-r border-line pr-4 max-lg:w-full max-lg:border-b max-lg:border-r-0 max-lg:pb-3 max-lg:pr-0">
          <label className="mb-3 flex items-center gap-2 rounded-lg bg-paper-inset px-2.5 py-2 text-ink-muted">
            <Search size={14} className="shrink-0" />
            <input aria-label="搜索供应商" placeholder="搜索供应商" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted" />
          </label>
          <p className="mb-2 text-[11px] text-ink-muted">供应商 · {settings.providers.filter((p) => p.hasKey).length} 个已配置</p>
          <div className="min-h-0 space-y-1 overflow-y-auto max-lg:flex max-lg:gap-1 max-lg:space-y-0 max-lg:overflow-x-auto">
            {visible.map((provider) => (
              <button type="button" key={provider.id} aria-pressed={selected?.id === provider.id} onClick={() => setSelectedId(provider.id)} className={cn('flex w-full items-center gap-2 rounded-xl p-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent max-lg:w-44 max-lg:shrink-0', selected?.id === provider.id ? 'bg-paper-inset' : 'hover:bg-paper-inset/60')}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-raised text-xs font-semibold" aria-hidden>{provider.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-medium"><span className="truncate">{provider.name}</span>{provider.id === settings.activeProviderId && <span className="shrink-0 rounded bg-success-bg px-1 text-[10px] text-success">默认</span>}</span>
                  <span className="mt-1 block truncate text-[11px] text-ink-muted">{provider.hasKey ? provider.model : provider.id === 'reizo-account' ? '请登录并刷新账号状态' : '尚未配置密钥'}</span>
                </span>
              </button>
            ))}
            {!visible.length && <p role="status" className="p-2 text-xs text-ink-muted">没有匹配的供应商</p>}
          </div>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-1">
          {/* Keep drafts local and mounted while browsing providers. Selection never writes settings. */}
          {settings.providers.map((provider) => (
            <div key={provider.id} hidden={provider.id !== selected?.id}>
              <ProviderDetail provider={provider} active={provider.id === settings.activeProviderId} />
            </div>
          ))}
          {!selected && <p role="status" className="text-sm text-ink-muted">暂无可配置的供应商</p>}
        </div>
      </div>
    </section>
  );
}

export function ProviderDetail({ provider, active }: { provider: PublicProvider; active: boolean }) {
  const accountProvider = provider.id === 'reizo-account';
  const [keyInput, setKeyInput] = useState('');
  const [editingKey, setEditingKey] = useState(!provider.hasKey);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [model, setModel] = useState(provider.model);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const dirty = Boolean(keyInput.trim()) || model !== provider.model || (provider.allowCustomBaseUrl && baseUrl !== provider.baseUrl);
  const canSave = Boolean(model.trim()) && (provider.hasKey || Boolean(keyInput.trim()) || Boolean(provider.allowCustomBaseUrl)) && (!provider.allowCustomBaseUrl || Boolean(baseUrl.trim()));
  useEffect(() => { if (accountProvider) setModel(provider.model); }, [accountProvider, provider.model]);

  async function save() {
    if (pending.current || !canSave) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await settingsStore.patchSettings({
        provider: { id: provider.id, ...(keyInput.trim() ? { apiKey: keyInput.trim() } : {}), model: model.trim(), ...(provider.allowCustomBaseUrl ? { baseUrl: baseUrl.trim() } : {}) },
        activeProviderId: provider.id,
      });
      setKeyInput(''); setEditingKey(false);
      toast.success(`${provider.name} 已保存并设为默认`);
    } catch {
      setError('保存失败，输入内容已保留，请检查配置后重试。');
    } finally { pending.current = false; setBusy(false); }
  }
  async function removeKey() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await settingsStore.patchSettings({ provider: { id: provider.id, apiKey: '' } });
      setEditingKey(true); setKeyInput('');
      toast.info(`${provider.name} 密钥已移除`);
    } catch { setError('移除失败，原密钥仍保留，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  return (
    <form aria-label={`${provider.name} 配置`} onSubmit={(event) => { event.preventDefault(); void save(); }} className="rounded-2xl border border-line bg-paper-raised p-5 max-sm:p-4">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{provider.name}</h2>
          <span className="mt-1 inline-block text-xs text-ink-muted">{provider.tag}</span>
        </div>
        {active && <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-2 py-1 text-[11px] text-success"><Check size={12} />默认供应商</span>}
      </header>
      {provider.description && <p className="mb-5 text-xs leading-relaxed text-ink-muted">{provider.description}</p>}
      <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-60">
        {accountProvider ? <p role="status" className="rounded-xl bg-paper-inset p-3 text-xs leading-relaxed text-ink-muted">{provider.hasKey ? '已连接当前工作区，模型凭据由账号自动管理。' : '请从左下角登录 Reizo，再在账号信息中刷新状态，无需填写 API Key。'}</p> : <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium">API 密钥</span>
            {provider.hasKey && <span className="text-success">已配置</span>}
          </div>
          {provider.hasKey && !editingKey ? (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-3 text-ink-muted"><KeyRound size={14} /><span aria-label="密钥已保存" className="truncate text-sm tracking-widest">••••••••••••••••••••••••</span></div>
          ) : (
            <Input aria-label={`${provider.name} API 密钥`} type="password" autoComplete="off" spellCheck={false} value={keyInput} onChange={setKeyInput} placeholder={provider.id === 'reizo' ? '粘贴虚拟 sk-... 密钥' : '输入 API Key'} leftIcon={<KeyRound size={14} />} className="w-full text-sm" />
          )}
          {provider.hasKey && <div className="mt-2 flex justify-end gap-3 text-xs">
            <button type="button" onClick={() => { setEditingKey(!editingKey); setKeyInput(''); }} className="text-ink-muted hover:text-ink">{editingKey ? '取消更换' : '更换密钥'}</button>
            <button type="button" onClick={() => void removeKey()} className="text-danger hover:opacity-80">移除密钥</button>
          </div>}
        </div>}
        {provider.allowCustomBaseUrl && <Input label="服务地址（Base URL）" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" className="w-full text-sm" />}
        <div className="rounded-xl bg-paper-inset/60 p-4">
          {provider.allowCustomBaseUrl ? <Input label="默认模型 ID" value={model} onChange={setModel} placeholder="例如 deepseek-chat" className="w-full text-sm" /> : (
            <label className="block text-xs font-medium">默认对话模型
              <select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full min-w-0 rounded-lg border border-line bg-paper-raised px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent">
                {!provider.models.some((item) => item.id === model) && <option value={model}>{model || '请选择模型'}</option>}
                {provider.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">保存后用作默认对话模型，也可在输入框中切换。</p>
        </div>
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-muted"><ShieldCheck size={14} className="mt-0.5 shrink-0" /><span>{accountProvider ? '退出登录后，本机停止使用账号模型；再次登录会重新验证权限。' : '密钥经系统级加密后仅保存在本机。'}</span></div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <button type="submit" disabled={!canSave || busy || (active && !dirty)} className="w-full rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper-raised hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? '正在保存…' : active && !dirty ? '已是默认配置' : '保存并使用'}
        </button>
      </fieldset>
    </form>
  );
}
