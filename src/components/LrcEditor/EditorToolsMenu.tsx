import { useEffect, useRef, useState } from "react";
import { type Translations } from "../../i18n/translations";

// 도구 오버플로우: 찾기/바꾸기 · 시간 이동 · 타임스탬프 스케일 · BPM 스냅.
// 열림 상태와 바깥 클릭 감지는 이 컴포넌트가 자체 소유.
export function EditorToolsMenu({
  t, showFR, showTS, showScale,
  onToggleFR, onToggleTS, onToggleScale, onOpenBpmSnap,
}: {
  t: Translations;
  showFR: boolean;
  showTS: boolean;
  showScale: boolean;
  onToggleFR: () => void;
  onToggleTS: () => void;
  onToggleScale: () => void;
  onOpenBpmSnap: () => void;
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
        className={`ls-button ${`px-3 py-1 text-xs rounded-lg transition-colors ${showTools || showFR || showTS || showScale ? "bg-[var(--ls-control)] text-white" : "text-[var(--ls-text-secondary)] hover:bg-[var(--ls-control)] hover:text-white"}`}`}
      >
        {t.editorTools}
      </button>
      {showTools && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-44 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
          <button
            onClick={() => { onToggleFR(); setShowTools(false); }}
            className={`ls-button ${`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showFR ? "bg-[var(--ls-playhead)] text-[var(--ls-canvas)]" : "hover:bg-[var(--ls-control)] text-[var(--ls-text)]"}`}`}
          >
            {t.findReplace}
          </button>
          <button
            onClick={() => { onToggleTS(); setShowTools(false); }}
            className={`ls-button ${`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showTS ? "bg-sky-600 text-white" : "hover:bg-[var(--ls-control)] text-[var(--ls-text)]"}`}`}
          >
            {t.timeShift}
          </button>
          <button
            onClick={() => { onToggleScale(); setShowTools(false); }}
            className={`ls-button ${`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showScale ? "bg-sky-600 text-white" : "hover:bg-[var(--ls-control)] text-[var(--ls-text)]"}`}`}
          >
            {t.tsScale}
          </button>
          <button
            onClick={() => { onOpenBpmSnap(); setShowTools(false); }}
            className="ls-button text-left text-xs transition-colors"
          >
            {t.bpmLabel}
          </button>
        </div>
      )}
    </div>
  );
}
