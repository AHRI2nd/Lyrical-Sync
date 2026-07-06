import { useEffect, useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";

export function ELrcNoticeModal({
  onConfirm, onCancel,
}: {
  onConfirm: (dontShowAgain: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18nStore();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm(dontShowAgain);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm, dontShowAgain]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.elrcNotice.title}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300 leading-relaxed">{t.elrcNotice.message}</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-indigo-600 w-3.5 h-3.5"
            />
            {t.elrcNotice.dontShowAgain}
          </label>
          <button
            onClick={() => onConfirm(dontShowAgain)}
            className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            {t.elrcNotice.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
