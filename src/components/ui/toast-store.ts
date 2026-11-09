/**
 * Tiny external store behind `useToast()`. A module-level store lets any client code call
 * `toast(...)` without a provider; the single <Toaster /> subscribes and renders.
 */
export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastInput = {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before it closes itself. Default 6000. */
  duration?: number;
};

export type ToastItem = ToastInput & { id: string; tone: ToastTone };

const MAX_VISIBLE = 4;
let items: readonly ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function publish(next: readonly ToastItem[]) {
  items = next;
  listeners.forEach((listener) => listener());
}

export function toast(input: ToastInput): string {
  counter += 1;
  const id = `toast-${counter}`;
  publish([...items, { ...input, id, tone: input.tone ?? "info" }].slice(-MAX_VISIBLE));
  return id;
}

export function dismissToast(id: string) {
  publish(items.filter((item) => item.id !== id));
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getToasts = () => items;
const NO_TOASTS: readonly ToastItem[] = [];
export const getServerToasts = () => NO_TOASTS;
