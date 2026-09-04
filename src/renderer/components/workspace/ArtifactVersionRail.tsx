import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { ArtifactVersion } from '../../../shared/artifact';
import * as artifactStore from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import Tooltip from '../ui/Tooltip';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.round(s / 60)}分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)}小时前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function ArtifactVersionRail({
  artifactId,
  activeVersion,
  onPick,
  onRestored,
}: {
  artifactId: string;
  activeVersion: number;
  onPick: (n: number) => void;
  onRestored: () => void;
}) {
  const versions = useArtifactStore((s) => s.versionsById[artifactId]) as
    | ArtifactVersion[]
    | undefined;
  const [busyVersion, setBusyVersion] = useState<number | null>(null);

  async function copyPrompt(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制提示词');
    } catch {
      toast.error('复制失败');
    }
  }

  useEffect(() => {
    void artifactStore.loadArtifactVersions(artifactId);
  }, [artifactId]);

  async function restore(n: number) {
    setBusyVersion(n);
    try {
      const { restoreArtifactVersion } = await import('../../api');
      await restoreArtifactVersion(artifactId, n);
      artifactStore.invalidateArtifact(artifactId);
      await artifactStore.loadArtifactVersions(artifactId);
      toast.success(`已切换到版本 v${n}`);
      onRestored();
    } catch {
      toast.error('切换版本失败');
    } finally {
      setBusyVersion(null);
    }
  }

  const list = [...(versions ?? [])].reverse();

  return (
    <div className="flex w-56 shrink-0 flex-col border-l border-line bg-paper">
      <div className="border-b border-line px-3 py-2 text-[11px] font-semibold text-ink-muted">
        版本历史 · {versions?.length ?? '…'}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
        {list.map((v) => {
          const isActive = v.n === activeVersion;
          const isBusy = busyVersion === v.n;

          return (
            <li key={v.n} className="relative">
              <button
                type="button"
                onClick={() => onPick(v.n)}
                className={cn(
                  'relative w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                  isActive ? 'text-ink' : 'text-ink-muted hover:text-ink hover:bg-paper-inset/50',
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="artifact-version-active-pill"
                    className="absolute inset-0 rounded-lg bg-paper-inset/80 border border-line/60"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <div className="relative z-10 flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold tabular-nums text-accent">v{v.n}</span>
                  <span className="truncate text-[10px] text-ink-muted">{v.label}</span>
                  {isActive && <Check size={11} className="ml-auto text-accent" />}
                </div>
                <div className="relative z-10 mt-0.5 truncate text-[10px] text-ink-muted/80">
                  {relTime(v.createdAt)}
                </div>
                {v.origin?.prompt ? (
                  <div className="relative z-10 mt-1 flex items-start gap-1">
                    <span className="line-clamp-2 flex-1 text-[10px] leading-4 text-ink-muted">
                      {v.origin.prompt}
                    </span>
                    <Tooltip content="复制这条提示">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyPrompt(v.origin.prompt ?? '');
                        }}
                        className="rounded p-0.5 text-ink-muted hover:bg-paper hover:text-ink transition-colors"
                      >
                        <Copy size={10} />
                      </button>
                    </Tooltip>
                  </div>
                ) : null}
                {v.n !== activeVersion || activeVersion !== (versions?.length ?? 0) ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void restore(v.n);
                    }}
                    className="relative z-10 mt-1.5 inline-flex items-center gap-1 rounded bg-paper-raised/60 px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-paper-raised hover:text-ink disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw size={10} className={cn(isBusy && 'animate-spin')} />
                    {isBusy ? '切换中…' : '切换到此版本'}
                  </button>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
