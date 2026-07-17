import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useToastStore, type ToastKind } from "../store/toastStore";

const ICONS: Record<ToastKind, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon size={14} aria-hidden="true" />
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="dismiss notification">
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
