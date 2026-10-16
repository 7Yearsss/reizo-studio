import { Suspense, useRef } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { useUiStore } from '../../state/useUiStore';
import * as uiStore from '../../state/uiStore';

const SettingsPage = lazyWithRetry(() => import('../../pages/SettingsPage'));

export default function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) uiStore.closeSettings(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(760px,calc(100dvh-64px))] w-[min(1100px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-2xl outline-none max-sm:h-[calc(100dvh-24px)] max-sm:w-[calc(100vw-24px)]"
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = returnFocus.current;
            if (previous?.isConnected && previous !== document.body) previous.focus();
            else document.querySelector<HTMLButtonElement>('[aria-label="账号菜单"]')?.focus();
          }}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">设置</Dialog.Title>
          <Dialog.Close aria-label="关闭设置" className="absolute right-4 top-4 z-10 rounded-lg p-2 text-ink-muted hover:bg-paper-inset hover:text-ink focus-visible:outline-2 focus-visible:outline-accent max-sm:right-2 max-sm:top-2">
            <X size={18} />
          </Dialog.Close>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div role="status" className="p-8 text-sm text-ink-muted">正在打开设置…</div>}>
              <SettingsPage />
            </Suspense>
          </div>
          <footer className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3">
            <span className="text-xs text-ink-muted">Esc 关闭设置</span>
            <Dialog.Close className="rounded-full bg-ink px-6 py-2 text-sm font-medium text-paper-raised hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">完成</Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
