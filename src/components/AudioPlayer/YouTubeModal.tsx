import { useEffect } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { type Translations } from "../../i18n/translations";
import { YouTubeLinkIcon } from "./icons";

export function YouTubeModal({
  t, ytUrl, ytLoading, ytError,
  onChangeUrl, onLoad, onCancel, onClose,
}: {
  t: Translations;
  ytUrl: string;
  ytLoading: boolean;
  ytError: string | null;
  onChangeUrl: (v: string) => void;
  onLoad: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const youtubeDisclaimerAccepted = useSettingsStore((s) => s.youtubeDisclaimerAccepted);
  const setYoutubeDisclaimerAccepted = useSettingsStore((s) => s.setYoutubeDisclaimerAccepted);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ytLoading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ytLoading, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-red-500"><YouTubeLinkIcon /></span>
            <span className="font-semibold text-zinc-100 text-sm">{t.youtubeModalTitle}</span>
          </div>
          {!ytLoading && (
            <button
              onClick={onClose}
              aria-label={t.close}
              className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>

        {!youtubeDisclaimerAccepted ? (
          /* 최초 1회 면책 동의 게이트 */
          <div className="p-5 flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-zinc-300">{t.youtubeDisclaimer}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
              >
                {t.youtubeCancel}
              </button>
              <button
                onClick={() => setYoutubeDisclaimerAccepted(true)}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                {t.youtubeAgree}
              </button>
            </div>
          </div>
        ) : (
        <div className="p-5 flex flex-col gap-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={ytUrl}
              onChange={(e) => onChangeUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !ytLoading && ytUrl.trim()) onLoad(); }}
              placeholder={t.youtubeUrlPlaceholder}
              disabled={ytLoading}
              autoFocus
              className="flex-1 min-w-0 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono disabled:opacity-50"
            />
          </div>

          {ytLoading && (
            <span className="text-xs text-zinc-400">{t.youtubeLoading}</span>
          )}

          {ytError && (
            <span className="text-xs text-red-400 break-all">{ytError}</span>
          )}

          <p className="text-[11px] leading-relaxed text-zinc-500 border-t border-zinc-800 pt-3">
            {t.youtubeDisclaimer}
          </p>

          <div className="flex justify-end gap-2">
            {ytLoading ? (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
              >
                {t.youtubeCancel}
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                >
                  {t.youtubeCancel}
                </button>
                <button
                  onClick={onLoad}
                  disabled={!ytUrl.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {t.youtubeLoad}
                </button>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
