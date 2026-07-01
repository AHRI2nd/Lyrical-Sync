import { useEffect, useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { KeybindingsSection } from "./KeybindingsSection";

type Tab = "general" | "shortcuts";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const {
    autoSave, uiScale, showElrcSaveNotice, lyricsFontScale, showGlyphTimeMarkers,
    setAutoSave, setUiScale, setShowElrcSaveNotice, setLyricsFontScale, setShowGlyphTimeMarkers,
  } = useSettingsStore();

  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const scalePercent = Math.round(uiScale * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.settingsTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          <TabBtn active={tab === "general"} onClick={() => setTab("general")}>
            {t.settingsTabGeneral}
          </TabBtn>
          <TabBtn active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
            {t.settingsTabShortcuts}
          </TabBtn>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {tab === "general" && (
            <div className="p-5 flex flex-col gap-5">
              {/* Auto save */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsAutoSave}</span>
                  <button
                    onClick={() => setAutoSave(!autoSave)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      autoSave ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={autoSave}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        autoSave ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsAutoSaveDesc}</p>
              </div>

              <div className="border-t border-zinc-800" />

              {/* Enhanced LRC 저장 알림 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsElrcNotice}</span>
                  <button
                    onClick={() => setShowElrcSaveNotice(!showElrcSaveNotice)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      showElrcSaveNotice ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={showElrcSaveNotice}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        showElrcSaveNotice ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsElrcNoticeDesc}</p>
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
                      className="px-2 py-0.5 text-xs rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t.settingsUiScaleReset}
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.3}
                  step={0.05}
                  value={uiScale}
                  onChange={(e) => setUiScale(Number(e.target.value))}
                  className="range-slim w-full"
                  style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(((uiScale - 0.7) / 0.6) * 100)}%, #3f3f46 ${Math.round(((uiScale - 0.7) / 0.6) * 100)}%)` }}
                />
                <div className="flex justify-between text-xs text-zinc-500 select-none">
                  <span>70%</span>
                  <span>100%</span>
                  <span>130%</span>
                </div>
              </div>

              <div className="border-t border-zinc-800" />

              {/* Lyrics font size */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsLyricsFontSize}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-zinc-300 w-10 text-right">
                      {Math.round(lyricsFontScale * 100)}%
                    </span>
                    <button
                      onClick={() => setLyricsFontScale(1.0)}
                      disabled={lyricsFontScale === 1.0}
                      className="px-2 py-0.5 text-xs rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t.settingsUiScaleReset}
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={1.5}
                  step={0.05}
                  value={lyricsFontScale}
                  onChange={(e) => setLyricsFontScale(Number(e.target.value))}
                  className="range-slim w-full"
                  style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(((lyricsFontScale - 0.8) / 0.7) * 100)}%, #3f3f46 ${Math.round(((lyricsFontScale - 0.8) / 0.7) * 100)}%)` }}
                />
              </div>

              <div className="border-t border-zinc-800" />

              {/* Glyph time markers */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsGlyphMarkers}</span>
                  <button
                    onClick={() => setShowGlyphTimeMarkers(!showGlyphTimeMarkers)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      showGlyphTimeMarkers ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={showGlyphTimeMarkers}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        showGlyphTimeMarkers ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsGlyphMarkersDesc}</p>
              </div>
            </div>
          )}

          {tab === "shortcuts" && (
            <div className="p-5">
              <KeybindingsSection />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "text-indigo-400 border-indigo-500"
          : "text-zinc-400 border-transparent hover:text-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
