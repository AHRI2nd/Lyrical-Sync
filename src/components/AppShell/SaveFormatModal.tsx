import { useEffect } from "react";
import { useI18nStore } from "../../stores/useI18nStore";

export function SaveFormatModal({
  onSelect, onCancel,
}: {
  onSelect: (format: "lrc" | "srt" | "vtt" | "ass") => void;
  onCancel: () => void;
}) {
  const { t } = useI18nStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const optClass =
    "flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg bg-[var(--ls-control)] hover:bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] hover:border-[var(--ls-accent)] transition-colors text-left";

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
          <span className="font-semibold text-[var(--ls-text)]">{t.saveFormatTitle}</span>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4">
          <button onClick={() => onSelect("lrc")} className={`ls-button ${optClass}`}>
            <span className="text-sm font-semibold text-white">LRC <span className="text-[var(--ls-text-secondary)] font-normal">(.lrc)</span></span>
            <span className="text-xs text-[var(--ls-text-secondary)]">{t.saveFormatLrcDesc}</span>
          </button>
          <button onClick={() => onSelect("srt")} className={`ls-button ${optClass}`}>
            <span className="text-sm font-semibold text-white">SubRip <span className="text-[var(--ls-text-secondary)] font-normal">(.srt)</span></span>
            <span className="text-xs text-[var(--ls-text-secondary)]">{t.saveFormatSrtDesc}</span>
          </button>
          <button onClick={() => onSelect("vtt")} className={`ls-button ${optClass}`}>
            <span className="text-sm font-semibold text-white">WebVTT <span className="text-[var(--ls-text-secondary)] font-normal">(.vtt)</span></span>
            <span className="text-xs text-[var(--ls-text-secondary)]">{t.saveFormatVttDesc}</span>
          </button>
          <button onClick={() => onSelect("ass")} className={`ls-button ${optClass}`}>
            <span className="text-sm font-semibold text-white">ASS <span className="text-[var(--ls-text-secondary)] font-normal">(.ass)</span></span>
            <span className="text-xs text-[var(--ls-text-secondary)]">{t.saveFormatAssDesc}</span>
          </button>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onCancel}
            className="ls-button text-sm hover:text-white transition-colors"
          >
            {t.rawEditorCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
