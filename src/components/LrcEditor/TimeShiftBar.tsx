import { useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { anyModalOpen } from "../../utils/modalGuard";

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

  const clampFrom = (v: number) => Math.max(1, Math.min(v, to));
  const clampTo = (v: number) => Math.max(from, Math.min(v, lineCount));

  const handleApply = () => {
    if (delta === 0) return;
    onApply(from - 1, to - 1, delta); // 0-based 변환
  };

  const step = (d: number) => setDelta((v) => Math.round((v + d) * 1000) / 1000);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229 || anyModalOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (
      e.key === "Enter" && e.target instanceof HTMLInputElement &&
      (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
    ) {
      e.preventDefault();
      handleApply();
    }
  };

  return (
    <div onKeyDown={handleKeyDown} className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-lg text-xs">
      {/* 범위 */}
      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.timeShiftFrom}</span>
      <input
        type="number"
        min={1} max={to}
        value={from}
        onChange={(e) => setFrom(clampFrom(parseInt(e.target.value, 10) || 1))}
        className="ls-field w-14 text-white text-center transition-colors"
      />
      <span className="text-[var(--ls-text-secondary)]">~</span>
      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.timeShiftTo}</span>
      <input
        type="number"
        min={from} max={lineCount}
        value={to}
        onChange={(e) => setTo(clampTo(parseInt(e.target.value, 10) || lineCount))}
        className="ls-field w-14 text-white text-center transition-colors"
      />

      <div className="w-px h-4 bg-[var(--ls-control)] shrink-0" />

      {/* 이동량 */}
      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.timeShiftDelta}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => step(-0.1)} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center transition-colors">−</button>
        <input
          type="number"
          step={0.1}
          value={delta}
          onChange={(e) => setDelta(parseFloat(e.target.value) || 0)}
          className="ls-field w-20 text-white text-center transition-colors"
        />
        <button onClick={() => step(0.1)} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center transition-colors">+</button>
        <span className="text-[var(--ls-text-secondary)]">{t.timeShiftSec}</span>
      </div>

      <div className="w-px h-4 bg-[var(--ls-control)] shrink-0" />

      {/* 적용 / 닫기 */}
      <button
        onClick={handleApply}
        disabled={delta === 0}
        className="ls-button ls-button--compact bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
      >
        {t.timeShiftApply}
      </button>
      <button onClick={onClose} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center hover:text-white transition-colors">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}
