import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18nStore } from "../../stores/useI18nStore";
import { safeUnlisten } from "../../utils/safeUnlisten";

interface PythonEnvInfo {
  pythonReady: boolean;
  packagesReady: boolean;
  pipInstallCmd: string;
  pythonPath: string;
}

export function PythonEnvSection() {
  const { t } = useI18nStore();
  const [info, setInfo] = useState<PythonEnvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [dlPercent, setDlPercent] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const v = await invoke<PythonEnvInfo>("get_python_env_info");
      setInfo(v);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  // Clear stale install error once packages are confirmed ready (handles the
  // case where pip exits with non-zero on Windows but packages are installed).
  useEffect(() => {
    if (info?.packagesReady) {
      setInstallError(null);
    }
  }, [info]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ percent: number; done: boolean }>("python-download-progress", (e) => {
      setDlPercent(e.payload.percent);
      if (e.payload.done) {
        setDownloading(false);
        refresh();
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { safeUnlisten(unlisten); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ line: string; done: boolean; success: boolean }>("pip-install-progress", (e) => {
      if (e.payload.done) {
        setInstalling(false);
        refresh();
      } else if (e.payload.line) {
        setInstallLog((prev) => [...prev, e.payload.line]);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { safeUnlisten(unlisten); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog]);

  const handleDownload = async () => {
    setDownloading(true);
    setDlPercent(0);
    setInstallLog([]);
    setInstallError(null);
    try {
      await invoke("download_embedded_python");
    } catch (e) {
      setDownloading(false);
      setInstallError(String(e));
    } finally {
      setDownloading(false);
      await refresh();
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setInstallLog([]);
    setInstallError(null);
    try {
      await invoke("install_python_packages");
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
      await refresh();
    }
  };

  const statusColor = loading ? "text-[var(--ls-text-secondary)]"
    : info?.packagesReady ? "text-emerald-400"
    : info?.pythonReady ? "text-[var(--ls-playhead)]"
    : "text-[var(--ls-text-secondary)]";
  const statusText = loading ? t.settingsVenvChecking
    : info?.packagesReady ? t.settingsVenvReady
    : info?.pythonReady ? t.settingsVenvNoPackages
    : t.settingsVenvNotCreated;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--ls-text)]">{t.settingsVenvTitle}</span>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-[var(--ls-playhead)] bg-[var(--ls-playhead)]/40">
            {t.modelRequired}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading || downloading || installing}
          className="ls-button text-xs transition-colors disabled:opacity-40"
        >
          {t.settingsVenvRefresh}
        </button>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-mono ${statusColor}`}>●</span>
        <span className="text-xs text-[var(--ls-text-secondary)]">{statusText}</span>
        {!loading && !info?.pythonReady && !downloading && (
          <button
            onClick={handleDownload}
            className="ls-button ml-auto text-xs bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] text-white transition-colors ls-button--primary"
          >
            {t.settingsVenvCreate}
          </button>
        )}
      </div>

      {/* Python download progress bar */}
      {downloading && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[var(--ls-control)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--ls-accent)] rounded-full" style={{ width: `${dlPercent}%` }} />
          </div>
          <span className="text-xs text-[var(--ls-text-secondary)] tabular-nums w-9 text-right">{dlPercent}%</span>
        </div>
      )}

      {/* Python path */}
      {info?.pythonReady && (
        <span className="text-xs text-[var(--ls-text-secondary)] bg-[var(--ls-control)] rounded px-2 py-1 truncate font-mono">
          {info.pythonPath}
        </span>
      )}

      {/* Package install — shown when Python ready but packages missing */}
      {info?.pythonReady && !info.packagesReady && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleInstall}
            disabled={installing || downloading}
            className="ls-button self-start text-xs bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors ls-button--primary"
          >
            {installing ? t.settingsVenvInstalling : t.settingsVenvInstallBtn}
          </button>
        </div>
      )}
      {(downloading || installing) && (
        <p className="text-xs text-[var(--ls-playhead)]/80">{t.settingsVenvCmdWarning}</p>
      )}
      <div className="flex flex-col gap-2">
          {installError && (
            <span role="alert" className="text-xs text-red-400 break-all">{installError}</span>
          )}
          {installLog.length > 0 && (
            <div
              ref={logRef}
              className="h-32 overflow-y-auto bg-[var(--ls-canvas)] rounded p-2 text-[10px] font-mono text-[var(--ls-text-secondary)] leading-relaxed"
            >
              {installLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
