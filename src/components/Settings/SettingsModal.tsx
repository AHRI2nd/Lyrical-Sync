import { useEffect, useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { checkForUpdate } from "../../utils/updateCheck";

type CheckState = "idle" | "checking" | "upToDate";

export function SettingsModal({
  onClose,
  onUpdateFound,
}: {
  onClose: () => void;
  onUpdateFound: (version: string) => void;
}) {
  const { t } = useI18nStore();
  const { autoCheckUpdate, uiScale, setAutoCheckUpdate, setUiScale } = useSettingsStore();
  const [checkState, setCheckState] = useState<CheckState>("idle");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCheckNow = async () => {
    setCheckState("checking");
    try {
      const version = await checkForUpdate();
      if (version) {
        onClose();
        onUpdateFound(version);
      } else {
        setCheckState("upToDate");
      }
    } catch {
      setCheckState("upToDate");
    }
  };

  const scalePercent = Math.round(uiScale * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.settingsTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Auto update */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-200">{t.settingsAutoUpdate}</span>
              <button
                onClick={() => setAutoCheckUpdate(!autoCheckUpdate)}
                className={[
                  "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                  autoCheckUpdate ? "bg-indigo-600" : "bg-zinc-600",
                ].join(" ")}
                role="switch"
                aria-checked={autoCheckUpdate}
              >
                <span
                  className={[
                    "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                    autoCheckUpdate ? "translate-x-[22px]" : "translate-x-0.5",
                  ].join(" ")}
                />
              </button>
            </div>
            <p className="text-xs text-zinc-500">{t.settingsAutoUpdateDesc}</p>

            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={handleCheckNow}
                disabled={checkState === "checking"}
                className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 transition-colors"
              >
                {checkState === "checking" ? t.settingsChecking : t.settingsCheckNow}
              </button>
              {checkState === "upToDate" && (
                <span className="text-xs text-emerald-400">{t.settingsUpToDate}</span>
              )}
            </div>
          </div>

          <div className="border-t border-zinc-800" />

          {/* UI Scale */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-200">{t.settingsUiScale}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-zinc-300 w-10 text-right">
                  {scalePercent}%
                </span>
                <button
                  onClick={() => setUiScale(1.0)}
                  disabled={uiScale === 1.0}
                  className="px-2 py-0.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 transition-colors"
                >
                  {t.settingsUiScaleReset}
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0.7}
              max={1.4}
              step={0.05}
              value={uiScale}
              onChange={(e) => setUiScale(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-zinc-500 select-none">
              <span>70%</span>
              <span>100%</span>
              <span>140%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
