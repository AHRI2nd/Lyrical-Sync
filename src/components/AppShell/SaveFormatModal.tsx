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
    "flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-colors text-left";

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
          <span className="font-semibold text-zinc-100">{t.saveFormatTitle}</span>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4">
          <button onClick={() => onSelect("lrc")} className={optClass}>
            <span className="text-sm font-semibold text-white">LRC <span className="text-zinc-500 font-normal">(.lrc)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatLrcDesc}</span>
          </button>
          <button onClick={() => onSelect("srt")} className={optClass}>
            <span className="text-sm font-semibold text-white">SubRip <span className="text-zinc-500 font-normal">(.srt)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatSrtDesc}</span>
          </button>
          <button onClick={() => onSelect("vtt")} className={optClass}>
            <span className="text-sm font-semibold text-white">WebVTT <span className="text-zinc-500 font-normal">(.vtt)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatVttDesc}</span>
          </button>
          <button onClick={() => onSelect("ass")} className={optClass}>
            <span className="text-sm font-semibold text-white">ASS <span className="text-zinc-500 font-normal">(.ass)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatAssDesc}</span>
          </button>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {t.rawEditorCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
