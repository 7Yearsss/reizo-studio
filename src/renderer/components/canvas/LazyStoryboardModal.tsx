import { Suspense, type ComponentProps } from 'react';
import { Dialog } from 'radix-ui';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { Button } from '../ui/button';

type StoryboardProps = ComponentProps<typeof import('./StoryboardModal').default>;
let pendingModule: Promise<typeof import('./StoryboardModal')> | undefined;

function loadStoryboard() {
  pendingModule ??= import('./StoryboardModal').catch((error) => { pendingModule = undefined; throw error; });
  return pendingModule;
}

const StoryboardModal = lazyWithRetry(loadStoryboard);

/** Begin loading on the overflow-menu intent, before the review action is chosen. */
export function preloadStoryboard() {
  void loadStoryboard().catch((): void => { /* Opening the dialog retries the import. */ });
}

function StoryboardLoading({ onClose }: { onClose: () => void }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[200] bg-ink/35" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[200] flex -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-card p-5 text-foreground shadow-xl">
        <Dialog.Title className="text-sm font-medium">串联审片</Dialog.Title>
        <Dialog.Description role="status" className="text-xs text-muted-foreground">正在打开视频预览…</Dialog.Description>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>返回画布</Button>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export default function LazyStoryboardModal(props: StoryboardProps) {
  return <Suspense fallback={<StoryboardLoading onClose={props.onClose} />}><StoryboardModal {...props} /></Suspense>;
}
