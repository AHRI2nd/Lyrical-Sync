import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

// 미리보기(가라오케) 스타일 커스터마이징 — 활성 줄 색상/강조 색상/글꼴 크기/글로우.
// 기본값은 PreviewModal의 기존 하드코딩 값(#ffffff 활성 텍스트, 인디고 강조)과 동일해
// 켜기 전까지 기존 사용자에게 시각적 변화가 없다.
export function PreviewSettingsTab() {
  const { t } = useI18nStore();
  const {
    previewFontScale, previewActiveColor, previewAccentColor, previewGlowEnabled,
    setPreviewFontScale, setPreviewActiveColor, setPreviewAccentColor, setPreviewGlowEnabled,
  } = useSettingsStore();

  return (
    <div className="p-5 flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{t.previewFontScaleLabel}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-zinc-300 w-10 text-right">
              {Math.round(previewFontScale * 100)}%
            </span>
            <button
              onClick={() => setPreviewFontScale(1.0)}
              disabled={previewFontScale === 1.0}
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
          value={previewFontScale}
          onChange={(e) => setPreviewFontScale(Number(e.target.value))}
          className="range-slim w-full"
          style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(((previewFontScale - 0.8) / 0.7) * 100)}%, #3f3f46 ${Math.round(((previewFontScale - 0.8) / 0.7) * 100)}%)` }}
        />
      </div>

      <div className="border-t border-zinc-800" />

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{t.previewActiveColorLabel}</span>
        <input
          type="color"
          value={previewActiveColor}
          onChange={(e) => setPreviewActiveColor(e.target.value)}
          className="w-9 h-7 rounded cursor-pointer bg-transparent border border-zinc-700"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{t.previewAccentColorLabel}</span>
        <input
          type="color"
          value={previewAccentColor}
          onChange={(e) => setPreviewAccentColor(e.target.value)}
          className="w-9 h-7 rounded cursor-pointer bg-transparent border border-zinc-700"
        />
      </div>

      <div className="border-t border-zinc-800" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{t.previewGlowLabel}</span>
          <button
            onClick={() => setPreviewGlowEnabled(!previewGlowEnabled)}
            className={[
              "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
              previewGlowEnabled ? "bg-indigo-600" : "bg-zinc-600",
            ].join(" ")}
            role="switch"
            aria-checked={previewGlowEnabled}
          >
            <span
              className={[
                "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                previewGlowEnabled ? "translate-x-[22px]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
