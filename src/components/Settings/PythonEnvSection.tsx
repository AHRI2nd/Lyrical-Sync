import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18nStore } from "../../stores/useI18nStore";
import { listenSafely } from "../../utils/safeListen";
import { useBusyStore } from "../../stores/useBusyStore";

interface PythonEnvInfo {
  pythonReady: boolean;
  packagesReady: boolean;
  pipInstallCmd: string;
  pythonPath: string;
}

export function PythonEnvSection() {
  const { t } = useI18nStore();
  const mounted = useRef(true);
  const [info, setInfo] = useState<PythonEnvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const downloading = useBusyStore((state) => state.reasons.has("python-download"));
  const [dlPercent, setDlPercent] = useState(0);
  const installing = useBusyStore((state) => state.reasons.has("python-packages"));
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (mounted.current) setLoading(true);
    try {
      const v = await invoke<PythonEnvInfo>("get_python_env_info");
      if (mounted.current) setInfo(v);
    } catch { /* ignore */ }
    if (mounted.current) setLoading(false);
  }, []);

  useEffect(() => {
    if (downloading || installing) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [downloading, installing, refresh]);

  // Clear stale install error once packages are confirmed ready (handles the
  // case where pip exits with non-zero on Windows but packages are installed).
  useEffect(() => {
    if (info?.packagesReady) {
      setInstallError(null);
    }
  }, [info]);

  useEffect(() => {
    return listenSafely((isActive) => listen<{ percent: number; done: boolean }>("python-download-progress", (e) => {
      if (!isActive() || !mounted.current) return;
      setDlPercent(e.payload.percent);
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return listenSafely((isActive) => listen<{ line: string; done: boolean; success: boolean }>("pip-install-progress", (e) => {
      if (!isActive() || !mounted.current) return;
      if (!e.payload.done && e.payload.line) {
        setInstallLog((prev) => [...prev, e.payload.line]);
      }
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog]);

  const handleDownload = async () => {
    const busy = useBusyStore.getState().reasons;
    if (busy.has("python-download") || busy.has("python-packages")) return;
    const busyId = "python-download";
    useBusyStore.getState().markBusy(busyId);
    setDlPercent(0);
    setInstallLog([]);
    setInstallError(null);
    try {
      await invoke("download_embedded_python");
    } catch (e) {
      if (mounted.current) setInstallError(String(e));
    } finally {
      useBusyStore.getState().clearBusy(busyId);
    }
  };

  const handleInstall = async () => {
    const busy = useBusyStore.getState().reasons;
    if (busy.has("python-download") || busy.has("python-packages")) return;
    const busyId = "python-packages";
    useBusyStore.getState().markBusy(busyId);
    setInstallLog([]);
    setInstallError(null);
    try {
      await invoke("install_python_packages");
    } catch (e) {
      if (mounted.current) setInstallError(String(e));
    } finally {
      useBusyStore.getState().clearBusy(busyId);
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
