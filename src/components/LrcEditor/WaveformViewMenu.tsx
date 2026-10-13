import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";

export function WaveformViewMenu() {
  const { t } = useI18nStore();
  const height = useSettingsStore(s => s.glyphWaveformHeight);
  const style = useSettingsStore(s => s.glyphWaveformStyle);
  const markers = useSettingsStore(s => s.showGlyphTimeMarkers);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div ref={ref} className="relative">
    <button ref={trigger} type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}
      className="px-2.5 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 text-xs">{t.charSync.waveformView}</button>
    {open && <div className="absolute right-0 top-full mt-2 z-40 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-600 bg-zinc-900 p-3 shadow-xl text-xs text-zinc-300"
      role="group" aria-label={t.charSync.waveformView}>
      <label className="flex flex-col gap-2 mb-3">{t.charSync.waveformHeight} · {height}px
        <input type="range" min={80} max={240} step={8} value={height} aria-label={t.charSync.waveformHeight}
          onChange={e => useSettingsStore.getState().setGlyphWaveformHeight(Number(e.target.value))} className="accent-indigo-400 w-full" />
      </label>
      <label className="flex items-center justify-between gap-2 mb-3">{t.charSync.waveformStyle}
        <select aria-label={t.charSync.waveformStyle} value={style} onChange={e => useSettingsStore.getState().setGlyphWaveformStyle(e.target.value as "continuous" | "bars")}
          className="min-w-0 bg-zinc-800 border border-zinc-600 rounded px-2 py-1">
          <option value="continuous">{t.charSync.waveformContinuous}</option><option value="bars">{t.charSync.waveformBars}</option>
        </select>
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={markers}
        onChange={e => useSettingsStore.getState().setShowGlyphTimeMarkers(e.target.checked)} className="accent-indigo-400" />{t.charSync.glyphMarkers}</label>
    </div>}
  </div>;
}
