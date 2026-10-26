import { matchAny } from '../../../shared/matchText';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Globe, LoaderCircle, Package, Plug, Search } from 'lucide-react';
import { mcpCatalogDraft, type McpCatalogItem, type PluginCatalogItem } from '../../../shared/catalog';
import type { McpServerEntry, NodeEnvStatus } from '../../../shared/extensionConfig';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { McpForm, message } from '../../pages/settings/ExtensionsSection';
import * as skillStore from '../../state/skillStore';
import { CatalogIcon } from './CatalogIcon';
import { PACKS_CHANGED } from './ExtensionPacksSection';

type Tab = 'plugins' | 'mcp';
const PAGE = 24;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

/** A name that is free in mcp.json: "github", then "github-2", "github-3"… */
export function freeServerName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let i = 2; i < 100; i++) {
    const candidate = `${wanted.slice(0, 24 - String(i).length - 1)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return wanted;
}

function Badge({ children, tone = 'plain', title }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'positive'; title?: string }) {
  const tones = {
    plain: 'bg-paper-inset text-ink-muted',
    warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    positive: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  };
  return <span title={title} className={cn('rounded-full px-1.5 py-0.5 text-[11px]', tones[tone])}>{children}</span>;
}

// --- MCP servers -----------------------------------------------------------------------------------

function McpCard({ item, onAdd, nodeStatus }: { item: McpCatalogItem; onAdd: () => void; nodeStatus?: NodeEnvStatus | null }) {
  const needsKey = (item.install.kind === 'remote' ? item.install.headers : item.install.env).some((f) => f.required);
  const isNpm = item.install.kind === 'npm';
  const nodeMissing = isNpm && nodeStatus !== null && nodeStatus !== undefined && !nodeStatus.available;

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-paper-raised p-4">
      <div className="flex items-start gap-3">
        <CatalogIcon icons={item.icons} name={item.title || item.id} className="h-10 w-10 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={item.id}>{item.title}</span>
            {item.website ? (
              <a href={item.website} target="_blank" rel="noreferrer" title="官网" className="shrink-0 text-ink-muted hover:text-ink"><ExternalLink size={13} /></a>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{item.description || '没有描述'}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge>{item.install.kind === 'remote' ? '在线服务' : '本地运行'}</Badge>
        {isNpm ? (
          nodeMissing ? (
            <Badge tone="warn" title="未在环境变量中检测到 Node.js，运行此服务需要安装 Node.js">缺少 Node.js</Badge>
          ) : (
            <Badge title={nodeStatus?.version ? `已检测到 Node.js ${nodeStatus.version}` : undefined}>需要 Node.js</Badge>
          )
        ) : null}
        {needsKey ? <Badge tone="warn">需要密钥</Badge> : null}
        <Button size="xs" className="ml-auto" onClick={onAdd}>添加</Button>
      </div>
    </div>
  );
}

function McpDiscover() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 350);
  const [items, setItems] = useState<McpCatalogItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<McpCatalogItem | null>(null);
  const [existing, setExisting] = useState<McpServerEntry[]>([]);
  const [nodeStatus, setNodeStatus] = useState<NodeEnvStatus | null>(null);

  useEffect(() => {
    window.reizo?.checkNodeEnvironment?.().then(setNodeStatus).catch(() => setNodeStatus({ available: false }));
  }, []);

  const load = useCallback(async (query: string, after?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await window.reizo?.searchMcpCatalog?.({ search: query || undefined, cursor: after });
      if (!page) {
        setItems([]);
        setLoading(false);
        return;
      }
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (cause) { setError(message(cause)); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(debounced); }, [debounced, load]);

  async function openAdd(item: McpCatalogItem) {
    try { setExisting((await window.reizo?.listMcpServers?.()) ?? []); } catch { setExisting([]); }
    setAdding(item);
  }

  async function save(entry: McpServerEntry) {
    try {
      const current = (await window.reizo?.listMcpServers?.()) ?? [];
      const name = freeServerName(entry.name, new Set(current.map((e) => e.name)));
      await window.reizo?.saveMcpServers?.([...current, { ...entry, name }]);
      setAdding(null);
      toast.success(`已添加 ${name}`, '在 设置 → 扩展 里可以测试连接、停用或修改。');
    } catch (cause) { toast.error('添加失败', message(cause)); }
  }

  const draft = adding ? mcpCatalogDraft(adding) : null;
  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 MCP 服务，例如 github、数据库、浏览器…"
          className="w-full rounded-full border border-line bg-paper-raised py-1.5 pl-8 pr-3 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
      </div>
      {error ? <p className="mb-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs text-danger">加载失败：{error}</p> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <McpCard key={item.id} item={item} nodeStatus={nodeStatus} onAdd={() => void openAdd(item)} />)}
      </div>
      {!loading && items.length === 0 && !error ? <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-muted">没有找到匹配的服务。</p> : null}
      <div className="mt-4 flex justify-center">
        {loading ? <LoaderCircle size={16} className="animate-spin text-ink-muted" /> : cursor ? <Button size="sm" variant="outline" onClick={() => void load(debounced, cursor)}>加载更多</Button> : null}
      </div>
      <Dialog open={adding !== null} onOpenChange={(open) => { if (!open) setAdding(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {adding ? <CatalogIcon icons={adding.icons} name={adding.title || adding.id} className="h-10 w-10 text-sm" /> : null}
              <div className="min-w-0 flex-1">
                <DialogTitle>添加 {adding?.title}</DialogTitle>
                <DialogDescription className="mt-0.5">{adding?.description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {adding && draft ? (
            <McpForm
              key={adding.id}
              initial={{ ...draft.entry, name: freeServerName(draft.entry.name, new Set(existing.map((e) => e.name))) }}
              onCancel={() => setAdding(null)}
              onSave={(entry) => void save(entry)}
              hint={draft.fields.length ? (
                <div className="rounded-xl bg-paper-inset px-3 py-2 text-xs text-ink-muted">
                  <p className="mb-1 font-medium text-ink">需要你填写</p>
                  <ul className="space-y-0.5">
                    {draft.fields.map((f) => <li key={f.name}><span className="font-mono text-ink">{f.name}</span>{f.required ? '（必填）' : ''}{f.description ? ` ${f.description}` : ''}</li>)}
                  </ul>
                </div>
              ) : adding.install.kind === 'npm' ? (
                nodeStatus && !nodeStatus.available ? (
                  <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    ⚠️ 未在环境变量中检测到 Node.js。这个服务通过 npx 在本机运行，添加后需要先安装 Node.js (https://nodejs.org) 才能正常使用。
                  </p>
                ) : (
                  <p className="text-xs text-ink-muted">这个服务通过 npx 在本机运行{nodeStatus?.version ? `（已检测到 Node.js ${nodeStatus.version}）` : '，需要已安装 Node.js'}。</p>
                )
              ) : null}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Plugins ---------------------------------------------------------------------------------------

function PluginCard({ item, installed, busy, onInstall }: { item: PluginCatalogItem; installed: boolean; busy: boolean; onInstall: () => void }) {
  const title = item.title || item.name;
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-paper-raised p-4">
      <div className="flex items-start gap-3">
        <CatalogIcon icons={item.icons} name={title} className="h-10 w-10 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={item.name}>{title}</span>
            {item.homepage ? <a href={item.homepage} target="_blank" rel="noreferrer" title="主页" className="shrink-0 text-ink-muted hover:text-ink"><ExternalLink size={13} /></a> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{item.description || '没有描述'}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {item.category ? <Badge>{item.category}</Badge> : null}
        {item.author ? <Badge>{item.author}</Badge> : null}
        {installed ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted"><Check size={12} />已安装</span>
        ) : (
          <Button size="xs" className="ml-auto" disabled={busy} onClick={onInstall}>{busy ? <LoaderCircle className="animate-spin" /> : null}安装</Button>
        )}
      </div>
    </div>
  );
}

function PluginDiscover() {
  const [items, setItems] = useState<PluginCatalogItem[] | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshInstalled = useCallback(async () => {
    try {
      const plugins = (await window.reizo?.listPlugins?.()) ?? [];
      setInstalledIds(new Set(plugins.map((p) => p.id)));
    } catch { /* the list just stays empty */ }
  }, []);
  useEffect(() => {
    if (!window.reizo?.listPluginCatalog) {
      setItems([]);
      return;
    }
    window.reizo.listPluginCatalog().then(
      (catalog) => setItems(catalog?.items ?? []),
      (cause) => { setError(message(cause)); setItems([]); },
    );
    void refreshInstalled();
    window.addEventListener(PACKS_CHANGED, refreshInstalled);
    return () => window.removeEventListener(PACKS_CHANGED, refreshInstalled);
  }, [refreshInstalled]);

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category).filter((c): c is string => Boolean(c)))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((i) => (!category || i.category === category) && (!q || matchAny(q, [i.name, i.description, i.author]) > 0));
  }, [items, search, category]);
  useEffect(() => { setShown(PAGE); }, [search, category]);

  async function install(item: PluginCatalogItem) {
    if (!window.reizo?.installCatalogPlugin) {
      toast.error('安装失败', '当前运行环境不支持安装扩展包');
      return;
    }
    setBusyId(item.id);
    try {
      const pack = await window.reizo.installCatalogPlugin(item.id);
      window.dispatchEvent(new Event(PACKS_CHANGED));
      await skillStore.loadSkills();
      const parts = [pack.skills.length && `${pack.skills.length} 个技能`, pack.mcpServers.length && `${pack.mcpServers.length} 个 MCP 服务`, pack.hooks.length && `${pack.hooks.length} 个 Hook`].filter(Boolean);
      toast.success(`已安装 ${pack.name}`, parts.length ? `${parts.join('、')}。到上方「扩展包」里启用。` : '这个插件里没有 Reizo 能用的内容（它可能只提供子 agent）。');
    } catch (cause) { toast.error('安装失败', message(cause)); }
    setBusyId(null);
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索扩展包…"
            className="w-full rounded-full border border-line bg-paper-raised py-1.5 pl-8 pr-3 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent" />
        </div>
        <span className="text-xs text-ink-muted">{items ? `${filtered.length} 个` : ''}</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {['', ...categories].map((c) => (
          <button key={c || 'all'} type="button" onClick={() => setCategory(c)}
            className={cn('rounded-full border px-3 py-1 text-xs transition-colors', category === c ? 'border-ink bg-ink text-paper-raised' : 'border-line bg-paper-raised text-ink-muted hover:border-ink-muted')}>
            {c || '全部'}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-ink-muted">来自 Anthropic 的 Claude 插件目录。Reizo 会用到其中的技能（含斜杠命令）、MCP 服务和 Hook；子 agent 暂不支持。安装后默认不启用。</p>
      {error ? <p className="mb-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs text-danger">加载失败：{error}</p> : null}
      {items === null ? <div className="flex justify-center py-6"><LoaderCircle size={16} className="animate-spin text-ink-muted" /></div> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.slice(0, shown).map((item) => (
          <PluginCard key={item.id} item={item} installed={installedIds.has(item.id)} busy={busyId === item.id} onInstall={() => void install(item)} />
        ))}
      </div>
      {items && filtered.length === 0 && !error ? <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-muted">没有找到匹配的扩展包。</p> : null}
      {filtered.length > shown ? <div className="mt-4 flex justify-center"><Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>加载更多</Button></div> : null}
    </>
  );
}

export default function CatalogSection() {
  const [tab, setTab] = useState<Tab>('plugins');
  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink"><Globe size={14} className="text-ink-muted" />发现</h2>
        <div className="flex gap-1.5">
          {([['plugins', '扩展包', Package], ['mcp', 'MCP 服务', Plug]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors', tab === id ? 'bg-ink text-paper-raised' : 'border border-line text-ink-muted hover:border-ink-muted')}>
              <Icon size={12} />{label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'plugins' ? <PluginDiscover /> : <McpDiscover />}
    </section>
  );
}
