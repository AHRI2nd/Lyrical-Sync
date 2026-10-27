import { useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { anyModalOpen } from "../../utils/modalGuard";

export function ScaleBar({ onApply, onClose }: { onApply: (factor: number) => void; onClose: () => void }) {
  const { t } = useI18nStore();
  const [factor, setFactor] = useState(1.0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229 || anyModalOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (
      e.key === "Enter" && e.target instanceof HTMLInputElement &&
      !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && factor > 0 && factor !== 1
    ) {
      e.preventDefault();
      onApply(factor);
    }
  };

  return (
    <div onKeyDown={handleKeyDown} className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-lg text-xs">
      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.tsScaleFactor}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => setFactor((v) => Math.max(0.1, Math.round((v - 0.01) * 1000) / 1000))} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center transition-colors">−</button>
        <input
          type="number"
          step={0.01}
          min={0.1}
          value={factor}
          onChange={(e) => setFactor(Math.max(0.1, parseFloat(e.target.value) || 1))}
          className="ls-field w-20 text-white text-center transition-colors"
        />
        <button onClick={() => setFactor((v) => Math.round((v + 0.01) * 1000) / 1000)} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center transition-colors">+</button>
        <span className="text-[var(--ls-text-secondary)]">×</span>
      </div>

      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.tsScaleHint}</span>

      <div className="w-px h-4 bg-[var(--ls-control)] shrink-0" />

      <button
        onClick={() => onApply(factor)}
        disabled={!(factor > 0) || factor === 1}
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
