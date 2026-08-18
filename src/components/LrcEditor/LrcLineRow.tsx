import { type LrcLine } from "../../types/lrc";
import { type Translations } from "../../i18n/translations";
import { formatDisplayTime } from "../../utils/lrcParser";
import { LoopIcon } from "../AudioPlayer/icons";

// LrcEditor 줄 하나의 렌더링: 드래그 재정렬 핸들·순번·타임스탬프(인라인 편집)·줄 반복
// 토글·글자 동기화 배지·경고 아이콘·텍스트 입력·병합/복제/삭제 버튼.
// 상호작용 상태(드래그·타임스탬프 편집 등)는 LrcEditor가 소유하고 이벤트 핸들러로 전달 —
// 이 컴포넌트는 순수 렌더링(+ line 자체에서 파생되는 hasGlyphSync/tsClass만 내부 계산).
export function LrcLineRow({
  t, line, idx, isActive, isSelected, confidence, isMatch, isCurrentMatch, warning,
  loopLineId, lyricsFontScale,
  dragIdx, dragOverIdx, onDragStart, onDragEnd, onDragOver, onDrop,
  editingTsId, editTsValue, onEditTsChange, onStartTsEdit, onCommitTsEdit, onCancelTsEdit, onStampCurrentLine,
  onRowClick, onToggleLoop, onTextChange, onKeyDown, onPaste, onFocus,
  onMergeUp, onDuplicate, onDelete,
  inputRef, rowRef,
}: {
  t: Translations;
  line: LrcLine;
  idx: number;
  isActive: boolean;
  isSelected: boolean;
  confidence: number | undefined;
  isMatch: boolean;
  isCurrentMatch: boolean;
  warning: "duplicate" | "outOfOrder" | undefined;
  loopLineId: string | null;
  lyricsFontScale: number;

  dragIdx: number | null;
  dragOverIdx: number | null;
  onDragStart: (e: React.DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  editingTsId: string | null;
  editTsValue: string;
  onEditTsChange: (v: string) => void;
  onStartTsEdit: () => void;
  onCommitTsEdit: () => void;
  onCancelTsEdit: () => void;
  onStampCurrentLine: () => void;

  onRowClick: (e: React.MouseEvent) => void;
  onToggleLoop: (e: React.MouseEvent) => void;
  onTextChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onMergeUp: (e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;

  inputRef: (el: HTMLInputElement | null) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const hasGlyphSync = !!line.syllables?.some((s) => s.time !== null);

  // Timestamp button colour varies by AI confidence
  const tsClass = confidence !== undefined
    ? confidence >= 0.7
      ? "bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
      : confidence >= 0.5
      ? "bg-yellow-900/50 text-yellow-300 hover:bg-yellow-800/60"
      : "bg-red-900/50 text-red-300 hover:bg-red-800/60"
    : line.timestamp !== null
    ? "bg-zinc-700 text-indigo-300 hover:bg-zinc-600"
    : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300";

  return (
    <div
      ref={rowRef}
      onClick={onRowClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group/row flex items-center gap-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${
        dragIdx !== null && dragOverIdx === idx && dragIdx !== idx
          ? "outline outline-1 outline-indigo-400 bg-indigo-900/10"
          : isSelected
          ? "bg-sky-900/30 ring-1 ring-sky-600/60"
          : isCurrentMatch
          ? "bg-amber-900/30 ring-1 ring-amber-500"
          : isActive
          ? "bg-indigo-900/40 ring-1 ring-indigo-500"
          : isMatch
          ? "bg-amber-900/10 ring-1 ring-amber-800"
          : "hover:bg-zinc-800"
      } ${dragIdx === idx ? "opacity-40" : ""}`}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => e.stopPropagation()}
        title={t.reorderLine}
        className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/row:opacity-100 transition-opacity"
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
          <circle cx="2.5" cy="2" r="1.2" /><circle cx="7.5" cy="2" r="1.2" />
          <circle cx="2.5" cy="7" r="1.2" /><circle cx="7.5" cy="7" r="1.2" />
          <circle cx="2.5" cy="12" r="1.2" /><circle cx="7.5" cy="12" r="1.2" />
        </svg>
      </span>
      <span className="text-zinc-600 text-xs w-5 shrink-0 text-right select-none">
        {idx + 1}
      </span>

      <div className="shrink-0">
        {editingTsId === line.id ? (
          // 좌클릭 시 인라인 편집: 숫자키로 MM:SS.xx 직접 입력
          <input
            autoFocus
            type="text"
            value={editTsValue}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onEditTsChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommitTsEdit(); }
              else if (e.key === "Escape") { e.preventDefault(); onCancelTsEdit(); }
            }}
            onBlur={onCommitTsEdit}
            placeholder="MM:SS.xx"
            className="font-mono text-xs px-2 py-0.5 rounded w-24 bg-zinc-700 text-indigo-200 border border-indigo-500 focus:outline-none placeholder-zinc-500"
          />
        ) : (
          // 좌클릭 → 시간 직접 편집 / 우클릭 → 현재 재생 시간으로 설정
          <button
            onClick={(e) => { e.stopPropagation(); onStartTsEdit(); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onStampCurrentLine(); }}
            className={`font-mono text-xs px-2 py-0.5 rounded transition-colors ${tsClass}`}
          >
            {line.timestamp !== null ? formatDisplayTime(line.timestamp) : "-:--:--.---"}
          </button>
        )}
      </div>

      <button
        onClick={onToggleLoop}
        disabled={line.timestamp === null}
        title={t.loopLine}
        aria-label={t.loopLine}
        aria-pressed={loopLineId === line.id}
        className={`shrink-0 px-1 transition-opacity disabled:opacity-0 ${
          loopLineId === line.id
            ? "text-indigo-400 opacity-100"
            : "text-zinc-600 hover:text-indigo-300 opacity-0 group-hover/row:opacity-100 focus:opacity-100"
        }`}
      >
        <LoopIcon size={12} />
      </button>

      {hasGlyphSync && (
        <span
          title={t.charSync.badge}
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded bg-indigo-500/15 text-indigo-300"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M5 8v8M12 5v14M19 8v8" />
          </svg>
        </span>
      )}

      {warning && (
        <div className="relative group/warn shrink-0">
          <span className="text-amber-400 text-sm leading-none cursor-help">⚠</span>
          <div className={`pointer-events-none absolute left-0 hidden group-hover/warn:block z-30 ${idx < 2 ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}>
            <div className="bg-zinc-800 border border-amber-700/60 text-amber-200 text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
              {warning === "duplicate" ? t.warnDuplicate : t.warnOutOfOrder}
            </div>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={line.text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onPaste={onPaste}
        className="flex-1 bg-transparent text-white text-sm placeholder-zinc-600 focus:outline-none"
        style={{ fontSize: `${0.875 * lyricsFontScale}rem` }}
        placeholder={t.linePlaceholder}
      />

      <button
        onClick={onMergeUp}
        disabled={idx === 0}
        className="shrink-0 text-zinc-600 hover:text-indigo-300 px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-0"
        title={t.mergeLineUp}
        aria-label={t.mergeLineUp}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 7l4-4 4 4" /><path d="M12 3v8" /><path d="M5 21h14" /><path d="M5 15h14" />
        </svg>
      </button>
      <button
        onClick={onDuplicate}
        className="shrink-0 text-zinc-600 hover:text-indigo-300 px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
        title={t.duplicateLine}
        aria-label={t.duplicateLine}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
      <button
        onClick={onDelete}
        className="shrink-0 text-zinc-600 hover:text-rose-400 text-sm px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
        title={t.deleteLine}
        aria-label={t.deleteLine}
      >
        ✕
      </button>
    </div>
  );
}
