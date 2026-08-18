import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore, type RecentFileEntry } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { toast } from "../../stores/useToastStore";
import { HistoryIcon } from "./icons";

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function RecentFilesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18nStore();
  const recentFiles = useSettingsStore((s) => s.recentFiles);
  const clearRecentFiles = useSettingsStore((s) => s.clearRecentFiles);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (recentFiles.length === 0) return null;

  const handleSelect = async (entry: RecentFileEntry) => {
    setOpen(false);
    const st = useLrcStore.getState();
    if (entry.audioPath) st.setAudioPath(entry.audioPath);
    if (entry.lrcPath) {
      try {
        await st.loadLyricsPath(entry.lrcPath);
      } catch {
        toast.error(t.toast.openFailed);
      }
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t.recentFiles}
        aria-label={t.recentFiles}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
      >
        <HistoryIcon />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden py-1 min-w-[240px] max-w-[320px]">
          {recentFiles.map((entry, i) => {
            const primary = entry.lrcPath ?? entry.audioPath ?? "";
            const secondary = entry.lrcPath && entry.audioPath ? entry.audioPath : null;
            return (
              <button
                key={`${entry.lrcPath ?? ""}|${entry.audioPath ?? ""}|${i}`}
                onClick={() => handleSelect(entry)}
                className="w-full flex flex-col items-start px-3 py-1.5 text-left hover:bg-zinc-700 transition-colors"
              >
                <span className="text-xs text-zinc-100 truncate w-full">{basename(primary)}</span>
                {secondary && (
                  <span className="text-[10px] text-zinc-500 truncate w-full">{basename(secondary)}</span>
                )}
              </button>
            );
          })}
          <div className="border-t border-zinc-700 mt-1 pt-1">
            <button
              onClick={() => { clearRecentFiles(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
            >
              {t.clearRecentFiles}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
