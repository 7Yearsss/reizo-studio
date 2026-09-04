import type React from 'react';
import type {
  AnimatedToast,
  ToastInput,
  ToastStatus,
  AnimatedToastAction,
} from '../components/motion/animated-toast-stack';

type ToastListener = (toasts: AnimatedToast[]) => void;

let toasts: AnimatedToast[] = [];
const listeners = new Set<ToastListener>();
let idCounter = 0;

function notify() {
  const snapshot = [...toasts];
  listeners.forEach((fn) => fn(snapshot));
}

export function subscribeToasts(listener: ToastListener) {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function clearToasts() {
  toasts = [];
  notify();
}

export function showToast(input: ToastInput | string): string {
  const id = typeof input === 'object' && input.id ? input.id : `toast-${Date.now()}-${++idCounter}`;
  const duration = typeof input === 'object' && input.duration !== undefined ? input.duration : 4000;
  const newItem: AnimatedToast =
    typeof input === 'string'
      ? { id, title: input, status: 'neutral', duration, dismissible: true, createdAt: Date.now() }
      : {
          id,
          title: input.title,
          description: input.description,
          status: input.status ?? 'neutral',
          icon: input.icon,
          action: input.action as AnimatedToastAction | undefined,
          duration,
          dismissible: input.dismissible ?? true,
          createdAt: Date.now(),
        };

  toasts = [...toasts.filter((t) => t.id !== id), newItem];
  if (toasts.length > 5) {
    toasts = toasts.slice(-5);
  }
  notify();

  if (duration > 0) {
    window.setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

export const toast = {
  show: showToast,
  success: (title: React.ReactNode, description?: React.ReactNode) =>
    showToast({ title, description, status: 'success' }),
  error: (title: React.ReactNode, description?: React.ReactNode) =>
    showToast({ title, description, status: 'error' }),
  info: (title: React.ReactNode, description?: React.ReactNode) =>
    showToast({ title, description, status: 'info' }),
  loading: (title: React.ReactNode, description?: React.ReactNode) =>
    showToast({ title, description, status: 'loading', duration: 0 }),
  dismiss: dismissToast,
  clear: clearToasts,
};
