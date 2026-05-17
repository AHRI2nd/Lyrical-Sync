import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { checkForUpdate } from "../../utils/updateCheck";
import { ModelDownloadSection } from "./ModelDownloadSection";

type CheckState = "idle" | "checking" | "upToDate";
type Tab = "general" | "models" | "spotify";

export function SettingsModal({
  onClose,
  onUpdateFound,
}: {
  onClose: () => void;
  onUpdateFound: (version: string) => void;
}) {
  const { t } = useI18nStore();
  const {
    autoCheckUpdate, uiScale, blankLineOffset, spotifyClientId, spotifyMode,
    setAutoCheckUpdate, setUiScale, setBlankLineOffset, setSpotifyClientId, setSpotifyMode,
  } = useSettingsStore();
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCheckNow = async () => {
    setCheckState("checking");
    try {
      const version = await checkForUpdate();
      if (version) {
        onClose();
        onUpdateFound(version);
      } else {
        setCheckState("upToDate");
      }
    } catch {
      setCheckState("upToDate");
    }
  };

  const scalePercent = Math.round(uiScale * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.settingsTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          <TabBtn active={tab === "general"} onClick={() => setTab("general")}>
            {t.settingsTabGeneral}
          </TabBtn>
          <TabBtn active={tab === "models"} onClick={() => setTab("models")}>
            {t.settingsTabModels}
          </TabBtn>
          <TabBtn active={tab === "spotify"} onClick={() => setTab("spotify")}>
            {t.settingsTabSpotify}
          </TabBtn>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {tab === "general" && (
            <div className="p-5 flex flex-col gap-5">
              {/* Auto update */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsAutoUpdate}</span>
                  <button
                    onClick={() => setAutoCheckUpdate(!autoCheckUpdate)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      autoCheckUpdate ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={autoCheckUpdate}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        autoCheckUpdate ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsAutoUpdateDesc}</p>

                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={handleCheckNow}
                    disabled={checkState === "checking"}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 transition-colors"
                  >
                    {checkState === "checking" ? t.settingsChecking : t.settingsCheckNow}
                  </button>
                  {checkState === "upToDate" && (
                    <span className="text-xs text-emerald-400">{t.settingsUpToDate}</span>
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-800" />

              {/* Blank line offset */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.aiSyncBlankOffset}</span>
                  <span className="text-sm tabular-nums text-zinc-300 w-12 text-right">
                    {blankLineOffset.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={blankLineOffset}
                  onChange={(e) => setBlankLineOffset(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <p className="text-xs text-zinc-500">{t.aiSyncBlankOffsetDesc}</p>
              </div>

              <div className="border-t border-zinc-800" />

              {/* UI Scale */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsUiScale}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-zinc-300 w-10 text-right">
                      {scalePercent}%
                    </span>
                    <button
                      onClick={() => setUiScale(1.0)}
                      disabled={uiScale === 1.0}
                      className="px-2 py-0.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 transition-colors"
                    >
                      {t.settingsUiScaleReset}
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.3}
                  step={0.05}
                  value={uiScale}
                  onChange={(e) => setUiScale(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-zinc-500 select-none">
                  <span>70%</span>
                  <span>100%</span>
                  <span>130%</span>
                </div>
              </div>
            </div>
          )}

          {tab === "models" && (
            <div className="p-5 flex flex-col gap-5">
              <PythonEnvSection />
              <div className="border-t border-zinc-800" />
              <ModelDownloadSection />
            </div>
          )}

          {tab === "spotify" && (
            <SpotifySection
              clientId={spotifyClientId}
              onSaveClientId={setSpotifyClientId}
              spotifyMode={spotifyMode}
              onToggleMode={setSpotifyMode}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Python env section ───────────────────────────────────────────────────────

interface PythonEnvInfo {
  pythonReady: boolean;
  packagesReady: boolean;
  pipInstallCmd: string;
  pythonPath: string;
}

function PythonEnvSection() {
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
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
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
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
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

// ─── Spotify section ─────────────────────────────────────────────────────────

function SpotifySection({
  clientId,
  onSaveClientId,
  spotifyMode,
  onToggleMode,
}: {
  clientId: string;
  onSaveClientId: (v: string) => void;
  spotifyMode: boolean;
  onToggleMode: (v: boolean) => void;
}) {
  const { t } = useI18nStore();
  const { isLoggedIn, isReady, trackName, artistName, startLogin, logout } = useServiceStore();
  const [draft, setDraft] = useState(clientId);
  const [saved, setSaved] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    onSaveClientId(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      await startLogin();
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="p-5 flex flex-col gap-5">
      {/* Client ID input */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-zinc-200">{t.spotifyClientId}</span>
        <p className="text-xs text-zinc-500 leading-relaxed">{t.spotifyClientIdDesc}</p>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
            placeholder={t.spotifyClientIdPlaceholder}
            className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleSave}
            disabled={draft.trim() === clientId && !saved}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 transition-colors"
          >
            {saved ? t.spotifyClientIdSaved : t.spotifyClientIdSave}
          </button>
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-zinc-200">Spotify 모드</span>
          <span className="text-xs text-zinc-500">
            {spotifyMode ? "Spotify 플레이어 사용 중" : "일반 오디오 파일 모드"}
          </span>
        </div>
        <button
          onClick={() => onToggleMode(!spotifyMode)}
          disabled={!isLoggedIn}
          className={[
            "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
            spotifyMode && isLoggedIn ? "bg-green-600" : "bg-zinc-600",
            !isLoggedIn ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
          role="switch"
          aria-checked={spotifyMode}
          title={!isLoggedIn ? "먼저 Spotify에 연결하세요" : undefined}
        >
          <span
            className={[
              "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
              spotifyMode && isLoggedIn ? "translate-x-[22px]" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      </div>

      <div className="border-t border-zinc-800" />

      {/* Connect / status */}
      <div className="flex flex-col gap-3">
        {isLoggedIn ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-400">●</span>
              <span className="text-sm text-zinc-200">
                {isReady && trackName
                  ? `${trackName} — ${artistName}`
                  : t.spotifyConnected}
              </span>
            </div>
            <button
              onClick={logout}
              className="self-start px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              {t.spotifyLogout}
            </button>
          </>
        ) : (
          <>
            {!clientId && (
              <p className="text-xs text-amber-400">{t.spotifyNoClientIdDesc}</p>
            )}
            <button
              onClick={handleConnect}
              disabled={connecting || !clientId}
              className="self-start px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {connecting ? t.spotifyConnecting : t.spotifyConnect}
            </button>
            {error && (
              <span className="text-xs text-red-400 break-all">{error}</span>
            )}
          </>
        )}
      </div>

      <div className="border-t border-zinc-800" />

      <p className="text-xs text-zinc-600 leading-relaxed">{t.spotifyServiceModeInfo}</p>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "text-indigo-400 border-indigo-500"
          : "text-zinc-400 border-transparent hover:text-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
