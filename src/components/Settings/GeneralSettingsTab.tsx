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
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsAutoUpdate}</span>
          <button
            onClick={() => setAutoCheckUpdate(!autoCheckUpdate)}
            className={`ls-button ${[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              autoCheckUpdate ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]",
            ].join(" ")}`}
            role="switch"
            aria-checked={autoCheckUpdate}
            aria-label={t.settingsAutoUpdate}
          >
            <span
              className={[
                "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                autoCheckUpdate ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsAutoUpdateDesc}</p>

        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={onCheckNow}
            disabled={checkState === "checking"}
            className="ls-button text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {checkState === "checking" ? t.settingsChecking : t.settingsCheckNow}
          </button>
          {checkState === "upToDate" && (
            <span className="text-xs text-emerald-400">{t.settingsUpToDate}</span>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Auto save */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsAutoSave}</span>
          <button
            onClick={() => setAutoSave(!autoSave)}
            className={`ls-button ${[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              autoSave ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]",
            ].join(" ")}`}
            role="switch"
            aria-checked={autoSave}
            aria-label={t.settingsAutoSave}
          >
            <span
              className={[
                "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                autoSave ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsAutoSaveDesc}</p>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Enhanced LRC 저장 알림 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsElrcNotice}</span>
          <button
            onClick={() => setShowElrcSaveNotice(!showElrcSaveNotice)}
            className={`ls-button ${[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              showElrcSaveNotice ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]",
            ].join(" ")}`}
            role="switch"
            aria-checked={showElrcSaveNotice}
            aria-label={t.settingsElrcNotice}
          >
            <span
              className={[
                "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                showElrcSaveNotice ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsElrcNoticeDesc}</p>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Blank line offset */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.aiSyncBlankOffset}</span>
          <span className="text-sm tabular-nums text-[var(--ls-text-secondary)] w-12 text-right">
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
          className="ls-range range-slim w-full"
          style={{ backgroundImage: `linear-gradient(to right, #6366f1 ${Math.round((blankLineOffset / 5) * 100)}%, #3f3f46 ${Math.round((blankLineOffset / 5) * 100)}%)` }}
        />
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.aiSyncBlankOffsetDesc}</p>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* UI Scale */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsUiScale}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-[var(--ls-text-secondary)] w-10 text-right">
              {scalePercent}%
            </span>
            <button
              onClick={() => setUiScale(1.0)}
              disabled={uiScale === 1.0}
              className="ls-button text-xs hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          className="ls-range range-slim w-full"
          style={{ backgroundImage: `linear-gradient(to right, #6366f1 ${Math.round(((uiScale - 0.7) / 0.6) * 100)}%, #3f3f46 ${Math.round(((uiScale - 0.7) / 0.6) * 100)}%)` }}
        />
        <div className="flex justify-between text-xs text-[var(--ls-text-secondary)] select-none">
          <span>70%</span>
          <span>100%</span>
          <span>130%</span>
        </div>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Lyrics font size */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsLyricsFontSize}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-[var(--ls-text-secondary)] w-10 text-right">
              {Math.round(lyricsFontScale * 100)}%
            </span>
            <button
              onClick={() => setLyricsFontScale(1.0)}
              disabled={lyricsFontScale === 1.0}
              className="ls-button text-xs hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          className="ls-range range-slim w-full"
          style={{ backgroundImage: `linear-gradient(to right, #6366f1 ${Math.round(((lyricsFontScale - 0.8) / 0.7) * 100)}%, #3f3f46 ${Math.round(((lyricsFontScale - 0.8) / 0.7) * 100)}%)` }}
        />
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Glyph time markers */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsGlyphMarkers}</span>
          <button
            onClick={() => setShowGlyphTimeMarkers(!showGlyphTimeMarkers)}
            className={`ls-button ${[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              showGlyphTimeMarkers ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]",
            ].join(" ")}`}
            role="switch"
            aria-checked={showGlyphTimeMarkers}
            aria-label={t.settingsGlyphMarkers}
          >
            <span
              className={[
                "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                showGlyphTimeMarkers ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsGlyphMarkersDesc}</p>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Spell check */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsSpellCheck}</span>
          <button
            onClick={() => setShowSpellCheck(!showSpellCheck)}
            className={`ls-button ${[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              showSpellCheck ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]",
            ].join(" ")}`}
            role="switch"
            aria-checked={showSpellCheck}
            aria-label={t.settingsSpellCheck}
          >
            <span
              className={[
                "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                showSpellCheck ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsSpellCheckDesc}</p>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Translation lines */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.translationToggle}</span>
          <button
            onClick={handleToggleTranslation}
            className={`ls-button ${[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              showTranslationLines ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]",
            ].join(" ")}`}
            role="switch"
            aria-checked={showTranslationLines}
            aria-label={t.translationToggle}
          >
            <span
              className={[
                "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                showTranslationLines ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsTranslationDesc}</p>
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
