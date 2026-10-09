import { Component, Suspense, createElement, lazy, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

class DeferredFailureBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Stable component identity during editing; only an explicit retry resets a failed load. */
export function createDeferredView<Props extends object>(importer: () => Promise<{ default: ComponentType<Props> }>, options: {
  label: string;
  minHeight?: number | ((props: Props) => number);
  placeholder?: (props: Props, phase: 'loading' | 'error') => ReactNode;
}) {
  let pendingModule: Promise<{ default: ComponentType<Props> }> | undefined;
  const load = () => {
    pendingModule ??= importer().catch((error) => { pendingModule = undefined; throw error; });
    return pendingModule;
  };
  function DeferredPlaceholder({ viewProps, phase, onRetry }: { viewProps: Props; phase: 'loading' | 'error'; onRetry?: () => void }) {
    const minHeight = typeof options.minHeight === 'function' ? options.minHeight(viewProps) : options.minHeight ?? 160;
    const custom = options.placeholder?.(viewProps, phase);
    if (phase === 'loading') return custom ?? <div role="status" aria-busy className="flex min-h-0 flex-1 items-center justify-center text-xs text-ink-muted" style={{ minHeight }}>正在打开{options.label}…</div>;
    return <div className="flex min-h-0 flex-1 flex-col gap-3" style={{ minHeight }}>
      {custom}
      <Alert variant="destructive"><AlertCircle /><AlertDescription>未能加载{options.label}。<Button type="button" variant="outline" size="sm" onClick={onRetry}>重试加载</Button></AlertDescription></Alert>
    </div>;
  }
  return function DeferredView(props: Props) {
    const [attempt, setAttempt] = useState(0);
    const View = useMemo(() => lazy(load), [attempt]);
    const loading = <DeferredPlaceholder viewProps={props} phase="loading" />;
    const failed = <DeferredPlaceholder viewProps={props} phase="error" onRetry={() => setAttempt((value) => value + 1)} />;
    return <DeferredFailureBoundary key={attempt} fallback={failed}><Suspense fallback={loading}>{createElement(View, props)}</Suspense></DeferredFailureBoundary>;
  };
}
