import type { ComponentProps } from 'react';
import { createDeferredView } from '../DeferredView';
import { cn } from '../../lib/cn';

type DiffProps = ComponentProps<typeof import('./DiffView').default>;

function DiffPlaceholder({ preview, className }: DiffProps, phase: 'loading' | 'error') {
  return <div className={cn('overflow-hidden rounded-xl border border-line bg-paper text-xs', className)}>
    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[11px] text-ink-muted">
      <span className="truncate">{preview.path || 'file'}</span>
      <span role={phase === 'loading' ? 'status' : undefined}>{phase === 'loading' ? '正在打开差异视图…' : '差异视图未加载'}</span>
    </div>
    <div className="max-h-[420px] overflow-auto" style={{ minHeight: Math.min(240, Math.max(80, preview.after.split('\n').length * 18 + 32)) }}>
      {preview.before ? <div className="border-b border-line px-3 py-2"><p className="mb-1 text-[10px] text-ink-muted">原内容</p><pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{preview.before}</pre></div> : null}
      {preview.after ? <div className="px-3 py-2"><p className="mb-1 text-[10px] text-ink-muted">新内容</p><pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{preview.after}</pre></div> : null}
    </div>
  </div>;
}

// Approval still exposes the actual before/after text while the optional
// syntax-aware renderer loads; a failed chunk never hides the requested edit.
const LazyDiffView = createDeferredView<DiffProps>(() => import('./DiffView'), {
  label: '差异视图', minHeight: 80, placeholder: DiffPlaceholder,
});

export default LazyDiffView;
