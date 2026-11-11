import { useEffect, useId, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore, type RecentFileEntry } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { toast } from "../../stores/useToastStore";
import { DocumentTransitionSaveError } from "../../utils/documentTransition";
import { HistoryIcon } from "./icons";

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function RecentFilesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const triggerId = useId();
  const { t } = useI18nStore();
  const recentFiles = useSettingsStore((s) => s.recentFiles);
  const clearRecentFiles = useSettingsStore((s) => s.clearRecentFiles);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (!open || e.key !== "Escape" || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (recentFiles.length === 0) return null;

  const handleSelect = async (entry: RecentFileEntry) => {
    setOpen(false);
    const st = useLrcStore.getState();

    try {
      await st.requestDocumentTransition({ kind: "recent", entry });
    } catch (error) {
      // Invalid grants require explicit reselection, not an unscoped path retry.
      toast.error(error instanceof DocumentTransitionSaveError ? t.toast.saveFailed : t.toast.openFailed);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={t.recentFiles}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        title={t.recentFiles}
        className="ls-button ls-button--icon w-8 h-8 flex items-center justify-center hover:text-white transition-colors"
      >
        <HistoryIcon />
      </button>
      {open && (
        <div id={panelId} role="group" aria-labelledby={triggerId} className="absolute left-0 top-full mt-1 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-lg shadow-xl z-50 overflow-hidden py-1 min-w-[240px] max-w-[320px]">
          {recentFiles.map((entry, i) => {
            const primary = entry.lrcPath ?? entry.audioPath ?? "";
            const secondary = entry.lrcPath && entry.audioPath ? entry.audioPath : null;
            return (
              <button
                key={`${entry.lrcPath ?? ""}|${entry.audioPath ?? ""}|${i}`}
                onClick={() => handleSelect(entry)}
                className="ls-button w-full flex flex-col items-start text-left transition-colors"
              >
                <span className="text-xs text-[var(--ls-text)] truncate w-full">{basename(primary)}</span>
                {secondary && (
                  <span className="text-[10px] text-[var(--ls-text-secondary)] truncate w-full">{basename(secondary)}</span>
                )}
              </button>
            );
          })}
          <div className="border-t border-[var(--ls-border-subtle)] mt-1 pt-1">
            <button
              onClick={() => { clearRecentFiles(); setOpen(false); }}
              className="ls-button w-full text-left text-[11px] transition-colors"
            >
              {t.clearRecentFiles}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
