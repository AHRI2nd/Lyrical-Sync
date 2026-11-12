import { useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { anyModalOpen } from "../../utils/modalGuard";

export function ScaleBar({ onApply, onClose }: { onApply: (factor: number) => void; onClose: () => void }) {
  const { t } = useI18nStore();
  const [factorInput, setFactorInput] = useState("1");
  const factor = factorInput.trim() === "" ? NaN : Number(factorInput);
  const canApply = Number.isFinite(factor) && factor >= 0.1 && factor !== 1;

  const stepFactor = (delta: number) => setFactorInput((value) => {
    const current = Number(value);
    return String(Math.max(0.1, Math.round(((Number.isFinite(current) ? current : 1) + delta) * 1000) / 1000));
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229 || anyModalOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (
      e.key === "Enter" && e.target instanceof HTMLInputElement &&
      !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && canApply
    ) {
      e.preventDefault();
      onApply(factor);
    }
  };

  return (
    <div onKeyDown={handleKeyDown} className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-lg text-xs">
      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.tsScaleFactor}</span>
      <div className="flex items-center gap-1">
        <button aria-label={`${t.tsScaleFactor} -0.01`} onClick={() => stepFactor(-0.01)} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center transition-colors">−</button>
        <input
          type="number"
          aria-label={t.tsScaleFactor}
          step={0.01}
          min={0.1}
          value={factorInput}
          onChange={(e) => setFactorInput(e.target.value)}
          className="ls-field w-20 text-white text-center transition-colors"
        />
        <button aria-label={`${t.tsScaleFactor} +0.01`} onClick={() => stepFactor(0.01)} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center transition-colors">+</button>
        <span className="text-[var(--ls-text-secondary)]">×</span>
      </div>

      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.tsScaleHint}</span>

      <div className="w-px h-4 bg-[var(--ls-control)] shrink-0" />

      <button
        onClick={() => onApply(factor)}
        disabled={!canApply}
        className="ls-button ls-button--compact bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
      >
        {t.timeShiftApply}
      </button>
      <button type="button" aria-label={t.close} onClick={onClose} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center hover:text-white transition-colors">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}
