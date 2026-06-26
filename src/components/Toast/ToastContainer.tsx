import { useToastStore, type ToastType } from "../../stores/useToastStore";

const STYLE: Record<ToastType, string> = {
  success: "bg-emerald-950/95 border-emerald-700 text-emerald-100",
  error: "bg-rose-950/95 border-rose-700 text-rose-100",
  info: "bg-zinc-800/95 border-zinc-600 text-zinc-100",
};

function Icon({ type }: { type: ToastType }) {
  if (type === "success")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  if (type === "error")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer flex items-start gap-2 px-3.5 py-2.5 rounded-lg shadow-xl border text-sm max-w-xs animate-[toastIn_.18s_ease-out] backdrop-blur-sm ${STYLE[t.type]}`}
        >
          <span className="shrink-0 mt-0.5"><Icon type={t.type} /></span>
          <span className="flex-1 leading-snug break-words">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
