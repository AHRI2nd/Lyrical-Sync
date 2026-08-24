import { useEffect, useRef, useState } from "react";
import { type Translations } from "../../i18n/translations";

// 도구 오버플로우: 찾기/바꾸기 · 시간 이동 · 타임스탬프 스케일 · 자동 스팟팅.
// 열림 상태와 바깥 클릭 감지는 이 컴포넌트가 자체 소유.
export function EditorToolsMenu({
  t, showFR, showTS, showScale, showAutoSpot,
  onToggleFR, onToggleTS, onToggleScale, onOpenAutoSpot, onOpenBpmSnap, onOpenMacros,
}: {
  t: Translations;
  showFR: boolean;
  showTS: boolean;
  showScale: boolean;
  showAutoSpot: boolean;
  onToggleFR: () => void;
  onToggleTS: () => void;
  onToggleScale: () => void;
  onOpenAutoSpot: () => void;
  onOpenBpmSnap: () => void;
  onOpenMacros: () => void;
}) {
  const [showTools, setShowTools] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTools) return;
    const h = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setShowTools(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showTools]);

  return (
    <div className="relative" ref={toolsRef}>
      <button
        onClick={() => setShowTools((v) => !v)}
        className={`px-3 py-1 text-xs rounded-lg transition-colors ${showTools || showFR || showTS || showScale || showAutoSpot ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"}`}
      >
        {t.editorTools}
      </button>
      {showTools && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-44 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
          <button
            onClick={() => { onToggleFR(); setShowTools(false); }}
            className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showFR ? "bg-amber-600 text-white" : "hover:bg-zinc-700 text-zinc-200"}`}
          >
            {t.findReplace}
          </button>
          <button
            onClick={() => { onToggleTS(); setShowTools(false); }}
            className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showTS ? "bg-sky-600 text-white" : "hover:bg-zinc-700 text-zinc-200"}`}
          >
            {t.timeShift}
          </button>
          <button
            onClick={() => { onToggleScale(); setShowTools(false); }}
            className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showScale ? "bg-sky-600 text-white" : "hover:bg-zinc-700 text-zinc-200"}`}
          >
            {t.tsScale}
          </button>
          <button
            onClick={() => { onOpenAutoSpot(); setShowTools(false); }}
            className="text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors hover:bg-zinc-700 text-zinc-200"
          >
            {t.autoSpot}
          </button>
          <button
            onClick={() => { onOpenBpmSnap(); setShowTools(false); }}
            className="text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors hover:bg-zinc-700 text-zinc-200"
          >
            {t.bpmLabel}
          </button>
          <button
            onClick={() => { onOpenMacros(); setShowTools(false); }}
            className="text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors hover:bg-zinc-700 text-zinc-200"
          >
            {t.macroManagerTitle}
          </button>
        </div>
      )}
    </div>
  );
}
