import { useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { ConfirmModal } from "../AppShell/ConfirmModal";

export type CheckState = "idle" | "checking" | "upToDate";

export function GeneralSettingsTab({
  checkState,
  onCheckNow,
}: {
  checkState: CheckState;
  onCheckNow: () => void;
}) {
  const { t } = useI18nStore();
  const {
    autoCheckUpdate, autoSave, uiScale, blankLineOffset, showElrcSaveNotice, lyricsFontScale, showGlyphTimeMarkers, showSpellCheck, showTranslationLines,
    setAutoCheckUpdate, setAutoSave, setUiScale, setBlankLineOffset, setShowElrcSaveNotice, setLyricsFontScale, setShowGlyphTimeMarkers, setShowSpellCheck, setShowTranslationLines,
  } = useSettingsStore();

  const scalePercent = Math.round(uiScale * 100);

  // 켜기 전에 한 번 경고: 번역 줄은 표준 LRC 규격에 없는 확장 표기(같은 타임스탬프의
  // "/" 접두사 줄)라, 저장한 파일이 다른 LRC 플레이어/도구와 호환되지 않을 수 있음.
  // 끄는 쪽은 항상 안전하므로 경고 없이 바로 반영.
  const [showTranslationWarning, setShowTranslationWarning] = useState(false);
  const handleToggleTranslation = () => {
    if (showTranslationLines) setShowTranslationLines(false);
    else setShowTranslationWarning(true);
  };

  return (
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
            onClick={onCheckNow}
            disabled={checkState === "checking"}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 transition-colors"
          >
            {checkState === "checking" ? t.settingsChecking : t.settingsCheckNow}
          </button>
          {checkState === "upToDate" && (
            <span className="text-xs text-emerald-400">{t.settingsUpToDate}</span>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

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

      {/* Blank line offset */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{t.aiSyncBlankOffset}</span>
          <span className="text-sm tabular-nums text-zinc-300 w-12 text-right">
            {blankLineOffset.toFixed(1)}s
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={blankLineOffset}
          onChange={(e) => setBlankLineOffset(Number(e.target.value))}
          className="range-slim w-full"
          style={{ background: `linear-gradient(to right, #6366f1 ${Math.round((blankLineOffset / 5) * 100)}%, #3f3f46 ${Math.round((blankLineOffset / 5) * 100)}%)` }}
        />
        <p className="text-xs text-zinc-500">{t.aiSyncBlankOffsetDesc}</p>
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

      <div className="border-t border-zinc-800" />

      {/* Spell check */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{t.settingsSpellCheck}</span>
          <button
            onClick={() => setShowSpellCheck(!showSpellCheck)}
            className={[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              showSpellCheck ? "bg-indigo-600" : "bg-zinc-600",
            ].join(" ")}
            role="switch"
            aria-checked={showSpellCheck}
          >
            <span
              className={[
                "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                showSpellCheck ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t.settingsSpellCheckDesc}</p>
      </div>

      <div className="border-t border-zinc-800" />

      {/* Translation lines */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{t.translationToggle}</span>
          <button
            onClick={handleToggleTranslation}
            className={[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              showTranslationLines ? "bg-indigo-600" : "bg-zinc-600",
            ].join(" ")}
            role="switch"
            aria-checked={showTranslationLines}
          >
            <span
              className={[
                "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                showTranslationLines ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t.settingsTranslationDesc}</p>
      </div>

      {showTranslationWarning && (
        <ConfirmModal
          title={t.translationWarningTitle}
          message={t.translationWarningMessage}
          okLabel={t.translationWarningOk}
          cancelLabel={t.translationWarningCancel}
          onOk={() => { setShowTranslationLines(true); setShowTranslationWarning(false); }}
          onCancel={() => setShowTranslationWarning(false)}
        />
      )}
    </div>
  );
}
