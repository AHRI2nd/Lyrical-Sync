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
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--ls-border-subtle)]">
          <span className="font-semibold text-[var(--ls-text)]">{t.elrcNotice.title}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[var(--ls-text-secondary)] leading-relaxed">{t.elrcNotice.message}</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-xs text-[var(--ls-text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-[var(--ls-accent)] w-3.5 h-3.5"
            />
            {t.elrcNotice.dontShowAgain}
          </label>
          <button
            onClick={() => onConfirm(dontShowAgain)}
            className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] text-white font-medium transition-colors ls-button--primary"
          >
            {t.elrcNotice.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
