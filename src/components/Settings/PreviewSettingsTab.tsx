import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

export function PreviewSettingsTab() {
  const { t } = useI18nStore();
  const {
    previewFontScale, previewActiveColor, previewAccentColor, previewGlowEnabled,
    setPreviewFontScale, setPreviewActiveColor, setPreviewAccentColor, setPreviewGlowEnabled,
  } = useSettingsStore(useShallow((s) => ({
    previewFontScale: s.previewFontScale, previewActiveColor: s.previewActiveColor,
    previewAccentColor: s.previewAccentColor, previewGlowEnabled: s.previewGlowEnabled,
    setPreviewFontScale: s.setPreviewFontScale, setPreviewActiveColor: s.setPreviewActiveColor,
    setPreviewAccentColor: s.setPreviewAccentColor, setPreviewGlowEnabled: s.setPreviewGlowEnabled,
  })));

  return (
    <div className="p-5 flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label htmlFor="preview-font-scale" className="text-sm font-medium text-zinc-200">{t.previewFontScaleLabel}</label>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-zinc-300 w-10 text-right">{Math.round(previewFontScale * 100)}%</span>
            <button type="button" onClick={() => setPreviewFontScale(1)} disabled={previewFontScale === 1}
              className="px-2 py-0.5 text-xs rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {t.settingsUiScaleReset}
            </button>
          </div>
        </div>
        <input id="preview-font-scale" type="range" min={0.8} max={1.5} step={0.05} value={previewFontScale}
          onChange={(e) => setPreviewFontScale(Number(e.target.value))} className="range-slim w-full" />
        <div className="flex justify-between text-xs text-zinc-500 select-none"><span>80%</span><span>100%</span><span>150%</span></div>
      </section>
      <div className="border-t border-zinc-800" />
      <div className="flex items-center justify-between">
        <label htmlFor="preview-active-color" className="text-sm font-medium text-zinc-200">{t.previewActiveColorLabel}</label>
        <input id="preview-active-color" type="color" value={previewActiveColor}
          onChange={(e) => setPreviewActiveColor(e.target.value)}
          className="w-9 h-7 rounded cursor-pointer bg-transparent border border-zinc-700" />
      </div>
      <div className="flex items-center justify-between">
        <label htmlFor="preview-accent-color" className="text-sm font-medium text-zinc-200">{t.previewAccentColorLabel}</label>
        <input id="preview-accent-color" type="color" value={previewAccentColor}
          onChange={(e) => setPreviewAccentColor(e.target.value)}
          className="w-9 h-7 rounded cursor-pointer bg-transparent border border-zinc-700" />
      </div>
      <div className="border-t border-zinc-800" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{t.previewGlowLabel}</span>
        <button type="button" role="switch" aria-label={t.previewGlowLabel} aria-checked={previewGlowEnabled}
          onClick={() => setPreviewGlowEnabled(!previewGlowEnabled)}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 overflow-hidden ${previewGlowEnabled ? "bg-indigo-600" : "bg-zinc-600"}`}>
          <span className={`absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform ${previewGlowEnabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
        </button>
      </div>
    </div>
  );
}
