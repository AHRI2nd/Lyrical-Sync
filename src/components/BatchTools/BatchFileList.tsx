import type { Translations } from "../../i18n/translations";
import { BATCH_OUTPUT_DURABILITY_UNCERTAIN_CODE, type BatchFileEntry } from "../../utils/batchProcessor";
import { SRT_UNREPRESENTABLE_CONTENT_CODE } from "../../utils/srtConverter";
import { ASS_UNREPRESENTABLE_CONTENT_CODE, VTT_INVALID_SYLLABLE_TIME_CODE, VTT_UNREPRESENTABLE_CONTENT_CODE } from "../../utils/exportFormats";

export function BatchFileList({ t, entries, onRemove, disabled }: {
  t: Translations; entries: BatchFileEntry[]; onRemove: (id: string) => void; disabled: boolean;
}) {
  if (!entries.length) return <p className="py-5 text-center text-xs text-[var(--ls-text-secondary)]">{t.batchNoFiles}</p>;
  const labels: Record<BatchFileEntry["status"], string> = {
    pending: t.batchStatusPending, processing: t.batchStatusProcessing, done: t.batchStatusDone, error: t.batchStatusError, cancelled: t.batchStatusCancelled,
  };
  const fileNames = entries.map((entry) => entry.file.path.split(/[\\/]/).pop() || entry.file.path);
  const fileNameCounts = new Map<string, number>();
  for (const fileName of fileNames) fileNameCounts.set(fileName, (fileNameCounts.get(fileName) ?? 0) + 1);
  const seenFileNames = new Map<string, number>();
  return (
    <ul className="max-h-48 overflow-y-auto rounded-lg border border-[var(--ls-border-subtle)] p-2">
      {entries.map((entry, index) => {
        const fileName = fileNames[index];
        const occurrence = (seenFileNames.get(fileName) ?? 0) + 1;
        seenFileNames.set(fileName, occurrence);
        const accessibleFileName = fileNameCounts.get(fileName)! > 1 ? `${fileName} (${occurrence})` : fileName;
        return (
          <li key={entry.id} className="flex items-center gap-2 px-1 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[var(--ls-text)]" title={entry.file.path}>{fileName}</div>
              {entry.error && <p className="break-words text-red-400">{entry.error === SRT_UNREPRESENTABLE_CONTENT_CODE ? t.toast.srtBlankRowsUnsupported : entry.error === VTT_UNREPRESENTABLE_CONTENT_CODE ? t.toast.vttBlankRowsUnsupported : entry.error === VTT_INVALID_SYLLABLE_TIME_CODE ? t.toast.vttInvalidSyllableTime : entry.error === ASS_UNREPRESENTABLE_CONTENT_CODE ? t.toast.assUnrepresentableContent : entry.error.startsWith(BATCH_OUTPUT_DURABILITY_UNCERTAIN_CODE) ? t.toast.batchOutputDurabilityUncertain : entry.error}</p>}
            </div>
            <span className={entry.status === "error" ? "text-red-400" : entry.status === "done" ? "text-emerald-400" : "text-[var(--ls-text-secondary)]"}>{labels[entry.status]}</span>
            <button type="button" aria-label={`${t.deleteLine}: ${accessibleFileName}`} disabled={disabled} onClick={() => onRemove(entry.id)} className="ls-button hover:text-red-400 disabled:opacity-40">✕</button>
          </li>
        );
      })}
    </ul>
  );
}
