import { useEffect, useState } from "react";
import { useMacroStore } from "../../stores/useMacroStore";
import { useI18nStore } from "../../stores/useI18nStore";

export function MacroManagerModal({ onClose, selectedIds }: { onClose: () => void; selectedIds: string[] }) {
  const { t } = useI18nStore();
  const savedMacros = useMacroStore((s) => s.savedMacros);
  const deleteMacro = useMacroStore((s) => s.deleteMacro);
  const renameMacro = useMacroStore((s) => s.renameMacro);
  const replayMacro = useMacroStore((s) => s.replayMacro);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [replayedId, setReplayedId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const commitRename = (id: string, fallback: string) => {
    renameMacro(id, editName.trim() || fallback);
    setEditingId(null);
  };

  const handleReplay = (id: string) => {
    replayMacro(id, selectedIds);
    setReplayedId(id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100 text-sm">{t.macroManagerTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <p className="text-[11px] leading-relaxed text-zinc-500">{t.macroManagerHint}</p>

          {savedMacros.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-6">{t.macroNoMacros}</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {savedMacros.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-zinc-800/60">
                  {editingId === m.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRename(m.id, m.name); if (e.key === "Escape") setEditingId(null); }}
                      onBlur={() => commitRename(m.id, m.name)}
                      className="flex-1 min-w-0 px-2 py-1 bg-zinc-900 border border-indigo-500 rounded text-xs text-white focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingId(m.id); setEditName(m.name); }}
                      className="flex-1 min-w-0 text-left text-xs text-zinc-200 truncate hover:text-indigo-300 transition-colors"
                      title={t.macroRename}
                    >
                      {m.name} <span className="text-zinc-600">({m.steps.length})</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleReplay(m.id)}
                    className="shrink-0 px-2 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    {t.macroReplay}
                  </button>
                  <button
                    onClick={() => deleteMacro(m.id)}
                    className="shrink-0 text-zinc-600 hover:text-rose-400 px-1 transition-colors"
                    aria-label={t.deleteLine}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {replayedId && <p className="text-xs text-emerald-400">{t.macroReplayed}</p>}

          <div className="border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
            {selectedIds.length > 0 ? `${t.bpmScopeSelected} (${selectedIds.length})` : t.bpmScopeAll}
          </div>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              {t.autoSpotCancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
