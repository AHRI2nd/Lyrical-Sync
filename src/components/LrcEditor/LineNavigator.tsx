import { memo } from "react";
import type { LrcLine } from "../../types/lrc";
import { isStampable } from "../../utils/lrcParser";

type LineState = "none" | "partial" | "done";

function lineSyncState(line: LrcLine): LineState {
  const syl = line.syllables;
  if (!syl) return "none";
  const stampable = syl.filter(isStampable);
  if (stampable.length === 0) return "none";
  const timed = stampable.filter((s) => s.time !== null).length;
  if (timed === 0) return "none";
  return timed < stampable.length ? "partial" : "done";
}


export const LineNavigator = memo(function LineNavigator({
  lines, activeIdx, onSelect, onPointerSelect, partialClass = "bg-[var(--ls-accent)]",
}: {
  lines: LrcLine[];
  activeIdx: number;
  partialClass?: string;
  onSelect: (id: string) => void;
  onPointerSelect?: () => void;
}) {
  return (
    <div className="flex-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1">
      {lines.map((l, i) => {
        const st = lineSyncState(l);
        const active = i === activeIdx;
        const color =
          st === "done" ? "bg-emerald-500" : st === "partial" ? partialClass : "bg-transparent border border-[var(--ls-border-control)]";
        return (
          <button
            key={l.id}
            aria-pressed={active}
            onClick={event => {
              onSelect(l.id);
              // Keyboard and assistive clicks retain focus for continued button navigation.
              if (event.detail > 0) onPointerSelect?.();
            }}
            title={`${i + 1}. ${l.text}`}
            aria-label={`${i + 1}. ${l.text}`}
            className={`shrink-0 rounded-full transition-all ${color} ${
              active ? "w-2.5 h-2.5 ring-2 ring-[var(--ls-accent)]/60" : `w-2 h-2 ${st === "none" ? "opacity-100" : "opacity-70 hover:opacity-100"}`
            }`}
          />
        );
      })}
    </div>
  );
});
