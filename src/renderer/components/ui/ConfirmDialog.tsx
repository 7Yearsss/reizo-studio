import { useSyncExternalStore, type ReactElement } from 'react';
import { confirmStore } from '@/renderer/state/confirmStore';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';

/** Mount once. Focus lands on the safe option (cancel, or the only button for a notice). */
export function ConfirmDialog(): ReactElement {
  const request = useSyncExternalStore(confirmStore.subscribe, confirmStore.getSnapshot);
  const hasCancel = request ? request.cancelLabel !== null : true;
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) confirmStore.settle(false); }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-autofocus]')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{request?.title}</DialogTitle>
          <DialogDescription className={request?.description ? 'whitespace-pre-line' : 'sr-only'}>{request?.description ?? request?.title}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {hasCancel ? <Button variant="outline" data-autofocus onClick={() => confirmStore.settle(false)}>{request?.cancelLabel ?? '取消'}</Button> : null}
          <Button
            variant={request?.destructive ? 'destructive' : 'default'}
            data-autofocus={hasCancel ? undefined : true}
            onClick={() => confirmStore.settle(true)}
          >
            {request?.confirmLabel ?? '确定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
