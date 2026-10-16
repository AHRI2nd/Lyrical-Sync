import { useEffect } from "react";
import { type Translations } from "../../i18n/translations";

export function NoTrackAlert({ t, onClose }: { t: Translations; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--ls-border-subtle)]">
          <span className="font-semibold text-[var(--ls-text)]">{t.spotifyNoTrackAlertTitle}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[var(--ls-text-secondary)] whitespace-pre-line">{t.spotifyNoTrackAlertMessage}</p>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onClose}
            className="ls-button text-sm transition-colors"
          >
            {t.spotifyNoTrackAlertOk}
          </button>
        </div>
      </div>
    </div>
  );
}
