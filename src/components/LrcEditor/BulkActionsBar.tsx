import { type Translations } from "../../i18n/translations";

// 다중 선택(Shift/Ctrl·⌘+클릭) 시 나타나는 일괄 작업 툴바.
export function BulkActionsBar({
  t, count, onShiftMinus, onShiftPlus, onClearTs, onDelete, onDeselect,
}: {
  t: Translations;
  count: number;
  onShiftMinus: () => void;
  onShiftPlus: () => void;
  onClearTs: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--ls-control)] border border-sky-700/50 rounded-lg text-xs">
      <span className="text-sky-300 font-medium shrink-0">{count} {t.bulkSelected}</span>
      <div className="w-px h-4 bg-[var(--ls-control)] shrink-0" />
      <span className="text-[var(--ls-text-secondary)] shrink-0">{t.bulkShift}</span>
      <button onClick={onShiftMinus} className="ls-button ls-button--compact transition-colors">−0.1s</button>
      <button onClick={onShiftPlus} className="ls-button ls-button--compact transition-colors">+0.1s</button>
      <div className="w-px h-4 bg-[var(--ls-control)] shrink-0" />
      <button onClick={onClearTs} className="ls-button ls-button--compact transition-colors">{t.bulkClearTs}</button>
      <button onClick={onDelete} className="ls-button ls-button--compact bg-rose-700 hover:bg-rose-600 text-white transition-colors">{t.bulkDelete}</button>
      <button onClick={onDeselect} className="ls-button ls-button--compact ml-auto hover:text-white transition-colors">{t.bulkDeselect}</button>
    </div>
  );
}
