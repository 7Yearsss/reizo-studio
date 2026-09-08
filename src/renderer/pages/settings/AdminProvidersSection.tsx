import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Key,
  Plus,
  Lock,
  Sparkles,
  Check,
  Trash2,
  Settings2,
  Activity,
  Globe,
  Star,
  Loader2,
  Volume2,
  Video,
  Image as ImageIcon,
  Bot,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import * as api from '../../api';
import { loadProviderCatalog } from '../../state/providerCatalogStore';
import {
  DEFAULT_PROVIDER_TEMPLATES,
  type ManagedProviderConfig,
  type ProviderCategory,
} from '../../../shared/providerRegistry';

export function AdminProvidersSection() {
  const [passkey, setPasskey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [providers, setProviders] = useState<ManagedProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ProviderCategory>('all');

  // Edit / Create Modal State
  const [editingProvider, setEditingProvider] = useState<Partial<ManagedProviderConfig> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [testTestingId, setTestTestingId] = useState<string | null>(null);

  async function handleUnlock() {
    if (!passkey.trim()) {
      toast.error('请输入管理员口令');
      return;
    }
    setVerifying(true);
    try {
      const res = await api.verifyAdminPasskey(passkey.trim());
      if (!res.ok) {
        toast.error(res.error || '口令错误，无法解锁管理后台');
        setVerifying(false);
        return;
      }
      setUnlocked(true);
      await fetchProviders(passkey.trim());
      toast.success('已解锁平台管理后台');
    } catch (err: any) {
      toast.error(err?.message || '验证口令请求失败');
    } finally {
      setVerifying(false);
    }
  }

  async function fetchProviders(key: string) {
    setLoading(true);
    try {
      const list = await api.getAdminProviders(key);
      setProviders(list);
    } catch (err: any) {
      toast.error(err.message || '加载服务商列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetDefault(p: ManagedProviderConfig) {
    try {
      await api.setDefaultAdminProvider(passkey, p.category, p.id);
      await fetchProviders(passkey);
      void loadProviderCatalog(true);
      toast.success(`已将 ${p.name} 设为 ${p.category} 模态的默认服务商`);
    } catch {
      toast.error('设为默认失败');
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定要删除服务商 "${name}" 吗？此操作无法撤销。`)) return;
    try {
      await api.deleteAdminProvider(passkey, id);
      await fetchProviders(passkey);
      void loadProviderCatalog(true);
      toast.info(`已删除服务商 ${name}`);
    } catch {
      toast.error('删除服务商失败');
    }
  }

  async function handleTest(id: string, name: string) {
    setTestTestingId(id);
    try {
      const res = await api.testAdminProvider(passkey, id);
      if (res.ok) {
        toast.success(`${name}: ${res.message || '连通性正常'}`);
      } else {
        toast.error(`${name}: ${res.error || '连通性测试失败'}`);
      }
    } catch (err: any) {
      toast.error(`测试异常: ${err.message}`);
    } finally {
      setTestTestingId(null);
    }
  }

  async function handleSaveProvider(item: Partial<ManagedProviderConfig>) {
    if (!item.id?.trim() || !item.name?.trim() || !item.category || !item.driverType) {
      toast.error('请填写完整的服务商 ID、名称、模态与驱动类型');
      return;
    }
    try {
      await api.saveAdminProvider(passkey, item as any);
      setModalOpen(false);
      setEditingProvider(null);
      await fetchProviders(passkey);
      void loadProviderCatalog(true);
      toast.success(`服务商 ${item.name} 配置已保存`);
    } catch (err: any) {
      toast.error(err.message || '保存配置失败');
    }
  }

  if (!unlocked) {
    return (
      <div className="flex max-w-md flex-col items-center justify-center rounded-2xl border border-line bg-paper-raised p-8 text-center shadow-sm">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent/15 text-accent shadow-xs">
          <ShieldAlert size={24} />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-ink">平台管理中心门禁</h2>
        <p className="mb-6 text-xs text-ink-muted">
          管理后台集中配置各模态的 Master API Key 与样例参数模板。为了防止密钥泄漏，需要管理员口令解锁。
        </p>

        <div className="w-full space-y-3">
          <input
            type="password"
            value={passkey}
            onChange={(e) => setPasskey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleUnlock()}
            placeholder="请输入管理员口令 (初始默认: admin888)"
            className="w-full rounded-lg border border-line bg-paper-inset px-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-hidden"
          />
          <button
            type="button"
            onClick={() => void handleUnlock()}
            disabled={verifying}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-medium text-accent-ink shadow-xs hover:opacity-90 active:scale-98 transition-all disabled:opacity-50"
          >
            {verifying ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
            解锁平台管理
          </button>
        </div>
      </div>
    );
  }

  const filteredProviders = providers.filter(
    (p) => categoryFilter === 'all' || p.category === categoryFilter,
  );

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink">平台服务商与模型配置中心</h1>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              已解锁 (管理员模式)
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            在此配置 MiniMax、阿里百炼 CosyVoice、可灵等上游供应商的 API Key 及默认参数模板。前端用户仅可读取公开脱敏信息。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingProvider({
                id: `custom-${Date.now().toString(36)}`,
                name: '',
                category: 'audio',
                driverType: 'mock',
                credentials: { apiKey: '', baseUrl: '' },
                sampleParams: {},
                enabled: true,
                isDefault: false,
              });
              setModalOpen(true);
            }}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink shadow-xs hover:opacity-90 active:scale-95 transition-all"
          >
            <Plus size={13} />
            新建服务商
          </button>
          <button
            type="button"
            onClick={() => setUnlocked(false)}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            title="锁定管理后台"
          >
            <Lock size={12} />
            锁定
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 border-b border-line/60 pb-2 text-xs">
        {(
          [
            ['all', '全部服务商', null],
            ['audio', '语音 (Audio)', Volume2],
            ['video', '视频 (Video)', Video],
            ['image', '图片 (Image)', ImageIcon],
            ['llm', '语言模型 (LLM)', Bot],
          ] as const
        ).map(([cat, label, Icon]) => {
          const active = categoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat as any)}
              className={cn(
                'flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                active
                  ? 'bg-paper-inset font-semibold text-ink shadow-2xs'
                  : 'text-ink-muted hover:bg-paper-inset/50 hover:text-ink',
              )}
            >
              {Icon ? <Icon size={12} /> : null}
              {label}
            </button>
          );
        })}
      </div>

      {/* Provider Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-ink-muted">
          <Loader2 size={20} className="animate-spin mr-2" /> 正在加载服务商配置...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredProviders.map((p) => {
            const isTesting = testTestingId === p.id;
            return (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-line bg-paper-raised p-4 transition-all hover:border-line/90 shadow-2xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-ink text-sm">{p.name}</h3>
                      {p.isDefault ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-semibold text-accent">
                          <Star size={9} className="fill-current" /> 默认
                        </span>
                      ) : null}
                    </div>

                    <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[10px] uppercase font-mono text-ink-muted">
                      {p.category} · {p.driverType}
                    </span>
                  </div>

                  <p className="text-xs text-ink-muted line-clamp-2 mb-3">
                    {p.description || '暂无描述'}
                  </p>

                  <div className="space-y-1.5 rounded-lg bg-paper-inset/60 p-2.5 text-[11px] text-ink-muted font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-ink/70">Master Key:</span>
                      <span className="font-semibold text-ink">{p.credentials.apiKey || '(未配置)'}</span>
                    </div>
                    {p.credentials.baseUrl ? (
                      <div className="flex items-center justify-between truncate">
                        <span className="text-ink/70">Endpoint:</span>
                        <span className="truncate max-w-[200px]" title={p.credentials.baseUrl}>
                          {p.credentials.baseUrl}
                        </span>
                      </div>
                    ) : null}
                    {p.sampleParams && Object.keys(p.sampleParams).length > 0 ? (
                      <div className="flex items-center justify-between truncate pt-1 border-t border-line/30">
                        <span className="text-ink/70">样例模板:</span>
                        <span className="truncate max-w-[200px]">
                          {p.sampleParams.model ? `${String(p.sampleParams.model)} / ` : ''}
                          {p.sampleParams.voice_id || p.sampleParams.voice ? String(p.sampleParams.voice_id || p.sampleParams.voice) : '标准'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between pt-2 border-t border-line/50 text-xs">
                  <div className="flex items-center gap-1.5">
                    {!p.isDefault ? (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(p)}
                        className="rounded px-2 py-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors text-[11px]"
                      >
                        设为默认
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleTest(p.id, p.name)}
                      disabled={isTesting}
                      className="flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors text-[11px]"
                    >
                      {isTesting ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
                      连通测试
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingProvider({ ...p });
                        setModalOpen(true);
                      }}
                      className="flex items-center gap-1 rounded-md bg-paper-inset px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-paper-inset/80 transition-colors"
                    >
                      <Settings2 size={11} />
                      配置
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(p.id, p.name)}
                      className="rounded p-1 text-ink-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      title="删除服务商"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit / Create Modal */}
      {modalOpen && editingProvider ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper-raised p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-base font-semibold text-ink">
                {providers.some((p) => p.id === editingProvider.id) ? '编辑服务商配置' : '新建服务商配置'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-xs text-ink-muted hover:text-ink"
              >
                关闭
              </button>
            </div>

            {/* Quick template loader */}
            {!providers.some((p) => p.id === editingProvider.id) ? (
              <div className="rounded-lg bg-paper-inset/70 p-3 text-xs space-y-1.5">
                <span className="font-medium text-ink">从官方模板快速填充：</span>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DEFAULT_PROVIDER_TEMPLATES.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => {
                        setEditingProvider({
                          ...tmpl,
                          id: `${tmpl.driverType}-${Date.now().toString(36)}`,
                          credentials: { ...tmpl.credentials },
                        });
                      }}
                      className="rounded bg-paper-raised border border-line px-2 py-0.5 text-[11px] text-ink hover:border-accent transition-colors"
                    >
                      {tmpl.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-ink-muted mb-1">服务商 ID (唯一标识)</label>
                <input
                  type="text"
                  value={editingProvider.id ?? ''}
                  onChange={(e) => setEditingProvider({ ...editingProvider, id: e.target.value })}
                  placeholder="如: minimax-audio-prod"
                  className="w-full rounded-lg border border-line bg-paper-inset px-3 py-1.5 text-xs text-ink font-mono"
                />
              </div>

              <div>
                <label className="block text-ink-muted mb-1">显示名称</label>
                <input
                  type="text"
                  value={editingProvider.name ?? ''}
                  onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })}
                  placeholder="如: MiniMax 语音 (海螺大模型)"
                  className="w-full rounded-lg border border-line bg-paper-inset px-3 py-1.5 text-xs text-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-muted mb-1">模态类型</label>
                  <select
                    value={editingProvider.category ?? 'audio'}
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        category: e.target.value as ProviderCategory,
                      })
                    }
                    className="w-full rounded-lg border border-line bg-paper-inset px-2.5 py-1.5 text-xs text-ink"
                  >
                    <option value="audio">语音 (Audio)</option>
                    <option value="video">视频 (Video)</option>
                    <option value="image">图片 (Image)</option>
                    <option value="llm">语言模型 (LLM)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-ink-muted mb-1">底层驱动</label>
                  <select
                    value={editingProvider.driverType ?? 'minimax'}
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        driverType: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-line bg-paper-inset px-2.5 py-1.5 text-xs text-ink"
                  >
                    <option value="minimax">MiniMax (T2A/Video)</option>
                    <option value="cosyvoice">阿里百炼 (CosyVoice)</option>
                    <option value="kling">快手可灵 (Kling)</option>
                    <option value="fal">Fal.ai</option>
                    <option value="mock">本地模拟 (Mock)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-ink-muted mb-1">Master API Key</label>
                <input
                  type="password"
                  value={editingProvider.credentials?.apiKey ?? ''}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      credentials: { ...editingProvider.credentials, apiKey: e.target.value },
                    })
                  }
                  placeholder={
                    editingProvider.credentials?.apiKey
                      ? `保留现有密钥 (${editingProvider.credentials.apiKey})`
                      : '粘贴上游厂商分配的 API Key'
                  }
                  className="w-full rounded-lg border border-line bg-paper-inset px-3 py-1.5 text-xs text-ink font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-muted mb-1">Base URL / Endpoint</label>
                  <input
                    type="text"
                    value={editingProvider.credentials?.baseUrl ?? ''}
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        credentials: { ...editingProvider.credentials, baseUrl: e.target.value },
                      })
                    }
                    placeholder="如: https://api.minimax.chat/v1"
                    className="w-full rounded-lg border border-line bg-paper-inset px-3 py-1.5 text-xs text-ink font-mono"
                  />
                </div>

                <div>
                  <label className="block text-ink-muted mb-1">Group ID / App ID (选填)</label>
                  <input
                    type="text"
                    value={editingProvider.credentials?.groupId ?? ''}
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        credentials: { ...editingProvider.credentials, groupId: e.target.value },
                      })
                    }
                    placeholder="MiniMax Group ID 等"
                    className="w-full rounded-lg border border-line bg-paper-inset px-3 py-1.5 text-xs text-ink font-mono"
                  />
                </div>
              </div>

              {/* Sample Params (JSON) */}
              <div>
                <label className="block text-ink-muted mb-1">
                  样例参数模板 (用户画布选择时自动载入)
                </label>
                <textarea
                  rows={4}
                  value={
                    typeof editingProvider.sampleParams === 'object'
                      ? JSON.stringify(editingProvider.sampleParams, null, 2)
                      : String(editingProvider.sampleParams || '{}')
                  }
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setEditingProvider({ ...editingProvider, sampleParams: parsed });
                    } catch {
                      // allow typing intermediate invalid json
                    }
                  }}
                  className="w-full rounded-lg border border-line bg-paper-inset p-2.5 text-xs font-mono text-ink focus:outline-hidden"
                />
              </div>

              <div className="flex items-center gap-4 pt-2">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editingProvider.isDefault ?? false}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, isDefault: e.target.checked })
                    }
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <span>设为该模态默认服务商</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editingProvider.enabled ?? true}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, enabled: e.target.checked })
                    }
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <span>启用该服务商</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:bg-paper-inset"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSaveProvider(editingProvider)}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-accent-ink shadow-xs hover:opacity-90 active:scale-95 transition-all"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
