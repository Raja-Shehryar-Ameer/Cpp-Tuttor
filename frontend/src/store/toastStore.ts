import { create } from "zustand";

// App-wide notifications: transient events (copied, trace ready, validation
// complaints) surface here; persistent failures keep their inline banners so
// the state stays visible after the toast is gone.

export type ToastKind = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
// Errors linger longer — they carry the "what went wrong", not just a nicety.
const TTL: Record<ToastKind, number> = { success: 3500, info: 5000, warning: 6000, error: 8000 };

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) =>
    set((s) => {
      // Same message already showing: don't stack duplicates.
      if (s.toasts.some((t) => t.message === message)) return s;
      const id = nextId++;
      window.setTimeout(() => {
        useToastStore.setState((cur) => ({ toasts: cur.toasts.filter((t) => t.id !== id) }));
      }, TTL[kind]);
      return { toasts: [...s.toasts.slice(-3), { id, kind, message }] }; // keep at most 4
    }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Fold a list of messages into ONE toast: the first (usually most useful)
    message plus a count of the rest. Validators tend to produce several
    near-identical complaints per click — a toast per item just buries the
    first one under a stack. */
const coalesce = (msgs: string[]): string | null => {
  if (msgs.length === 0) return null;
  if (msgs.length === 1) return msgs[0];
  return `${msgs[0]} (+${msgs.length - 1} more issue${msgs.length > 2 ? "s" : ""})`;
};

export const notify = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => useToastStore.getState().push("error", m),
  warning: (m: string) => useToastStore.getState().push("warning", m),
  info: (m: string) => useToastStore.getState().push("info", m),
  errors: (msgs: string[]) => {
    const m = coalesce(msgs);
    if (m) useToastStore.getState().push("error", m);
  },
  warnings: (msgs: string[]) => {
    const m = coalesce(msgs);
    if (m) useToastStore.getState().push("warning", m);
  },
};
