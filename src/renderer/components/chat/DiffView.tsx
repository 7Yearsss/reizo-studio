import { Component, type ReactNode, useMemo, useState } from 'react';
import { Columns2, Rows2 } from 'lucide-react';
// eslint-disable-next-line import/no-unresolved -- package `exports` subpath, same as @tailwindcss/vite
import { MultiFileDiff } from '@pierre/diffs/react';
import type { FileDiffPreview } from '../../../shared/stream';
import { useIsDark } from '../../lib/hooks/use-is-dark';
import { cn } from '../../lib/cn';

/**
 * Rich before/after diff for `write_file` / `edit_file`, shown both in the
 * approval prompt (before the write) and on the completed tool card. Rendered
 * with `@pierre/diffs`, which shares Shiki with the rest of the app so the
 * highlighting matches. Falls back to a plain unified listing if the renderer
 * throws (unknown language, oversized input, …).
 */
const DIFF_STYLE_KEY = 'reizo:diff-style';

function loadDiffStyle(): 'unified' | 'split' | null {
  try {
    const value = localStorage.getItem(DIFF_STYLE_KEY);
    return value === 'split' || value === 'unified' ? value : null;
  } catch {
    return null;
  }
}

export default function DiffView({
  preview,
  className,
  diffStyle: initialStyle = 'unified',
}: {
  preview: FileDiffPreview;
  className?: string;
  diffStyle?: 'unified' | 'split';
}) {
  // The viewer's last choice wins over the caller's default and carries across diffs.
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>(() => loadDiffStyle() ?? initialStyle);
  function chooseStyle(next: 'unified' | 'split') {
    setDiffStyle(next);
    try { localStorage.setItem(DIFF_STYLE_KEY, next); } catch { /* per-viewer convenience */ }
  }
  const dark = useIsDark();
  const name = preview.path || 'file';
  const created = preview.before === '' && preview.after !== '';
  const deleted = preview.after === '' && preview.before !== '';

  const options = useMemo(
    () => ({
      diffStyle,
      overflow: 'wrap' as const,
      theme: dark ? 'pierre-dark' : 'pierre-light',
      disableFileHeader: true,
    }),
    [dark, diffStyle],
  );

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-paper text-xs', className)}>
      <div className="group/diff flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 font-mono text-[11px] text-ink-muted">
        <span className="truncate">{name}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span role="group" aria-label="差异视图" className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/diff:opacity-100">
            {([['unified', '合并视图', Rows2], ['split', '分栏视图', Columns2]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={diffStyle === value}
                onClick={() => chooseStyle(value)}
                className={cn('rounded p-0.5 transition-colors hover:text-ink', diffStyle === value && 'bg-paper-inset text-ink')}
              >
                <Icon size={12} />
              </button>
            ))}
          </span>
          <span>
            {created ? '新建' : deleted ? '删除' : '修改'}
            {preview.truncated ? ' · 已截断' : ''}
          </span>
        </span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <DiffErrorBoundary fallback={<PlainDiff preview={preview} />}>
          <MultiFileDiff
            oldFile={{ name, contents: preview.before }}
            newFile={{ name, contents: preview.after }}
            options={options}
            disableWorkerPool
          />
        </DiffErrorBoundary>
      </div>
    </div>
  );
}

function PlainDiff({ preview }: { preview: FileDiffPreview }) {
  const before = preview.before.split('\n');
  const after = preview.after.split('\n');
  const rows: ReactNode[] = [];
  const len = Math.max(before.length, after.length);
  for (let i = 0; i < len && rows.length < 400; i += 1) {
    if (before[i] === after[i]) {
      rows.push(
        <div key={`c${i}`} className="text-ink-muted">
          {'  '}
          {before[i]}
        </div>,
      );
      continue;
    }
    if (before[i] !== undefined) {
      rows.push(
        <div key={`d${i}`} className="bg-danger/10 text-danger">
          - {before[i]}
        </div>,
      );
    }
    if (after[i] !== undefined) {
      rows.push(
        <div key={`a${i}`} className="bg-accent/10 text-accent">
          + {after[i]}
        </div>,
      );
    }
  }
  return <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed">{rows}</pre>;
}

class DiffErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
