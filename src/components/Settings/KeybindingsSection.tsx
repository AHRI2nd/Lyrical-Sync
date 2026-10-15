import { useEffect, useId, useRef, useState } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import {
  type KeyAction, PLAYBACK_ACTIONS, RESERVED_CODES,
  keyLabel, conflictingAction, normalizeKeybindings,
} from "../../utils/keybindings";

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "MetaLeft", "MetaRight",
  "AltLeft", "AltRight", "ShiftLeft", "ShiftRight",
]);

export function KeybindingsSection({ focusCharacterSync = false }: { focusCharacterSync?: boolean } = {}) {
  const characterHeading = useRef<HTMLHeadingElement>(null);
  const characterHeadingId = useId();
  const { t } = useI18nStore();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const setKeybinding = useSettingsStore((s) => s.setKeybinding);
  const resetKeybindings = useSettingsStore((s) => s.resetKeybindings);
  const kb = normalizeKeybindings(keybindings);

  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!focusCharacterSync) return;
    characterHeading.current?.focus({ preventScroll: true });
    characterHeading.current?.scrollIntoView?.({ block: "start" });
  }, [focusCharacterSync]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      // Capture keys before application and global shortcut handlers.
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") { setCapturing(null); setError(""); return; }
      // Wait for an unmodified key rather than a modifier or chord.
      if (e.ctrlKey || e.metaKey || e.altKey || MODIFIER_CODES.has(e.code)) return;
      if (RESERVED_CODES.has(e.code)) { setError(t.keys.reserved); return; }
      const conflict = conflictingAction(e.code, capturing, kb);
      if (conflict) {
        const label = conflict === "stamp" ? t.charSync.stampHint
          : conflict === "prevLine" ? t.charSync.previousSelection : t.keys[conflict];
        setError(t.keys.conflict.replace("{action}", label));
        return;
      }
      setKeybinding(capturing, e.code);
      setCapturing(null);
      setError("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, kb, setKeybinding, t]);

  const actionLabel = (action: KeyAction) => action === "stamp"
    ? t.charSync.stampHint
    : action === "prevLine" ? t.charSync.previousSelection : t.keys[action];
  const editableRow = (action: KeyAction) => (
    <div key={action} className="flex items-center justify-between gap-3 px-2 py-1 rounded-lg hover:bg-zinc-800/40">
      <span className="text-sm text-zinc-300">{actionLabel(action)}</span>
      <button
        aria-label={`${actionLabel(action)} ${capturing === action ? "…" : keyLabel(kb[action])}`}
        onClick={() => { setCapturing(action); setError(""); }}
        className={`min-w-[64px] px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${
          capturing === action ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        }`}
      >
        {capturing === action ? "…" : keyLabel(kb[action])}
      </button>
    </div>
  );
  const guideRow = (gesture: string, action: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-2 py-1">
      <span className="text-xs text-zinc-400">{action}</span>
      <span className="text-xs text-zinc-300">{gesture}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-200">{t.keys.title}</span>
        <button
          onClick={resetKeybindings}
          className="text-xs text-zinc-400 hover:text-white px-2 py-0.5 rounded hover:bg-zinc-800 transition-colors"
        >
          {t.keys.reset}
        </button>
      </div>
      <p className="text-xs text-zinc-500">{t.keys.hint}</p>
      <section className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium text-zinc-400 px-2">{t.menu.playback}</h3>
        {PLAYBACK_ACTIONS.map(editableRow)}
      </section>
      <section aria-labelledby={characterHeadingId} className="flex flex-col gap-2 border-t border-zinc-700/60 pt-3">
        <h3 ref={characterHeading} id={characterHeadingId} tabIndex={-1}
          className="text-sm font-medium text-zinc-200 rounded focus-visible:outline-2 focus-visible:outline-indigo-400">
          {t.charSync.modeChar}
        </h3>
        <p className="text-xs text-zinc-500">{t.charSync.shortcutSyncHint}</p>
        <div className="flex flex-col gap-0.5">{editableRow("stamp")}{editableRow("prevLine")}</div>
        <h4 className="text-xs font-medium text-zinc-400 mt-1">{t.charSync.fixedShortcuts}</h4>
        <div className="rounded-lg bg-zinc-800/30 py-1">
          {guideRow("← / →", t.charSync.glyphSelection)}
          {guideRow("Shift + ← / →", t.charSync.nudgeShortcut)}
        </div>
        <h4 className="text-xs font-medium text-zinc-400 mt-1">{t.charSync.mouseControls}</h4>
        <div className="rounded-lg bg-zinc-800/30 py-1">
          {guideRow(t.charSync.paintGesture, t.charSync.paintAction)}
          {guideRow(t.charSync.clearGesture, t.charSync.clearAction)}
          {guideRow(t.charSync.seekGesture, t.charSync.seekAction)}
        </div>
      </section>
      {capturing && <p role="status" className="text-xs text-indigo-300">{t.keys.capturing}</p>}
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
