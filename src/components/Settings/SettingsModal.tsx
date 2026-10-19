import { SettingsTabBar, TabBtn } from "./SettingsTabs";
import { isComposingKeyEvent } from "../../utils/keybindings";
import { useEffect, useRef, useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { ConfirmModal } from "../AppShell/ConfirmModal";
import { configureRecovery, clearLocalData } from "../../utils/localPrivacy";
import { toast } from "../../stores/useToastStore";
import { PreviewSettingsTab } from "./PreviewSettingsTab";
import { KeybindingsSection } from "./KeybindingsSection";

type Tab = "general" | "shortcuts" | "preview";

export function SettingsModal({ onClose, initialTab = "general" }: { onClose: () => void; initialTab?: Tab }) {
  const { t } = useI18nStore();
  const {
    autoSave, recoveryEnabled, uiScale, showElrcSaveNotice, lyricsFontScale, showGlyphTimeMarkers, showSpellCheck, showTranslationLines,
    setAutoSave, setUiScale, setShowElrcSaveNotice, setLyricsFontScale, setShowGlyphTimeMarkers, setShowSpellCheck, setShowTranslationLines,
  } = useSettingsStore();

  const [confirmTranslations, setConfirmTranslations] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRecoveryOff, setConfirmRecoveryOff] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const returnFocus = useRef(document.activeElement);
  useEffect(() => () => {
    const target = returnFocus.current;
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (e.key === "Escape" && !confirmRecoveryOff && !confirmClear && !confirmTranslations) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, confirmRecoveryOff, confirmClear, confirmTranslations]);

  const scalePercent = Math.round(uiScale * 100);

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[calc(100%-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
          <span className="font-semibold text-[var(--ls-text)]">{t.settingsTitle}</span>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="ls-button hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <SettingsTabBar>
          <TabBtn active={tab === "general"} onClick={() => setTab("general")}>
            {t.settingsTabGeneral}
          </TabBtn>
          <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
            {t.settingsTabPreview}
          </TabBtn>
          <TabBtn active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
            {t.settingsTabShortcuts}
          </TabBtn>
        </SettingsTabBar>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {tab === "general" && (
            <div className="p-5 flex flex-col gap-5">
              <section className="flex flex-col gap-2">
                <button type="button" className="ls-button self-start text-sm text-rose-400 underline"
                  onClick={() => setConfirmClear(true)}>{t.settingsClearLocal}</button>
                <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsClearLocalDesc}</p>
              </section>
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsRecovery}</span>
                  <button type="button" role="switch" aria-label={t.settingsRecovery} aria-checked={recoveryEnabled}
                    className={`ls-button ${`relative w-10 h-5 rounded-full ${recoveryEnabled ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]"}`}`}
                    onClick={() => {
                      if (recoveryEnabled) setConfirmRecoveryOff(true);
                      else if (!configureRecovery(true)) toast.error(t.settingsPrivacyFailure);
                    }}>
                    <span className={`absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white ${recoveryEnabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsRecoveryDesc}</p>
              </section>
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

              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--ls-text)]">{t.translationToggle}</span>
                  <button type="button" role="switch" aria-label={t.translationToggle} aria-checked={showTranslationLines}
                    onClick={() => { if (showTranslationLines) setShowTranslationLines(false); else setConfirmTranslations(true); }}
                    className={`ls-button ${`relative w-10 h-5 rounded-full shrink-0 ${showTranslationLines ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]"}`}`}>
                    <span className={`absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white ${showTranslationLines ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsTranslationDesc}</p>
              </section>
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
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--ls-text)]">{t.settingsSpellCheck}</span>
                  <button type="button" role="switch" aria-label={t.settingsSpellCheck} aria-checked={showSpellCheck}
                    onClick={() => setShowSpellCheck(!showSpellCheck)}
                    className={`ls-button ${`relative w-10 h-5 rounded-full transition-colors shrink-0 overflow-hidden ${showSpellCheck ? "bg-[var(--ls-primary)]" : "bg-[var(--ls-control)]"}`}`}>
                    <span className={`absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform ${showSpellCheck ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <p className="text-xs text-[var(--ls-text-secondary)]">{t.settingsSpellCheckDesc}</p>
              </section>
            </div>
          )}

          {tab === "preview" && <PreviewSettingsTab />}

          {tab === "shortcuts" && (
            <div className="p-5">
              <KeybindingsSection focusCharacterSync={initialTab === "shortcuts"} />
            </div>
          )}
        </div>
      </div>
    </div>
    {confirmTranslations && <ConfirmModal priority title={t.translationWarningTitle}
      message={t.translationWarningMessage} okLabel={t.translationWarningOk} cancelLabel={t.translationWarningCancel}
      onCancel={() => setConfirmTranslations(false)} onOk={() => { setShowTranslationLines(true); setConfirmTranslations(false); }} />}
    {confirmRecoveryOff && <ConfirmModal priority title={t.settingsRecovery}
      message={t.settingsRecoveryOffConfirm} okLabel={t.settingsRecoveryOff} cancelLabel={t.confirmNewCancel}
      onCancel={() => setConfirmRecoveryOff(false)} onOk={() => {
        if (configureRecovery(false)) setConfirmRecoveryOff(false);
        else toast.error(t.settingsPrivacyFailure);
      }} />}
    {confirmClear && <ConfirmModal priority title={t.settingsClearLocal}
      message={t.settingsClearLocalConfirm} okLabel={t.settingsClearLocalAction} cancelLabel={t.confirmNewCancel}
      onCancel={() => setConfirmClear(false)} onOk={() => {
        if (clearLocalData()) { setConfirmClear(false); toast.success(t.settingsClearLocalDone); }
        else toast.error(t.settingsPrivacyFailure);
      }} />}
    </>
  );
}
