import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Clapperboard,
  Code2,
  Download,
  LayoutGrid,
  Loader2,
  Megaphone,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useSkillStore } from '../state/useSkillStore';
import * as skillStore from '../state/skillStore';
import type { SkillSummary } from '../state/skillStore';
import * as api from '../api';
import SkillDetailModal from '../components/skills/SkillDetailModal';
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

/** `coverUrl` arrives as an API-root path — resolve it against the API origin. */
function coverSrc(coverUrl: string): string | null {
  const origin = api.getResolvedApiOrigin();
  if (!origin) return null;
  return coverUrl.startsWith('http') ? coverUrl : `${origin}${coverUrl}`;
}

const CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
  video: { label: '视频片型', icon: Clapperboard },
  marketing: { label: '电商与广告', icon: Megaphone },
  design: { label: '品牌与设计', icon: Palette },
  social: { label: '社媒套图', icon: Share2 },
  dev: { label: '开发工具', icon: Code2 },
};
const CATEGORY_ORDER = ['video', 'marketing', 'design', 'social', 'dev'];
const UNCATEGORIZED = '__other__';

function categoryKeyOf(skill: SkillSummary): string {
  return skill.category && CATEGORY_META[skill.category] ? skill.category : UNCATEGORIZED;
}

interface SkillGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: SkillSummary[];
}

function groupSkills(skills: SkillSummary[]): SkillGroup[] {
  const byKey = new Map<string, SkillSummary[]>();
  for (const skill of skills) {
    const key = categoryKeyOf(skill);
    const list = byKey.get(key) ?? [];
    list.push(skill);
    byKey.set(key, list);
  }
  const ordered = [...CATEGORY_ORDER, UNCATEGORIZED];
  return ordered
    .filter((key) => byKey.has(key))
    .map((key) => {
      const meta = CATEGORY_META[key];
      return {
        key,
        label: meta?.label ?? '其他',
        icon: meta?.icon ?? LayoutGrid,
        items: byKey.get(key) ?? [],
      };
    });
}

