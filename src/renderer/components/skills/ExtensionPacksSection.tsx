import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import type { PluginSummary } from '../../../shared/plugins';
import * as skillStore from '../../state/skillStore';
import { CatalogIcon } from './CatalogIcon';
import { previewConfirmText } from '../../../shared/pluginPreviewText';

export const PACKS_CHANGED = 'reizo:packs-changed';

const FORMAT_LABEL: Record<PluginSummary['format'], string> = { claude: 'Claude 格式', codex: 'Codex 格式', plain: '通用' };

/** What turning the pack on will run or contact — the user agrees to exactly this list. */
export function enableConfirmText(pack: PluginSummary): string | null {
  if (pack.mcpServers.length === 0 && pack.hooks.length === 0) return null;
  const lines = [`启用「${pack.name}」后，它会：`];
  for (const server of pack.mcpServers) lines.push(`• ${server.kind === 'stdio' ? '启动本地程序' : '连接外部服务'}：${server.target}`);
  for (const hook of pack.hooks) lines.push(`• 在工具调用${hook.event === 'PreToolUse' ? '前' : '后'}运行命令${hook.matcher ? `（${hook.matcher}）` : ''}：${hook.command}`);
  lines.push('', '只启用你信任的来源。继续吗？');
  return lines.join('\n');
}

function Summary({ pack }: { pack: PluginSummary }) {
  const parts = [
    pack.skills.length ? `${pack.skills.length} 个技能` : '',
    pack.mcpServers.length ? `${pack.mcpServers.length} 个 MCP 服务` : '',
    pack.hooks.length ? `${pack.hooks.length} 个 Hook` : '',
  ].filter(Boolean);
  return <>{parts.length ? parts.join(' · ') : '没有可用内容'}</>;
}

function PackCard({ pack, busy, onToggle, onRemove }: { pack: PluginSummary; busy: boolean; onToggle: () => void; onRemove: () => void }) {
  const hasDetails = pack.mcpServers.length > 0 || pack.hooks.length > 0 || pack.warnings.length > 0;
  return (
    <div className="rounded-2xl border border-line bg-paper-raised p-4">
      <div className="flex items-start gap-3">
        <CatalogIcon name={pack.name} letterOnly className="h-10 w-10 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{pack.name}</span>
            {pack.version ? <span className="text-xs text-ink-muted">v{pack.version}</span> : null}
            {pack.updateAvailable ? <span title="你导入它的文件夹内容已经变了；重新导入即可更新" className="rounded-full bg-[color-mix(in_srgb,#d9622b_14%,transparent)] px-1.5 py-0.5 text-[11px] text-[#d9622b]">可更新</span> : null}
            <span className="rounded-full bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">{FORMAT_LABEL[pack.format]}</span>
          </div>
          {pack.description ? <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{pack.description}</p> : null}
          <p className="mt-1.5 text-xs text-ink-muted"><Summary pack={pack} /></p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className={`rounded-full px-3 py-1 text-xs transition-opacity disabled:opacity-50 ${pack.enabled ? 'border border-line text-ink-muted hover:border-ink-muted' : 'bg-ink text-paper-raised hover:opacity-85'}`}
          >
            {pack.enabled ? '停用' : '启用'}
          </button>
          <button type="button" disabled={busy} onClick={onRemove} title="卸载" className="rounded-full p-1.5 text-ink-muted hover:bg-paper-inset hover:text-danger disabled:opacity-50">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {hasDetails ? (
        <details className="mt-3 text-xs text-ink-muted">
          <summary className="cursor-pointer select-none hover:text-ink">查看它会运行什么</summary>
          <ul className="mt-2 space-y-1.5">
            {pack.mcpServers.map((server) => (
              <li key={server.name} className="break-all"><span className="mr-2 text-ink">MCP · {server.name}</span>{server.target}</li>
            ))}
            {pack.hooks.map((hook, index) => (
              <li key={`${hook.event}-${index}`} className="break-all"><span className="mr-2 text-ink">Hook · {hook.event}{hook.matcher ? ` · ${hook.matcher}` : ''}</span>{hook.command}</li>
            ))}
            {pack.warnings.map((warning) => (
              <li key={warning} className="text-amber-600 dark:text-amber-400">{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default function ExtensionPacksSection() {
  const [packs, setPacks] = useState<PluginSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setPacks((await window.reizo?.listPlugins?.()) ?? []); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // The Discover section installs packs too; it announces that here.
  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener(PACKS_CHANGED, onChanged);
    return () => window.removeEventListener(PACKS_CHANGED, onChanged);
  }, [refresh]);

  /** Pick a folder, show exactly what it carries, and only then copy it in (refused if it changes in between). */
  async function importWithPreview() {
    const preview = await window.reizo?.previewPlugin?.();
    if (!preview) return;
    if (preview.existing?.sameContent) { window.alert(previewConfirmText(preview)); return; }
    if (!window.confirm(previewConfirmText(preview))) return;
    await window.reizo?.installPreviewedPlugin?.(preview.sourceDir, preview.digest);
  }

  /** Run an action, then reload packs and skills (a pack's skills appear or vanish with it). */
  async function act(id: string | null, action: () => Promise<unknown>) {
    setBusyId(id ?? '*');
    setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    await refresh();
    await skillStore.loadSkills();
    setBusyId(null);
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <Package size={14} className="text-ink-muted" />
          扩展包
          <span className="text-xs text-ink-muted">· {packs.length}</span>
        </h2>
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => void act(null, importWithPreview)}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-muted hover:text-ink disabled:opacity-50"
        >
          <Plus size={12} />
          导入扩展包文件夹
        </button>
      </div>
      {error ? <p className="mb-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs text-danger">{error}</p> : null}
      {packs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-5 text-sm text-ink-muted">
          扩展包把技能、MCP 服务和 Hook 打包在一个文件夹里，支持 Claude Code 和 Codex 的目录格式。导入后默认不启用，由你确认后再打开。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              busy={busyId !== null}
              onToggle={() => {
                if (!pack.enabled) {
                  const text = enableConfirmText(pack);
                  if (text && !window.confirm(text)) return;
                }
                void act(pack.id, () => (window.reizo?.setPluginEnabled ? window.reizo.setPluginEnabled(pack.id, !pack.enabled) : Promise.resolve()));
              }}
              onRemove={() => {
                if (window.confirm(`卸载「${pack.name}」？它的文件会被删除。`)) {
                  void act(pack.id, () => (window.reizo?.uninstallPlugin ? window.reizo.uninstallPlugin(pack.id) : Promise.resolve()));
                }
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
