import { Component, Suspense, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

type Props = ComponentProps<typeof import('./PresentationExportModal').default>;
let pending: Promise<typeof import('./PresentationExportModal')> | undefined;
const load = () => pending ??= import('./PresentationExportModal').catch((error) => { pending = undefined; throw error; });
export function preloadPresentationExport() { void load().catch((): void => { /* The opened dialog provides an explicit retry. */ }); }

class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function LoadingDialog({ failed, onClose, onRetry }: { failed?: boolean; onClose: () => void; onRetry?: () => void }) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-sm">
    <DialogHeader><DialogTitle>导出演示稿</DialogTitle><DialogDescription role="status">{failed ? '导出面板未能加载，请重试。' : '正在打开导出面板…'}</DialogDescription></DialogHeader>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>返回画布</Button>{failed ? <Button onClick={onRetry}>重试加载</Button> : null}</div>
  </DialogContent></Dialog>;
}

export default function LazyPresentationExportModal(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const Modal = useMemo(() => lazyWithRetry(load), [attempt]);
  return <LoadBoundary key={attempt} fallback={<LoadingDialog failed onClose={props.onClose} onRetry={() => setAttempt((value) => value + 1)} />}>
    <Suspense fallback={<LoadingDialog onClose={props.onClose} />}><Modal {...props} /></Suspense>
  </LoadBoundary>;
}
