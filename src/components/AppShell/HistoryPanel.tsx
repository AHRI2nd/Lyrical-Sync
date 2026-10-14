import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";


export function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18nStore();
  const { _history, _future, _historyInfo, _futureInfo, jumpToHistory } = useLrcStore(
    useShallow((s) => ({
      _history: s._history, _future: s._future, _historyInfo: s._historyInfo, _futureInfo: s._futureInfo, jumpToHistory: s.jumpToHistory,
    }))
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.isComposing) setOpen(false); };
    document.addEventListener("keydown", escape);
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", escape); };
  }, []);

  const disabled = _history.length === 0 && _future.length === 0;
  const currentIndex = _history.length;

  const rows: { index: number; label: string; timestamp: number; isCurrent: boolean }[] = [
    ..._history.map((_, i) => ({
      index: i,
      label: formatLabel(t, _historyInfo[i]?.label ?? "editText", _historyInfo[i]?.count),
      timestamp: _historyInfo[i]?.timestamp ?? 0,
      isCurrent: false,
    })),
    { index: currentIndex, label: t.historyCurrent, timestamp: Date.now(), isCurrent: true },
    ..._future.map((_, i) => ({
      index: currentIndex + 1 + i,
      label: formatLabel(t, _futureInfo[i]?.label ?? "editText", _futureInfo[i]?.count),
      timestamp: _futureInfo[i]?.timestamp ?? 0,
      isCurrent: false,
    })),
  ];
  rows.reverse();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        title={t.historyPanelTitle}
        aria-label={t.historyPanelTitle}
        className="w-6 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span aria-hidden="true">▾</span>
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
  const template = t.historyLabels[label] ?? label;
  return count !== undefined ? template.replace("{count}", String(count)) : template;
}
