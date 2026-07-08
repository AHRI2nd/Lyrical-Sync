import { useEffect, useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";

export function TimeShiftBar({
  lineCount, defaultFrom, onApply, onClose,
}: {
  lineCount: number;
  defaultFrom: number; // 1-based
  onApply: (fromIdx: number, toIdx: number, delta: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18nStore();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(lineCount);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleApply();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, from, to, delta]);

  const clampFrom = (v: number) => Math.max(1, Math.min(v, to));
  const clampTo = (v: number) => Math.max(from, Math.min(v, lineCount));

  const handleApply = () => {
    if (delta === 0) return;
    onApply(from - 1, to - 1, delta); // 0-based 변환
  };

  const step = (d: number) => setDelta((v) => Math.round((v + d) * 1000) / 1000);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs">
      {/* 범위 */}
      <span className="text-zinc-400 shrink-0">{t.timeShiftFrom}</span>
      <input
        type="number"
        min={1} max={to}
        value={from}
        onChange={(e) => setFrom(clampFrom(parseInt(e.target.value, 10) || 1))}
        className="w-14 px-2 py-1 bg-zinc-900 border border-zinc-600 rounded-lg text-white text-center focus:outline-none focus:border-sky-500 transition-colors"
      />
      <span className="text-zinc-500">~</span>
      <span className="text-zinc-400 shrink-0">{t.timeShiftTo}</span>
      <input
        type="number"
        min={from} max={lineCount}
        value={to}
        onChange={(e) => setTo(clampTo(parseInt(e.target.value, 10) || lineCount))}
        className="w-14 px-2 py-1 bg-zinc-900 border border-zinc-600 rounded-lg text-white text-center focus:outline-none focus:border-sky-500 transition-colors"
      />

      <div className="w-px h-4 bg-zinc-700 shrink-0" />

      {/* 이동량 */}
      <span className="text-zinc-400 shrink-0">{t.timeShiftDelta}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => step(-0.1)} className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">−</button>
        <input
          type="number"
          step={0.1}
          value={delta}
          onChange={(e) => setDelta(parseFloat(e.target.value) || 0)}
          className="w-20 px-2 py-1 bg-zinc-900 border border-zinc-600 rounded-lg text-white text-center focus:outline-none focus:border-sky-500 transition-colors"
        />
        <button onClick={() => step(0.1)} className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">+</button>
        <span className="text-zinc-500">{t.timeShiftSec}</span>
      </div>

      <div className="w-px h-4 bg-zinc-700 shrink-0" />

      {/* 적용 / 닫기 */}
      <button
        onClick={handleApply}
        disabled={delta === 0}
        className="px-3 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
      >
        {t.timeShiftApply}
      </button>
      <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}
