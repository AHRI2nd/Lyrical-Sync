import type { Translations } from "../../i18n/translations";
import type { BatchFileEntry } from "../../utils/batchProcessor";

export function BatchFileList({ t, entries, onRemove, disabled }: {
  t: Translations; entries: BatchFileEntry[]; onRemove: (id: string) => void; disabled: boolean;
}) {
  if (!entries.length) return <p className="py-5 text-center text-xs text-zinc-500">{t.batchNoFiles}</p>;
  const labels: Record<BatchFileEntry["status"], string> = {
    pending: t.batchStatusPending, processing: t.batchStatusProcessing, done: t.batchStatusDone, error: t.batchStatusError, cancelled: t.batchStatusCancelled,
  };
  return (
    <ul className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800 p-2">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center gap-2 px-1 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="truncate text-zinc-200" title={entry.file.path}>{entry.file.path.split(/[\\/]/).pop()}</div>
            {entry.error && <p className="break-words text-red-400">{entry.error}</p>}
          </div>
          <span className={entry.status === "error" ? "text-red-400" : entry.status === "done" ? "text-emerald-400" : "text-zinc-400"}>{labels[entry.status]}</span>
          <button type="button" aria-label={t.deleteLine} disabled={disabled} onClick={() => onRemove(entry.id)} className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-40">✕</button>
        </li>
      ))}
    </ul>
  );
}
