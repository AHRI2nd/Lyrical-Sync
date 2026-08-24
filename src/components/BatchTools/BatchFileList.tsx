import { type Translations } from "../../i18n/translations";
import { type BatchFileEntry } from "../../utils/batchProcessor";

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

const STATUS_STYLE: Record<BatchFileEntry["status"], string> = {
  pending: "text-zinc-500",
  processing: "text-indigo-300",
  done: "text-emerald-400",
  error: "text-red-400",
};

export function BatchFileList({ t, entries, onRemove }: {
  t: Translations;
  entries: BatchFileEntry[];
  onRemove: (index: number) => void;
}) {
  if (entries.length === 0) {
    return <p className="text-xs text-zinc-500 text-center py-6">{t.batchNoFiles}</p>;
  }

  return (
    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto border border-zinc-800 rounded-lg p-1.5">
      {entries.map((entry, i) => (
        <div key={entry.lrcPath} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800/60 text-xs">
          <div className="flex-1 min-w-0">
            <div className="text-zinc-200 truncate">{basename(entry.lrcPath)}</div>
            <div className="text-zinc-600 truncate">
              {entry.audioPath ? basename(entry.audioPath) : t.batchNoAudioMatch}
            </div>
          </div>
          <span className={`shrink-0 w-16 text-right ${STATUS_STYLE[entry.status]}`}>
            {entry.status === "pending" ? t.batchStatusPending
              : entry.status === "processing" ? t.batchStatusProcessing
              : entry.status === "done" ? t.batchStatusDone
              : t.batchStatusError}
          </span>
          {entry.status === "pending" && (
            <button
              onClick={() => onRemove(i)}
              className="shrink-0 text-zinc-600 hover:text-rose-400 transition-colors"
              aria-label={t.deleteLine}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
