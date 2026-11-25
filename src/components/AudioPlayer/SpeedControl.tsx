import { useEffect, useId, useRef, useState } from "react";
import type { Translations } from "../../i18n/translations";
import { isComposingKeyEvent } from "../../utils/keybindings";

export function SpeedControl({ t, playbackRate, speedMin, speedMax, onSpeedDown, onSpeedUp }: {
  t: Translations; playbackRate: number; speedMin: number; speedMax: number;
  onSpeedDown: () => void; onSpeedUp: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return <div ref={root} className="relative shrink-0" onKeyDown={event => {
    if (open && event.key === "Escape" && !isComposingKeyEvent(event.nativeEvent)) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="ls-button ls-button--secondary tabular-nums" aria-label={`${t.playerSpeed}: ${playbackRate.toFixed(2)}×`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{playbackRate.toFixed(2)}×</button>
    {open && <div id={id} role="group" aria-label={t.playerSpeed} className="absolute right-0 top-full mt-1 z-40 flex items-center gap-2 rounded-md border border-[var(--ls-border-subtle)] bg-[var(--ls-control)] p-2 shadow-xl">
      <button type="button" className="ls-button ls-button--icon" aria-label={t.tooltipSpeedDown} disabled={playbackRate <= speedMin} onClick={onSpeedDown}>−</button>
      <span className="tabular-nums text-sm">{playbackRate.toFixed(2)}×</span>
      <button type="button" className="ls-button ls-button--icon" aria-label={t.tooltipSpeedUp} disabled={playbackRate >= speedMax} onClick={onSpeedUp}>+</button>
    </div>}
  </div>;
}