function InstalledSkillCard({
  skill,
  onOpen,
  onUse,
  onUninstall,
}: {
  skill: SkillSummary;
  onOpen: () => void;
  onUse: () => void;
  onUninstall: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = skill.coverUrl && !failed ? coverSrc(skill.coverUrl) : null;
  const sourceLabel = skill.source === 'user' ? '用户' : '内置';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group cursor-pointer overflow-hidden rounded-2xl border border-line bg-paper-raised transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      {src ? (
        <div className="relative aspect-[3/2] overflow-hidden bg-paper-inset">
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
            onError={() => setFailed(true)}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
          <span className="absolute left-2.5 top-2.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            {sourceLabel}
          </span>
          <h3 className="absolute inset-x-3 bottom-2.5 truncate text-[15px] font-semibold text-white drop-shadow">
            {skill.name}
          </h3>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-paper-inset px-4 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper-raised text-ink-muted">
            <Plug size={16} />
          </div>
          <h3 className="min-w-0 truncate font-semibold">{skill.name}</h3>
          <span className="ml-auto shrink-0 rounded bg-paper-raised px-1.5 py-0.5 text-[10px] text-ink-muted">
            {sourceLabel}
          </span>
        </div>
      )}
      <div className="p-4">
        <p className="line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-ink-muted">
          {skill.description || `/${skill.id}`}
        </p>
        <div className="mt-3 flex justify-end gap-3">
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onUse();
            }}
          >
            使用
          </button>
          {skill.source === 'user' && (
            <button
              type="button"
              className="text-xs text-danger hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall();
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
    </div>
  );
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
  const [detail, setDetail] = useState<
    { kind: 'installed'; skill: SkillSummary } | { kind: 'market'; entry: SkillHubEntry } | null
  >(null);
  const requestSeq = useRef(0);

  const installedIds = useMemo(() => new Set(skills.map((s) => s.id)), [skills]);
  const skillGroups = useMemo(() => groupSkills(skills), [skills]);

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

  async function handleUse(skill: SkillSummary) {
    // Open a new chat with the skill pinned for the whole session and its
    // prompt template pre-filled, so the user can edit before sending.
    const session = await chatStore.createSession(`/${skill.id}`);
    uiStore.setMode('chat');
    tabStore.openChatTab(session.id, session.title);
    chatStore.setSessionSkill(session.id, skill.id);
    chatStore.seedComposer(session.id, skill.prompt ?? '');
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
          <div className="space-y-8">
            {skillGroups.map((group) => (
              <div key={group.key}>
                <div className="mb-3 flex items-center gap-2">
                  <group.icon size={15} className="text-ink-muted" />
                  <h3 className="text-sm font-semibold text-ink">{group.label}</h3>
                  <span className="rounded-full bg-paper-inset px-1.5 py-0.5 text-[10px] text-ink-muted">
                    {group.items.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((skill) => (
                    <InstalledSkillCard
                      key={skill.id}
                      skill={skill}
                      onOpen={() => setDetail({ kind: 'installed', skill })}
                      onUse={() => void handleUse(skill)}
                      onUninstall={() => {
                        void (async () => {
                          await window.reizo.uninstallSkill(skill.id);
                          await skillStore.loadSkills();
                        })();
                      }}
                    />
                  ))}
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
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail({ kind: 'market', entry })}
                    onKeyDown={(e) => e.key === 'Enter' && setDetail({ kind: 'market', entry })}
                    className="flex cursor-pointer flex-col rounded-2xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-md"
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
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleInstall(entry);
                        }}
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

      {detail?.kind === 'installed' && (
        <SkillDetailModal
          coverSrc={detail.skill.coverUrl ? coverSrc(detail.skill.coverUrl) : null}
          title={detail.skill.name}
          subtitle={`/${detail.skill.id} · ${detail.skill.description}`}
          chips={
            <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">
              {detail.skill.source === 'user' ? '用户' : '内置'}
            </span>
          }
          loadMarkdown={() => api.getSkill(detail.skill.id).then((s) => s?.body ?? null)}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setDetail(null);
                  void handleUse(detail.skill);
                }}
                className="rounded-full bg-ink px-4 py-1.5 text-xs text-paper-raised transition-opacity hover:opacity-85"
              >
                在新会话中使用
              </button>
            </>
          }
        />
      )}

      {detail?.kind === 'market' && (
        <SkillDetailModal
          icon={<SkillIcon entry={detail.entry} />}
          title={detail.entry.name}
          subtitle={`${detail.entry.canonicalName} · ${detail.entry.version ? `v${detail.entry.version} · ` : ''}${detail.entry.description}`}
          chips={
            <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">
              {SOURCE_LABELS[detail.entry.source] ?? detail.entry.source}
            </span>
          }
          loadMarkdown={() =>
            window.reizo
              .previewSkillHubSkill({ slug: detail.entry.slug, namespace: detail.entry.namespace })
              .catch((): null => null)
          }
          onClose={() => setDetail(null)}
          footer={
            <>
              <span className="mr-auto inline-flex items-center gap-3 text-[11px] text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  <Download size={11} />
                  {formatCount(detail.entry.downloads)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Star size={11} />
                  {formatCount(detail.entry.stars)}
                </span>
              </span>
              <button
                type="button"
                disabled={
                  installing === detail.entry.canonicalName || installedIds.has(detail.entry.slug)
                }
                onClick={() => void handleInstall(detail.entry)}
                className={`inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs transition-opacity ${
                  installedIds.has(detail.entry.slug)
                    ? 'cursor-default bg-paper-inset text-ink-muted'
                    : 'bg-ink text-paper-raised hover:opacity-85 disabled:opacity-60'
                }`}
              >
                {installing === detail.entry.canonicalName ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    安装中
                  </>
                ) : installedIds.has(detail.entry.slug) ? (
                  '已安装'
                ) : (
                  '安装'
                )}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}
