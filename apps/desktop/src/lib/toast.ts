import { useSyncExternalStore } from "react";

export interface Toast { id: number; text: string }
let toasts: Toast[] = [];
const subs = new Set<() => void>();
let seq = 1;

export function toast(text: string) {
  const id = seq++;
  toasts = [...toasts, { id, text }];
  subs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    subs.forEach((f) => f());
  }, 2600);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => toasts,
    () => toasts,
  );
}
