import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

    // App Sandbox: 저장된 경로는 재시작 후 접근 권한이 없을 수 있어, 보안 스코프
    // 북마크가 있으면 그걸로 접근 권한을 복원한 실제 경로를 우선 사용(크래시 복구와 동일 패턴).
    let audioPath = entry.audioPath;
    if (entry.audioBookmark) {
      try {
        audioPath = await invoke<string>("resolve_security_bookmark", { bookmark: entry.audioBookmark });
      } catch {
        // 북마크 해석 실패 — 원래 경로로 best-effort 시도
      }
    }
    let lrcPath = entry.lrcPath;
    if (entry.lrcBookmark) {
      try {
        lrcPath = await invoke<string>("resolve_security_bookmark", { bookmark: entry.lrcBookmark });
      } catch {
        // 북마크 해석 실패 — 원래 경로로 best-effort 시도
      }
    }

    if (audioPath) st.setAudioPath(audioPath);
    if (lrcPath) {
      try {
        await st.loadLyricsPath(lrcPath);
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
