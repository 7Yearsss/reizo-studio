import { useEffect, useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { ArtifactVersion } from '../../../shared/artifact';
import * as artifactStore from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';

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
  const [busy, setBusy] = useState(false);

  async function copyPrompt(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
  }

  useEffect(() => {
    void artifactStore.loadArtifactVersions(artifactId);
  }, [artifactId]);

  async function restore(n: number) {
    setBusy(true);
    try {
      const { restoreArtifactVersion } = await import('../../api');
      await restoreArtifactVersion(artifactId, n);
      artifactStore.invalidateArtifact(artifactId);
      await artifactStore.loadArtifactVersions(artifactId);
      onRestored();
    } finally {
      setBusy(false);
    }
  }

  const list = [...(versions ?? [])].reverse();

  return (
    <div className="flex w-56 shrink-0 flex-col border-l border-line bg-paper">
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-semibold text-ink-muted">
        版本 · {versions?.length ?? '…'}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {list.map((v) => (
          <li key={v.n}>
            <button
              type="button"
              onClick={() => onPick(v.n)}
              className={[
                'w-full rounded-lg px-2 py-1.5 text-left',
                v.n === activeVersion ? 'bg-paper-inset' : 'hover:bg-paper-inset/60',
              ].join(' ')}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium tabular-nums">v{v.n}</span>
                <span className="truncate text-[10px] text-ink-muted">{v.label}</span>
                {v.n === activeVersion && <Check size={11} className="ml-auto text-accent" />}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-ink-muted/80">{relTime(v.createdAt)}</div>
              {v.origin?.prompt ? (
                <div className="mt-1 flex items-start gap-1">
                  <span className="line-clamp-2 flex-1 text-[10px] leading-4 text-ink-muted">
                    {v.origin.prompt}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyPrompt(v.origin.prompt ?? '');
                    }}
                    className="rounded p-0.5 text-ink-muted hover:bg-paper hover:text-ink"
                    title="复制这条提示"
                  >
                    <Copy size={10} />
                  </button>
                </div>
              ) : null}
              {v.n !== activeVersion || activeVersion !== (versions?.length ?? 0) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void restore(v.n);
                  }}
                  className="mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-ink-muted hover:bg-paper hover:text-ink disabled:opacity-50"
                >
                  <RotateCcw size={10} /> 切换到此版本
                </button>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
