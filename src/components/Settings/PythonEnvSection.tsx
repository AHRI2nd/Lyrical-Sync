import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ percent: number; done: boolean }>("python-download-progress", (e) => {
        setDlPercent(e.payload.percent);
        if (e.payload.done) {
          setDownloading(false);
          refresh();
        }
      }).then((fn) => { unlisten = fn; }).catch(() => {});
    });
    return () => { safeUnlisten(unlisten); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ line: string; done: boolean; success: boolean }>("pip-install-progress", (e) => {
        if (e.payload.done) {
          setInstalling(false);
          refresh();
        } else if (e.payload.line) {
          setInstallLog((prev) => [...prev, e.payload.line]);
        }
      }).then((fn) => { unlisten = fn; }).catch(() => {});
    });
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
    try {
      await invoke("download_embedded_python");
    } catch (e) {
      setDownloading(false);
      setInstallError(String(e));
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setInstallLog([]);
    setInstallError(null);
    try {
      await invoke("install_python_packages");
    } catch (e) {
      setInstalling(false);
      setInstallError(String(e));
    }
  };

  const statusColor = loading ? "text-zinc-500"
    : info?.packagesReady ? "text-emerald-400"
    : info?.pythonReady ? "text-amber-400"
    : "text-zinc-500";
  const statusText = loading ? t.settingsVenvChecking
    : info?.packagesReady ? t.settingsVenvReady
    : info?.pythonReady ? t.settingsVenvNoPackages
    : t.settingsVenvNotCreated;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-200">{t.settingsVenvTitle}</span>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-amber-300 bg-amber-900/40">
            {t.modelRequired}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading || downloading || installing}
          className="px-2.5 py-1 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors disabled:opacity-40"
        >
          {t.settingsVenvRefresh}
        </button>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-mono ${statusColor}`}>●</span>
        <span className="text-xs text-zinc-300">{statusText}</span>
        {!loading && !info?.pythonReady && !downloading && (
          <button
            onClick={handleDownload}
            className="ml-auto px-2.5 py-1 text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            {t.settingsVenvCreate}
          </button>
        )}
      </div>

      {/* Python download progress bar */}
      {downloading && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${dlPercent}%` }} />
          </div>
          <span className="text-xs text-zinc-400 tabular-nums w-9 text-right">{dlPercent}%</span>
        </div>
      )}

      {/* Python path */}
      {info?.pythonReady && (
        <span className="text-xs text-zinc-500 bg-zinc-800 rounded px-2 py-1 truncate font-mono">
          {info.pythonPath}
        </span>
      )}

      {/* Package install — shown when Python ready but packages missing */}
      {info?.pythonReady && !info.packagesReady && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleInstall}
            disabled={installing}
            className="self-start px-3 py-1.5 text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            {installing ? t.settingsVenvInstalling : t.settingsVenvInstallBtn}
          </button>
          {installing && (
            <p className="text-xs text-amber-400/80">{t.settingsVenvCmdWarning}</p>
          )}
          {installError && (
            <span className="text-xs text-red-400 break-all">{installError}</span>
          )}
          {installLog.length > 0 && (
            <div
              ref={logRef}
              className="h-32 overflow-y-auto bg-zinc-950 rounded p-2 text-[10px] font-mono text-zinc-400 leading-relaxed"
            >
              {installLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
