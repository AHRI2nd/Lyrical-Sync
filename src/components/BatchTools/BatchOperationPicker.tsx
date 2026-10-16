import type { Translations } from "../../i18n/translations";
import type { BatchOperation } from "../../utils/batchProcessor";

export function BatchOperationPicker({ t, operation, onChange, disabled }: {
  t: Translations; operation: BatchOperation; onChange: (operation: BatchOperation) => void; disabled: boolean;
}) {
  const buttonClass = "flex-1 rounded-lg border border-[var(--ls-border-subtle)] px-3 py-2 text-xs text-[var(--ls-text-secondary)] hover:bg-[var(--ls-control)] disabled:opacity-40";
  const inputClass = "rounded-lg border border-[var(--ls-border-subtle)] bg-[var(--ls-control)] px-2.5 py-1.5 text-xs text-white disabled:opacity-40";
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" aria-pressed={operation.kind === "offset"} className={`ls-button ${buttonClass}`} onClick={() => onChange({ kind: "offset", deltaSeconds: 0 })}>{t.batchOpOffset}</button>
        <button type="button" aria-pressed={operation.kind === "convert"} className={`ls-button ${buttonClass}`} onClick={() => onChange({ kind: "convert", format: "srt" })}>{t.batchOpConvert}</button>
        <button type="button" aria-pressed={operation.kind === "tag"} className={`ls-button ${buttonClass}`} onClick={() => onChange({ kind: "tag" })}>{t.batchOpTag}</button>
      </div>
      {operation.kind === "offset" && (
        <label className="flex items-center justify-between gap-3 text-xs text-[var(--ls-text-secondary)]">
          {t.batchOffsetLabel}
          <input aria-label={t.batchOffsetLabel} type="number" step="0.01" className={`ls-field ${`${inputClass} w-24 text-right`}`} value={Number.isFinite(operation.deltaSeconds) ? operation.deltaSeconds : ""} onChange={(event) => onChange({ kind: "offset", deltaSeconds: event.target.valueAsNumber })} />
        </label>
      )}
      {operation.kind === "convert" && (
        <div className="flex gap-2">
          {(["srt", "vtt", "ass"] as const).map((format) => <button key={format} type="button" aria-pressed={operation.format === format} className={`ls-button ${buttonClass}`} onClick={() => onChange({ kind: "convert", format })}>.{format}</button>)}
        </div>
      )}
      {operation.kind === "tag" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-[var(--ls-text-secondary)]">{t.batchTagHint}</p>
          {(["title", "artist", "album"] as const).map((field) => {
            const placeholder = field === "title" ? t.metaTitle.placeholder : field === "artist" ? t.metaArtist.placeholder : t.metaAlbum.placeholder;
            return <input key={field} type="text" aria-label={placeholder} placeholder={placeholder} className={`ls-field ${inputClass}`} value={operation[field] ?? ""} onChange={(event) => onChange({ ...operation, [field]: event.target.value })} />;
          })}
        </div>
      )}
    </fieldset>
  );
}
