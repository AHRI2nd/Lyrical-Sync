import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { isComposingKeyEvent } from "../../utils/keybindings";
import type { LrcDocument } from "../../types/lrc";

type Snapshot = { doc: LrcDocument; session: number; audio: number; lineId: string };
function isCurrent(snapshot: Snapshot) {
  const state = useLrcStore.getState();
  return state.doc === snapshot.doc && state._documentSession === snapshot.session &&
    state._audioSelection === snapshot.audio && state.activeLineId === snapshot.lineId;
}

export function ClearGlyphTimings({ lineId }: { lineId: string }) {
  const { t } = useI18nStore();
  const context = useLrcStore(useShallow(s => ({ doc: s.doc, session: s._documentSession, audio: s._audioSelection, active: s.activeLineId })));
  const [pending, setPending] = useState<Snapshot | null>(null);
  const [cleared, setCleared] = useState<Snapshot | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const restoreAfterUndo = useRef(false);
  const titleId = useId();
  const messageId = useId();
  const count = context.doc.lines.find(line => line.id === lineId)?.syllables?.filter(s => s.time !== null).length ?? 0;
  const confirming = pending !== null && pending.lineId === lineId && isCurrent(pending);
  const canUndo = cleared !== null && cleared.lineId === lineId && isCurrent(cleared);

  useEffect(() => {
    if (pending && !isCurrent(pending)) setPending(null);
    if (cleared && !isCurrent(cleared)) setCleared(null);
  }, [context, pending, cleared]);
  useEffect(() => {
    if (!cleared) return;
    const timer = window.setTimeout(() => setCleared(null), 7000);
    return () => window.clearTimeout(timer);
  }, [cleared]);
  useLayoutEffect(() => {
    if (!confirming) return;
    cancel.current?.focus();
    const button = trigger.current;
    return () => { if (button?.isConnected) button.focus({ preventScroll: true }); };
  }, [confirming]);

  useLayoutEffect(() => {
    if (cleared && isCurrent(cleared)) undoButton.current?.focus({ preventScroll: true });
    else if (restoreAfterUndo.current) {
      trigger.current?.focus({ preventScroll: true });
      restoreAfterUndo.current = false;
    }
  }, [cleared]);

  const clear = () => {
    if (!pending || !isCurrent(pending)) { setPending(null); return; }
    useLrcStore.getState().clearLineSyllables(lineId);
    const doc = useLrcStore.getState().doc;
    setCleared({ ...pending, doc });
    setPending(null);
  };
  return <div className="flex flex-wrap items-center gap-2 min-w-0">
    <button ref={trigger} type="button" disabled={!count} onClick={() => setPending({ doc: context.doc, session: context.session, audio: context.audio, lineId })}
      className="ls-button text-xs disabled:opacity-40 disabled:cursor-default">
      {t.charSync.clearTimingButton}
    </button>
    {canUndo && <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-[var(--ls-text-secondary)]">
      <span>{t.charSync.clearTimingDone}</span>
      <button ref={undoButton} type="button" className="ls-button text-[var(--ls-accent)] underline underline-offset-2" onClick={() => {
        if (cleared && isCurrent(cleared) && useLrcStore.getState()._history.length) {
          restoreAfterUndo.current = true;
          useLrcStore.getState().undo();
        }
        setCleared(null);
      }}>{t.charSync.undoClear}</button>
    </div>}
    {confirming && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPending(null)}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        className="w-full max-w-md mx-4 rounded-xl border border-[var(--ls-border-subtle)] bg-[var(--ls-surface)] p-5 shadow-2xl" onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (isComposingKeyEvent(e.nativeEvent)) return;
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPending(null); }
          if (e.key === "Tab") {
            const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}>
        <h2 id={titleId} className="font-semibold text-[var(--ls-text)]">{t.charSync.clearTimingTitle}</h2>
        <p id={messageId} className="mt-3 text-sm text-[var(--ls-text-secondary)]">{t.charSync.clearTimingMessage.replace("{count}", String(count))}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancel} type="button" onClick={() => setPending(null)} className="ls-button text-sm">{t.cancelLabel}</button>
          <button type="button" onClick={clear} className="ls-button bg-rose-600 text-sm text-white hover:bg-rose-500">{t.charSync.clearTimingConfirm}</button>
        </div>
      </div>
    </div>, document.body)}
  </div>;
}
