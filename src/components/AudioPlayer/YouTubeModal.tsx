import { useId, useRef } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { type Translations } from "../../i18n/translations";
import { YouTubeLinkIcon } from "./icons";
import { useModalFocus } from "../../hooks/useModalFocus";
import { isComposingKeyEvent } from "../../utils/keybindings";

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
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(dialog, () => { if (!ytLoading) onClose(); }, true, 60);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)]">
          <div className="flex items-center gap-2">
            <span className="text-red-500"><YouTubeLinkIcon /></span>
            <span id={titleId} className="font-semibold text-[var(--ls-text)] text-sm">{t.youtubeModalTitle}</span>
          </div>
          {!ytLoading && (
            <button
              onClick={onClose}
              aria-label={t.close}
              className="ls-button hover:text-white transition-colors text-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>

        {!youtubeDisclaimerAccepted ? (
          /* 최초 1회 면책 동의 게이트 */
          <div className="p-5 flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-[var(--ls-text-secondary)]">{t.youtubeDisclaimer}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="ls-button text-sm transition-colors"
              >
                {t.youtubeCancel}
              </button>
              <button
                onClick={() => setYoutubeDisclaimerAccepted(true)}
                className="ls-button text-sm bg-red-600 hover:bg-red-500 text-white transition-colors"
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
              onKeyDown={(e) => { if (e.key === "Enter" && !isComposingKeyEvent(e.nativeEvent) && !ytLoading && ytUrl.trim()) onLoad(); }}
              aria-label={t.youtubeUrlPlaceholder}
              placeholder={t.youtubeUrlPlaceholder}
              disabled={ytLoading}
              autoFocus
              className="ls-field flex-1 min-w-0 text-sm font-mono disabled:opacity-50"
            />
          </div>

          {ytLoading && (
            <span className="text-xs text-[var(--ls-text-secondary)]">{t.youtubeLoading}</span>
          )}

          {ytError && (
            <span className="text-xs text-red-400 break-all">{ytError}</span>
          )}

          <p className="text-[11px] leading-relaxed text-[var(--ls-text-secondary)] border-t border-[var(--ls-border-subtle)] pt-3">
            {t.youtubeDisclaimer}
          </p>

          <div className="flex justify-end gap-2">
            {ytLoading ? (
              <button
                onClick={onCancel}
                className="ls-button text-sm transition-colors"
              >
                {t.youtubeCancel}
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="ls-button text-sm transition-colors"
                >
                  {t.youtubeCancel}
                </button>
                <button
                  onClick={onLoad}
                  disabled={!ytUrl.trim()}
                  className="ls-button text-sm bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
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
