import { useEffect } from "react";
import { useI18nStore } from "../../stores/useI18nStore";

export function FindReplaceBar({
  findText, replaceText, caseSensitive,
  matchCount, matchPos,
  onFindChange, onReplaceChange, onCaseSensitiveToggle,
  onPrev, onNext, onReplace, onReplaceAll, onClose,
  findInputRef,
}: {
  findText: string; replaceText: string; caseSensitive: boolean;
  matchCount: number; matchPos: number;
  onFindChange: (v: string) => void; onReplaceChange: (v: string) => void;
  onCaseSensitiveToggle: () => void;
  onPrev: () => void; onNext: () => void;
  onReplace: () => void; onReplaceAll: () => void; onClose: () => void;
  findInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18nStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const countLabel = findText
    ? matchCount === 0
      ? t.noMatches
      : `${matchPos + 1} / ${matchCount}`
    : "";

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-lg">
      {/* 찾기 행 */}
      <div className="flex items-center gap-1.5">
        <input
          ref={findInputRef}
          type="text"
          value={findText}
          onChange={(e) => onFindChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
          }}
          placeholder={t.findPlaceholder}
          className="ls-field flex-1 min-w-0 text-sm text-white transition-colors"
        />
        {/* 대소문자 구분 */}
        <div className="relative group/aa">
          <button
            onClick={onCaseSensitiveToggle}
            className={`ls-button ls-button--compact ${`  text-xs rounded-lg font-mono transition-colors ${
              caseSensitive
                ? "bg-[var(--ls-playhead)] text-[var(--ls-canvas)]"
                : "bg-[var(--ls-control)] hover:bg-[var(--ls-control)] text-[var(--ls-text-secondary)]"
            }`}`}
          >
            Aa
          </button>
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/aa:block z-30">
            <div className="bg-[var(--ls-control)] border border-[var(--ls-border-control)] text-[var(--ls-text)] text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
              {t.caseSensitive}
            </div>
          </div>
        </div>
        {/* 결과 카운트 */}
        <span className={`text-xs font-mono w-14 text-right shrink-0 ${matchCount === 0 && findText ? "text-red-400" : "text-[var(--ls-text-secondary)]"}`}>
          {countLabel}
        </span>
        {/* 이전/다음 */}
        <button onClick={onPrev} disabled={matchCount === 0} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center hover:text-white disabled:opacity-30 transition-colors" title="이전 (Shift+Enter)" aria-label="이전 (Shift+Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button onClick={onNext} disabled={matchCount === 0} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center hover:text-white disabled:opacity-30 transition-colors" title="다음 (Enter)" aria-label="다음 (Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {/* 닫기 */}
        <button onClick={onClose} className="ls-button ls-button--compact w-6 h-6 flex items-center justify-center hover:text-white transition-colors">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {/* 바꾸기 행 */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={replaceText}
          onChange={(e) => onReplaceChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onReplace(); } }}
          placeholder={t.replacePlaceholder}
          className="ls-field flex-1 min-w-0 text-sm text-white transition-colors"
        />
        <button
          onClick={onReplace}
          disabled={matchCount === 0}
          className="ls-button ls-button--compact shrink-0 text-xs disabled:opacity-40 transition-colors"
        >
          {t.replaceBtn}
        </button>
        <button
          onClick={onReplaceAll}
          disabled={matchCount === 0}
          className="ls-button ls-button--compact shrink-0 text-xs bg-[var(--ls-playhead)] hover:bg-[var(--ls-playhead)] text-[var(--ls-canvas)] disabled:opacity-40 transition-colors"
        >
          {t.replaceAll}
        </button>
      </div>
    </div>
  );
}
