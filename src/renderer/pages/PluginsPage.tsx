import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Download,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useSkillStore } from '../state/useSkillStore';
import * as skillStore from '../state/skillStore';
import * as tabStore from '../state/tabStore';
import * as chatStore from '../state/chatStore';
import * as uiStore from '../state/uiStore';
import type { SkillHubEntry, SkillHubSearchResult } from '../../shared/skillhub';

const SORT_OPTIONS = [
  { key: 'downloads', label: '最热' },
  { key: 'installs', label: '装机量' },
  { key: 'stars', label: '最多收藏' },
  { key: 'score', label: '综合评分' },
  { key: 'updated_at', label: '最近更新' },
];

const SOURCE_LABELS: Record<string, string> = {
  enterprise: '官方',
  community: '社区',
  clawhub: 'ClawHub',
};

const PAGE_SIZE = 24;

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function SkillIcon({ entry }: { entry: SkillHubEntry }) {
  const [failed, setFailed] = useState(false);
  if (entry.iconUrl && !failed) {
    return (
      <img
        src={entry.iconUrl}
        alt=""
        className="h-11 w-11 rounded-xl border border-line object-cover"
        onError={() => setFailed(true)}
        loading="lazy"
      />
    );
  }
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-paper-inset text-base font-semibold text-ink-muted">
      {(entry.name || entry.slug).slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function PluginsPage() {
  const { skills, loaded } = useSkillStore();
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [sortBy, setSortBy] = useState('downloads');
  const [entries, setEntries] = useState<SkillHubEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const installedIds = useMemo(() => new Set(skills.map((s) => s.id)), [skills]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  const fetchMarket = useCallback(
    async (nextPage: number, append: boolean) => {
      const seq = ++requestSeq.current;
      setMarketLoading(true);
      setMarketError(null);
      try {
        const result: SkillHubSearchResult = await window.reizo.searchSkillHub({
          keyword: debouncedKeyword || undefined,
          sortBy,
          order: 'desc',
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        if (seq !== requestSeq.current) return;
        setEntries((prev) => (append ? [...prev, ...result.items] : result.items));
        setTotal(result.total);
        setPage(nextPage);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setMarketError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === requestSeq.current) setMarketLoading(false);
      }
    },
    [debouncedKeyword, sortBy],
  );

  useEffect(() => {
    void fetchMarket(1, false);
  }, [fetchMarket]);

  async function handleInstall(entry: SkillHubEntry) {
    setInstalling(entry.canonicalName);
    try {
      await window.reizo.installSkillHubSkill({ slug: entry.slug, namespace: entry.namespace });
      await skillStore.loadSkills();
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
    }
  }

  async function handleUse(skill: { id: string; name: string }) {
    const session = await chatStore.createSession(`/${skill.id}`);
    uiStore.setMode('chat');
    tabStore.openChatTab(session.id, session.title);
    void chatStore.sendMessage(session.id, `请按技能 ${skill.name} 开始工作。`, [], { skillId: skill.id });
  }

  const hasMore = entries.length < total;

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">插件</h1>
          <p className="mt-1 text-sm text-ink-muted">
            浏览 SkillHub 技能市场一键安装，或导入自己的 SKILL.md。
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs text-paper-raised transition-opacity hover:opacity-85"
          onClick={async () => {
            const installed = await window.reizo.installSkill();
            if (installed) await skillStore.loadSkills();
          }}
        >
          <Plus size={12} />
          安装 SKILL.md
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
          <Plug size={14} className="text-ink-muted" />
          我的技能
          <span className="text-xs text-ink-muted">{loaded ? `· ${skills.length}` : ''}</span>
        </h2>
        {skills.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm text-ink-muted">
            还没有安装技能 —— 从下方市场挑一个试试。
          </p>
        ) : (
          <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="rounded-2xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Plug size={16} className="text-ink-muted" />
                  <h3 className="font-semibold">{skill.name}</h3>
                  <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">
                    {skill.source === 'user' ? '用户' : '内置'}
                  </span>
                </div>
                <p className="line-clamp-2 min-h-[2.5rem] text-sm text-ink-muted">
                  {skill.description || `/${skill.id}`}
                </p>
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    className="text-xs text-accent hover:underline"
                    onClick={() => void handleUse(skill)}
                  >
                    使用
                  </button>
                  {skill.source === 'user' && (
                    <button
                      type="button"
                      className="text-xs text-danger hover:underline"
                      onClick={async () => {
                        await window.reizo.uninstallSkill(skill.id);
                        await skillStore.loadSkills();
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Trash2 size={12} />
                        卸载
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkles size={14} className="text-accent" />
            SkillHub 技能市场
            {total > 0 && <span className="text-xs text-ink-muted">· {formatCount(total)} 个技能</span>}
          </h2>
          <div className="relative ml-auto">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索技能…"
              className="w-56 rounded-full border border-line bg-paper-raised py-1.5 pl-8 pr-3 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent"
            />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSortBy(option.key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                sortBy === option.key
                  ? 'border-ink bg-ink text-paper-raised'
                  : 'border-line bg-paper-raised text-ink-muted hover:border-ink-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {marketError && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-danger/40 bg-danger/5 px-5 py-3 text-sm text-danger">
            <span>加载市场失败：{marketError}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-2.5 py-0.5 text-xs hover:bg-danger/10"
              onClick={() => void fetchMarket(1, false)}
            >
              <RefreshCw size={11} />
              重试
            </button>
          </div>
        )}

        {marketLoading && entries.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-line bg-paper-raised p-5">
                <div className="mb-3 h-11 w-11 rounded-xl bg-paper-inset" />
                <div className="mb-2 h-4 w-2/3 rounded bg-paper-inset" />
                <div className="h-3 w-full rounded bg-paper-inset" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          !marketError && (
            <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
              没有找到匹配的技能，换个关键词试试。
            </p>
          )
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry) => {
                const busy = installing === entry.canonicalName;
                const installed = installedIds.has(entry.slug);
                return (
                  <div
                    key={entry.canonicalName}
                    className="flex flex-col rounded-2xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-md"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <SkillIcon entry={entry} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate font-semibold">{entry.name}</h3>
                          {entry.verified && <BadgeCheck size={14} className="shrink-0 text-accent" />}
                        </div>
                        <p className="truncate text-[11px] text-ink-muted">{entry.canonicalName}</p>
                      </div>
                    </div>
                    <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm text-ink-muted">{entry.description}</p>
                    <div className="mt-auto flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                        <Download size={11} />
                        {formatCount(entry.downloads)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                        <Star size={11} />
                        {formatCount(entry.stars)}
                      </span>
                      <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">
                        {SOURCE_LABELS[entry.source] ?? entry.source}
                      </span>
                      <button
                        type="button"
                        disabled={busy || installed}
                        onClick={() => void handleInstall(entry)}
                        className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-opacity ${
                          installed
                            ? 'cursor-default bg-paper-inset text-ink-muted'
                            : 'bg-ink text-paper-raised hover:opacity-85 disabled:opacity-60'
                        }`}
                      >
                        {busy ? (
                          <>
                            <Loader2 size={11} className="animate-spin" />
                            安装中
                          </>
                        ) : installed ? (
                          '已安装'
                        ) : (
                          '安装'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  disabled={marketLoading}
                  onClick={() => void fetchMarket(page + 1, true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-raised px-4 py-1.5 text-xs text-ink-muted transition-colors hover:border-ink-muted disabled:opacity-60"
                >
                  {marketLoading && <Loader2 size={11} className="animate-spin" />}
                  加载更多（{entries.length}/{formatCount(total)}）
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
