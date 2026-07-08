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
    <div className="flex flex-col gap-1.5 px-2 py-2 bg-zinc-800 border border-zinc-700 rounded-lg">
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
          className="flex-1 min-w-0 px-2.5 py-1 text-sm bg-zinc-900 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
        />
        {/* 대소문자 구분 */}
        <div className="relative group/aa">
          <button
            onClick={onCaseSensitiveToggle}
            className={`px-2 py-1 text-xs rounded-lg font-mono transition-colors ${
              caseSensitive
                ? "bg-amber-600 text-white"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            Aa
          </button>
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/aa:block z-30">
            <div className="bg-zinc-800 border border-zinc-600 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
              {t.caseSensitive}
            </div>
          </div>
        </div>
        {/* 결과 카운트 */}
        <span className={`text-xs font-mono w-14 text-right shrink-0 ${matchCount === 0 && findText ? "text-red-400" : "text-zinc-400"}`}>
          {countLabel}
        </span>
        {/* 이전/다음 */}
        <button onClick={onPrev} disabled={matchCount === 0} className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors" title="이전 (Shift+Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button onClick={onNext} disabled={matchCount === 0} className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors" title="다음 (Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {/* 닫기 */}
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors">
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
          className="flex-1 min-w-0 px-2.5 py-1 text-sm bg-zinc-900 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
        />
        <button
          onClick={onReplace}
          disabled={matchCount === 0}
          className="shrink-0 px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-40 transition-colors"
        >
          {t.replaceBtn}
        </button>
        <button
          onClick={onReplaceAll}
          disabled={matchCount === 0}
          className="shrink-0 px-3 py-1 text-xs rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40 transition-colors"
        >
          {t.replaceAll}
        </button>
      </div>
    </div>
  );
}
