import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';

const MODES: Array<{ id: api.NetworkSettings['mode']; label: string; hint: string }> = [
  { id: 'direct', label: '直连', hint: '不使用代理' },
  { id: 'system', label: '系统代理', hint: '跟随系统设置里的代理（Clash 等开了"系统代理"即可）' },
  { id: 'custom', label: '自定义', hint: '手动填写代理地址' },
];

/** How the app reaches the internet: direct, the system proxy, or one address. Applies at once; child processes inherit it. */
function EgressBlock() {
  const [egress, setEgress] = useState<api.EgressSettingsDto | null>(null);
  const [blocked, setBlocked] = useState<Array<{ host: string; at: number }>>([]);
  const [text, setText] = useState('');
  useEffect(() => {
    void api.getEgressSettings().then((d) => { setEgress(d.settings); setText(d.settings.allow.join(String.fromCharCode(10))); setBlocked(d.blocked); }, (): void => undefined);
  }, []);
  if (!egress) return null;
  async function save(next: api.EgressSettingsDto) {
    try { const saved = await api.saveEgressSettings(next); setEgress(saved); setText(saved.allow.join(String.fromCharCode(10))); }
    catch (error) { toast.error('保存失败', error instanceof Error ? error.message : undefined); }
  }
  return (
    <div className="mt-6 border-t border-line pt-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={egress.enabled} onChange={(e) => void save({ ...egress, enabled: e.target.checked })} />
        限制 Agent 命令的联网范围
      </label>
      <p className="mt-1 text-xs text-ink-muted">开启后 Agent 运行的命令只能访问常见包管理源、代码托管，以及下面你加入的域名；其余会被拦下并提示。只约束遵守代理设置的程序（curl、npm、pip、git 等），不是系统级沙箱。</p>
      {egress.enabled && (
        <>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-ink-muted">额外允许（每行一个：域名、*.域名、IP 或 IP/掩码）</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void save({ ...egress, allow: text.split(String.fromCharCode(10)) })} rows={4} className="w-full max-w-sm rounded-lg bg-paper-inset px-3 py-1.5 font-mono text-xs text-ink outline-none" />
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={egress.allowPrivate} onChange={(e) => void save({ ...egress, allowPrivate: e.target.checked })} />
            允许访问本机与内网地址（需同时在上面写明）
          </label>
          {blocked.length > 0 && (
            <div className="mt-3 text-xs text-ink-muted">
              最近被拦：
              {blocked.slice(0, 6).map((b) => (
                <button key={b.host} type="button" title="加入允许列表" onClick={() => void api.allowEgressHost(b.host).then((s) => { setEgress(s); setText(s.allow.join(String.fromCharCode(10))); setBlocked((list) => list.filter((x) => x.host !== b.host)); })} className="ml-2 rounded-full bg-paper-inset px-2 py-0.5 text-ink hover:bg-paper-inset/70">{b.host} ＋</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function NetworkSection() {
  const [settings, setSettings] = useState<api.NetworkSettings>({ mode: 'direct' });
  const [effective, setEffective] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    void api.getNetworkSettings().then((data) => { setSettings(data.settings); setEffective(data.effective); setLoaded(true); }, (): void => setLoaded(true));
  }, []);

  async function save(next: api.NetworkSettings) {
    setSettings(next);
    setSaving(true);
    setResult(null);
    try {
      const saved = await api.saveNetworkSettings(next);
      setEffective(saved.effective);
      if (saved.error) toast.error('代理未生效', saved.error);
    } catch (error) {
      toast.error('保存失败', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try { setResult(await api.testNetwork()); }
    catch (error) { setResult({ ok: false, detail: error instanceof Error ? error.message : '测试失败' }); }
    finally { setTesting(false); }
  }

  if (!loaded) return null;
  return (
    <section className="mb-8 max-w-3xl">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Globe size={16} /> 网络</h2>
      <p className="mb-3 text-sm text-ink-muted">模型服务等联网请求以及 Agent 运行的命令会按这里的设置访问网络。大多数人保持"直连"即可。</p>

      <div className="mb-3 flex flex-wrap gap-2">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            title={mode.hint}
            onClick={() => void save({ ...settings, mode: mode.id })}
            className={cn('rounded-full px-4 py-1.5 text-sm transition-colors', settings.mode === mode.id ? 'bg-ink font-medium text-paper-raised' : 'bg-paper-inset text-ink hover:bg-paper-inset/70')}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-ink-muted">{MODES.find((m) => m.id === settings.mode)?.hint}{settings.mode !== 'direct' && effective ? ` · 当前生效：${effective}` : ''}{settings.mode === 'system' && !effective ? ' · 系统当前没有设置代理，按直连处理' : ''}</p>

      {settings.mode === 'custom' && (
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-ink-muted">代理地址</span>
          <input
            value={settings.url ?? ''}
            onChange={(e) => setSettings({ ...settings, url: e.target.value })}
            onBlur={() => void save(settings)}
            placeholder="http://127.0.0.1:7890"
            className="w-full max-w-sm rounded-lg bg-paper-inset px-3 py-1.5 text-sm text-ink outline-none"
          />
        </label>
      )}
      {settings.mode !== 'direct' && (
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-ink-muted">不走代理的域名（逗号分隔，可选）</span>
          <input
            value={settings.bypass ?? ''}
            onChange={(e) => setSettings({ ...settings, bypass: e.target.value })}
            onBlur={() => void save(settings)}
            placeholder=".corp.example.com, intranet"
            className="w-full max-w-sm rounded-lg bg-paper-inset px-3 py-1.5 text-sm text-ink outline-none"
          />
        </label>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void test()} disabled={testing || saving} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-50">{testing ? '测试中…' : '测试连通'}</button>
        {result && <span className={cn('text-sm', result.ok ? 'text-emerald-600' : 'text-danger')}>{result.detail}</span>}
      </div>
      <EgressBlock />
    </section>
  );
}
