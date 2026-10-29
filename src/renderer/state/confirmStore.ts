export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** `null` makes it an acknowledge-only dialog (replaces `alert`). */
  cancelLabel?: string | null;
  destructive?: boolean;
}

interface Pending extends ConfirmRequest {
  resolve: (value: boolean) => void;
}

let queue: Pending[] = [];
let snapshot: Pending | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = queue[0] ?? null;
  for (const listener of listeners) listener();
}

export const confirmStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Pending | null {
    return snapshot;
  },
  settle(value: boolean): void {
    const current = queue.shift();
    current?.resolve(value);
    emit();
  },
};

/** In-app replacement for window.confirm; concurrent requests queue and resolve in order. */
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ ...request, resolve });
    if (queue.length === 1) emit();
  });
}

/** In-app replacement for window.alert. */
export async function noticeDialog(title: string, description?: string): Promise<void> {
  await confirmDialog({ title, description, cancelLabel: null, confirmLabel: '知道了' });
}

export function resetConfirmStoreForTest(): void {
  queue = [];
  emit();
}
