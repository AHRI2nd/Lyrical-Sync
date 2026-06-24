import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import {
  type KeyAction, KEY_ACTIONS, RESERVED_CODES,
  keyLabel, conflictingAction, normalizeKeybindings,
} from "../../utils/keybindings";

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "MetaLeft", "MetaRight",
  "AltLeft", "AltRight", "ShiftLeft", "ShiftRight",
]);

export function KeybindingsSection() {
  const { t } = useI18nStore();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const setKeybinding = useSettingsStore((s) => s.setKeybinding);
  const resetKeybindings = useSettingsStore((s) => s.resetKeybindings);
  const kb = normalizeKeybindings(keybindings);

  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      // 캡처 중엔 모든 키를 가로채 앱 동작/전역 단축키를 막음
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") { setCapturing(null); setError(""); return; }
      // 수식자 단독/조합은 무시(평키만 대기)
      if (e.ctrlKey || e.metaKey || e.altKey || MODIFIER_CODES.has(e.code)) return;
      if (RESERVED_CODES.has(e.code)) { setError(t.keys.reserved); return; }
      const conflict = conflictingAction(e.code, capturing, kb);
      if (conflict) { setError(t.keys.conflict.replace("{action}", t.keys[conflict])); return; }
      setKeybinding(capturing, e.code);
      setCapturing(null);
      setError("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, kb, setKeybinding, t]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{t.keys.title}</span>
        <button
          onClick={resetKeybindings}
          className="text-xs text-zinc-400 hover:text-white px-2 py-0.5 rounded hover:bg-zinc-800 transition-colors"
        >
          {t.keys.reset}
        </button>
      </div>
      <p className="text-xs text-zinc-500">{t.keys.hint}</p>
      <div className="flex flex-col gap-0.5 mt-1">
        {KEY_ACTIONS.map((a) => (
          <div key={a} className="flex items-center justify-between gap-3 px-2 py-1 rounded-lg hover:bg-zinc-800/40">
            <span className="text-sm text-zinc-300">{t.keys[a]}</span>
            <button
              onClick={() => { setCapturing(a); setError(""); }}
              className={`min-w-[64px] px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${
                capturing === a
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {capturing === a ? "…" : keyLabel(kb[a])}
            </button>
          </div>
        ))}
      </div>
      {capturing && <p className="text-xs text-indigo-300">{t.keys.capturing}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
