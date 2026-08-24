import { type Translations } from "../../i18n/translations";
import { type BatchOperation } from "../../utils/batchProcessor";

export function BatchOperationPicker({ t, operation, onChange }: {
  t: Translations;
  operation: BatchOperation;
  onChange: (op: BatchOperation) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        <KindBtn active={operation.kind === "offset"} onClick={() => onChange({ kind: "offset", deltaSeconds: 0 })}>
          {t.batchOpOffset}
        </KindBtn>
        <KindBtn active={operation.kind === "convert"} onClick={() => onChange({ kind: "convert", format: "srt" })}>
          {t.batchOpConvert}
        </KindBtn>
        <KindBtn active={operation.kind === "tag"} onClick={() => onChange({ kind: "tag" })}>
          {t.batchOpTag}
        </KindBtn>
      </div>

      {operation.kind === "offset" && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-300">{t.batchOffsetLabel}</span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={String(operation.deltaSeconds)}
              onChange={(e) => onChange({ kind: "offset", deltaSeconds: Number(e.target.value) || 0 })}
              className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs text-right focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <span className="text-[11px] text-zinc-500 w-4">s</span>
          </div>
        </div>
      )}

      {operation.kind === "convert" && (
        <div className="flex gap-1.5">
          {(["srt", "vtt", "ass"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onChange({ kind: "convert", format: fmt })}
              className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                operation.format === fmt
                  ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              .{fmt}
            </button>
          ))}
        </div>
      )}

      {operation.kind === "tag" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-zinc-500">{t.batchTagHint}</p>
          <input
            type="text"
            placeholder={t.metaTitle.placeholder}
            value={operation.title ?? ""}
            onChange={(e) => onChange({ ...operation, title: e.target.value })}
            className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <input
            type="text"
            placeholder={t.metaArtist.placeholder}
            value={operation.artist ?? ""}
            onChange={(e) => onChange({ ...operation, artist: e.target.value })}
            className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <input
            type="text"
            placeholder={t.metaAlbum.placeholder}
            value={operation.album ?? ""}
            onChange={(e) => onChange({ ...operation, album: e.target.value })}
            className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      )}
    </div>
  );
}

function KindBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
        active ? "border-indigo-500 bg-indigo-500/15 text-indigo-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
