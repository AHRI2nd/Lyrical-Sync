import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { ChevronDownIcon } from "./icons";

// Undo/redo 스택(_history/_future)을 하나의 타임라인으로 보여주고 임의 시점으로 점프.
// LangDropdown.tsx와 동일한 바깥 클릭 닫힘 패턴.
export function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18nStore();
  const { _history, _future, jumpToHistory } = useLrcStore((s) => ({
    _history: s._history, _future: s._future, jumpToHistory: s.jumpToHistory,
  }));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const disabled = _history.length === 0 && _future.length === 0;
  const currentIndex = _history.length;

  // 과거(오래된 순) → 현재(가상 엔트리) → 미래(가까운 순) 하나의 타임라인.
  // jumpToHistory의 index 규약과 정확히 일치: index === currentIndex면 현재.
  const rows: { index: number; label: string; timestamp: number; isCurrent: boolean }[] = [
    ..._history.map((e, i) => ({
      index: i,
      label: formatLabel(t, e.label, e.count),
      timestamp: e.timestamp,
      isCurrent: false,
    })),
    { index: currentIndex, label: t.historyCurrent, timestamp: Date.now(), isCurrent: true },
    ..._future.map((e, i) => ({
      index: currentIndex + 1 + i,
      label: formatLabel(t, e.label, e.count),
      timestamp: e.timestamp,
      isCurrent: false,
    })),
  ];
  // 화면엔 최신순으로 표시
  rows.reverse();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t.historyPanelTitle}
        aria-label={t.historyPanelTitle}
        className="w-4 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden py-1 min-w-[220px] max-h-80 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-500 border-b border-zinc-700">
            {t.historyPanelTitle}
          </div>
          {rows.map((row) => (
            <button
              key={row.index}
              onClick={() => { jumpToHistory(row.index); setOpen(false); }}
              className={[
                "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                row.index === currentIndex
                  ? "bg-indigo-600/25 text-indigo-200"
                  : "text-zinc-300 hover:bg-zinc-700 hover:text-white",
              ].join(" ")}
            >
              <span className="truncate">{row.label}</span>
              {!row.isCurrent && (
                <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
                  {new Date(row.timestamp).toLocaleTimeString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatLabel(t: ReturnType<typeof useI18nStore.getState>["t"], label: keyof typeof t.historyLabels, count?: number) {
  const template = t.historyLabels[label];
  return count !== undefined ? template.replace("{count}", String(count)) : template;
}
