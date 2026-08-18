import { type Translations } from "../../i18n/translations";
import { type SyncUnit } from "../../utils/lrcParser";

// 줄 ↔ 글자 동기화 모드 토글 + (글자 모드일 때) 글자/단어 단위 토글.
export function SyncModeToggle({
  t, charMode, onSetSyncMode, syncUnit, onUnitChange, isRunning,
}: {
  t: Translations;
  charMode: boolean;
  onSetSyncMode: (m: "line" | "char") => void;
  syncUnit: SyncUnit;
  onUnitChange: (u: SyncUnit) => void;
  isRunning: boolean;
}) {
  return (
    <>
      <div className="inline-flex bg-zinc-800 rounded-lg p-0.5">
        <button
          onClick={(e) => { onSetSyncMode("line"); e.currentTarget.blur(); }}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${!charMode ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          {t.charSync.modeLine}
        </button>
        <button
          onClick={(e) => { onSetSyncMode("char"); e.currentTarget.blur(); }}
          disabled={isRunning}
          title={isRunning ? t.aiSyncRunning : undefined}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${charMode ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          {t.charSync.modeChar}
        </button>
      </div>

      {charMode && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">{t.charSync.unitLabel}</span>
          <div className="inline-flex bg-zinc-800 rounded-lg p-0.5">
            <button
              onClick={(e) => { onUnitChange("char"); e.currentTarget.blur(); }}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${syncUnit === "char" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {t.charSync.unitChar}
            </button>
            <button
              onClick={(e) => { onUnitChange("word"); e.currentTarget.blur(); }}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${syncUnit === "word" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {t.charSync.unitWord}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
