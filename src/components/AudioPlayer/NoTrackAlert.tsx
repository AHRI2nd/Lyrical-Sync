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
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.spotifyNoTrackAlertTitle}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300 whitespace-pre-line">{t.spotifyNoTrackAlertMessage}</p>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onClose}
            className="px-5 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
          >
            {t.spotifyNoTrackAlertOk}
          </button>
        </div>
      </div>
    </div>
  );
}
