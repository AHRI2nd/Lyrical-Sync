import { useEffect, useRef, useState } from "react";
import { useMacroStore } from "../../stores/useMacroStore";
import { useI18nStore } from "../../stores/useI18nStore";

// 매크로 녹화 시작/중지 버튼. 중지 시 이름을 붙여 저장하거나 버릴지 인라인 팝오버로 확인.
export function MacroRecordButton() {
  const { t } = useI18nStore();
  const isRecording = useMacroStore((s) => s.isRecording);
  const currentSteps = useMacroStore((s) => s.currentSteps);
  const startRecording = useMacroStore((s) => s.startRecording);
  const discardRecording = useMacroStore((s) => s.discardRecording);
  const saveMacro = useMacroStore((s) => s.saveMacro);

  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSavePrompt) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowSavePrompt(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showSavePrompt]);

  const handleClick = () => {
    if (!isRecording) {
      startRecording();
      return;
    }
    setName("");
    setShowSavePrompt(true);
  };

  const handleSave = () => {
    saveMacro(name.trim() || t.macroUntitled);
    setShowSavePrompt(false);
  };

  const handleDiscard = () => {
    discardRecording();
    setShowSavePrompt(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleClick}
        title={isRecording ? t.macroStopRecording : t.macroStartRecording}
        aria-label={isRecording ? t.macroStopRecording : t.macroStartRecording}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors ${
          isRecording ? "bg-rose-600/20 text-rose-300" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
        }`}
      >
        <span className={`w-2 h-2 rounded-full bg-rose-500 ${isRecording ? "animate-pulse" : "opacity-60"}`} />
        {isRecording ? t.macroRecording : t.macroRecord}
      </button>

      {showSavePrompt && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-56 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-3 flex flex-col gap-2">
          <p className="text-[11px] text-zinc-400">
            {currentSteps.length} {t.macroStepsRecorded}
          </p>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleDiscard(); }}
            placeholder={t.macroNamePlaceholder}
            className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <div className="flex justify-end gap-1.5">
            <button
              onClick={handleDiscard}
              className="px-2.5 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              {t.macroDiscard}
            </button>
            <button
              onClick={handleSave}
              disabled={currentSteps.length === 0}
              className="px-2.5 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {t.macroSave}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
