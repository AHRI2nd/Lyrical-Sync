import { useEffect } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { normalizeKeybindings, keyLabel } from "../../utils/keybindings";

export function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const kb = normalizeKeybindings(useSettingsStore((s) => s.keybindings));

  const shortcutGroups = [
    {
      title: t.helpGroupPlayback,
      items: [
        { key: keyLabel(kb.skipBack5), desc: t.shortcutDescs.s1 },
        { key: keyLabel(kb.skipBack1), desc: t.shortcutDescs.s2 },
        { key: keyLabel(kb.playPause), desc: t.shortcutDescs.s3 },
        { key: keyLabel(kb.skipFwd1), desc: t.shortcutDescs.s4 },
        { key: keyLabel(kb.skipFwd5), desc: t.shortcutDescs.s5 },
        { key: keyLabel(kb.stop), desc: t.shortcutDescs.s6 },
      ],
    },
    {
      title: t.helpGroupEdit,
      items: [
        { key: keyLabel(kb.stamp), desc: t.shortcutDescs.space },
        { key: keyLabel(kb.prevLine), desc: t.shortcutDescs.backspace },
        { key: "Enter", desc: t.shortcutDescs.enter },
        { key: "⇧ Enter", desc: t.shortcutDescs.splitLine },
        { key: "Ctrl/⌘ Z", desc: t.shortcutDescs.undo },
        { key: "Ctrl/⌘ ⇧ Z", desc: t.shortcutDescs.redo },
        { key: "Ctrl/⌘ F", desc: t.shortcutDescs.find },
      ],
    },
    {
      title: t.helpGroupMouse,
      items: [
        { key: t.shortcutDescs.tsEditKey, desc: t.shortcutDescs.tsEditDesc },
        { key: t.shortcutDescs.tsStampKey, desc: t.shortcutDescs.tsStampDesc },
        { key: t.shortcutDescs.lineClickKey, desc: t.shortcutDescs.lineClickDesc },
        { key: t.shortcutDescs.markerClickKey, desc: t.shortcutDescs.markerClickDesc },
      ],
    },
    {
      title: t.helpGroupCharSync,
      items: [
        { key: keyLabel(kb.stamp), desc: t.shortcutDescs.csStamp },
        { key: "← / →", desc: t.shortcutDescs.csMove },
        { key: t.shortcutDescs.csNudgeKey, desc: t.shortcutDescs.csNudgeDesc },
        { key: t.shortcutDescs.csDragKey, desc: t.shortcutDescs.csDragDesc },
        { key: t.shortcutDescs.csClickKey, desc: t.shortcutDescs.csClickDesc },
        { key: t.shortcutDescs.csClearKey, desc: t.shortcutDescs.csClearDesc },
      ],
    },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.helpTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5">
            {shortcutGroups.map((g) => (
              <div key={g.title}>
                <h3 className="text-xs font-semibold text-zinc-400 mb-2.5">{g.title}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                  {g.items.map(({ key, desc }) => (
                    <div key={key} className="flex items-center gap-3">
                      <kbd className="shrink-0 min-w-[3rem] text-center px-2 py-1 rounded-md bg-zinc-800 border border-zinc-600 text-xs font-mono text-zinc-200 whitespace-nowrap">
                        {key}
                      </kbd>
                      <span className="text-sm text-zinc-300 leading-snug">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-zinc-500 pt-1">{t.shortcutNote}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
