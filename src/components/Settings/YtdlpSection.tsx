import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { safeUnlisten } from "../../utils/safeUnlisten";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

export function YtdlpSection() {
  const { t } = useI18nStore();
  const {
    ytdlpAudioQuality, ytdlpCookiesFile, ytdlpProxy, youtubeMode,
    setYtdlpAudioQuality, setYtdlpCookiesFile, setYtdlpProxy, setYoutubeMode,
  } = useSettingsStore();

  const [version, setVersion] = useState<string | null>(null);
  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [dlPercent, setDlPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [proxyDraft, setProxyDraft] = useState(ytdlpProxy);
  const [proxySaved, setProxySaved] = useState(false);

  // "latest wins" counter – prevents a stale concurrent refresh from
  // overwriting the result of a more recent one (React StrictMode runs
  // effects twice, so refresh() can be called concurrently on mount).
  const refreshIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshIdRef.current += 1;
    };
  }, []);

  const fetchLatestTag = async () => {
    try {
      const r = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest");
      const data = await r.json();
      if (typeof data.tag_name === "string" && mountedRef.current) setLatestTag(data.tag_name);
    } catch {
      // ignore — no internet or rate limited
    }
  };

  const refresh = async () => {
    const id = ++refreshIdRef.current;
    if (mountedRef.current) {
      setChecking(true);
      setError(null);
    }
    try {
      const v = await invoke<string | null>("check_ytdlp");
      if (refreshIdRef.current === id) {
        setVersion(v);
        setChecking(false);
        if (v !== null) fetchLatestTag();
      }
    } catch (e) {
      if (refreshIdRef.current === id) {
        setVersion(null);
        setError(String(e));
        setChecking(false);
      }
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listener effect with proper StrictMode-safe cleanup:
  // listen() is async, so we track whether the effect is still active and
  // call the unlisten fn as soon as it resolves if we're already unmounted.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    listen<{ downloaded: number; total: number; done: boolean }>(
      "ytdlp-install-progress",
      (e) => {
        if (!active) return;
        const { downloaded, total, done } = e.payload;
        if (total > 0) setDlPercent(Math.round((downloaded / total) * 100));
        if (done) {
          // Exit downloading state immediately — don't block on version check.
          // Refresh runs in the background; the checking label remains visible during that time.
          setDlPercent(100);
          setDownloading(false);
          refresh();
        }
      }
    ).then((fn) => {
      unlisten = fn;
      if (!active) safeUnlisten(fn); // already unmounted before listen resolved
    }).catch(() => {});

    return () => {
      active = false;
      safeUnlisten(unlisten);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async () => {
    setDownloading(true);
    setDlPercent(0);
    setError(null);
    try {
      await invoke("download_ytdlp");
    } catch (e) {
      if (mountedRef.current) setError(String(e));
    } finally {
      if (mountedRef.current) {
        setDlPercent(100);
        setDownloading(false);
        void refresh();
      }
    }
  };

  const handleSelectCookies = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Cookies", extensions: ["txt"] }],
    });
    if (typeof selected === "string") {
      setYtdlpCookiesFile(selected);
    }
  };

  const handleSaveProxy = () => {
    setYtdlpProxy(proxyDraft.trim());
    setProxySaved(true);
    setTimeout(() => setProxySaved(false), 1500);
  };

  const isInstalled = version !== null;
  // Show Update button only when installed version is known AND differs from latest
  const hasUpdate = isInstalled && latestTag !== null && (version === "" || latestTag !== version);

  return (
    <div className="p-5 flex flex-col gap-5">
      <p className="text-xs text-[var(--ls-text-secondary)] leading-relaxed">{t.ytdlpInfoText}</p>

      {/* 설치 상태 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--ls-text)]">{t.ytdlpTitle}</span>
            {!checking && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                isInstalled ? "bg-emerald-900/50 text-emerald-400" : "bg-[var(--ls-control)] text-[var(--ls-text-secondary)]"
              }`}>
                {isInstalled ? t.ytdlpInstalled : t.ytdlpNotInstalled}
              </span>
            )}
            {checking && (
              <span className="text-xs text-[var(--ls-text-secondary)]">{t.ytdlpChecking}</span>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={checking || downloading}
            className="ls-button text-xs transition-colors disabled:opacity-40"
          >
            {t.ytdlpRefresh}
          </button>
        </div>

        {isInstalled && version && (
          <span className="text-xs text-[var(--ls-text-secondary)] font-mono">
            {t.ytdlpVersion}: {version}
          </span>
        )}

        {downloading && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-[var(--ls-control)] rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all"
                style={{ width: `${dlPercent}%` }}
              />
            </div>
            <span className="text-xs text-[var(--ls-text-secondary)] tabular-nums w-9 text-right">{dlPercent}%</span>
          </div>
        )}

        {error && <span className="text-xs text-red-400 break-all">{error}</span>}

        {/* Button: hidden while downloading or checking */}
        {!downloading && !checking && (
          !isInstalled ? (
            <button
              onClick={handleDownload}
              className="ls-button self-start text-xs bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              {t.ytdlpDownload}
            </button>
          ) : hasUpdate ? (
            <button
              onClick={handleDownload}
              className="ls-button self-start text-xs transition-colors"
            >
              {t.ytdlpUpdate}
            </button>
          ) : null
        )}
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* YouTube 모드 토글 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[var(--ls-text)]">{t.youtubeModeLabel}</span>
          <span className="text-xs text-[var(--ls-text-secondary)]">
            {youtubeMode && isInstalled ? t.youtubeModeOn : t.youtubeModeOff}
          </span>
        </div>
        <button
          onClick={() => setYoutubeMode(!youtubeMode)}
          disabled={!isInstalled}
          className={`ls-button ls-switch--youtube ${[
            "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
            youtubeMode && isInstalled ? "bg-red-600" : "bg-[var(--ls-control)]",
            !isInstalled ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}`}
          role="switch"
          aria-checked={youtubeMode}
          title={!isInstalled ? t.ytdlpNotInstalled : undefined}
        >
          <span
            className={[
              "absolute top-[calc(50%-0.5rem)] left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
              youtubeMode && isInstalled ? "translate-x-[22px]" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* 오디오 품질 */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-[var(--ls-text)]">{t.ytdlpAudioQuality}</legend>
        <div className="flex flex-col gap-1.5">
          {(["best", "192", "128"] as const).map((q) => (
            <label key={q} className="flex items-center gap-2.5 cursor-pointer group">
              <input
                type="radio"
                name="ytdlp-audio-quality"
                value={q}
                checked={ytdlpAudioQuality === q}
                onChange={() => setYtdlpAudioQuality(q)}
                className="sr-only peer"
              />
              <span aria-hidden="true" className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ls-accent)] ${
                ytdlpAudioQuality === q ? "border-red-500 bg-red-500" : "border-[var(--ls-border-control)] group-hover:border-[var(--ls-border-control)]"
              }`}>
                {ytdlpAudioQuality === q && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span
                className="text-sm text-[var(--ls-text-secondary)]"
              >
                {q === "best" ? t.ytdlpQualityBest : q === "192" ? t.ytdlpQuality192 : t.ytdlpQuality128}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* 쿠키 파일 */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[var(--ls-text)]">{t.ytdlpCookiesFile}</span>
        <p className="text-xs text-[var(--ls-text-secondary)]">{t.ytdlpCookiesFileDesc}</p>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-[var(--ls-text-secondary)] bg-[var(--ls-control)] rounded px-2 py-1.5 truncate font-mono min-w-0">
            {ytdlpCookiesFile || "—"}
          </span>
          <button
            onClick={handleSelectCookies}
            className="ls-button shrink-0 text-xs transition-colors"
          >
            {t.ytdlpCookiesSelect}
          </button>
          {ytdlpCookiesFile && (
            <button
              onClick={() => setYtdlpCookiesFile("")}
              className="ls-button shrink-0 text-xs transition-colors"
            >
              {t.ytdlpCookiesClear}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* 프록시 */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[var(--ls-text)]">{t.ytdlpProxy}</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={proxyDraft}
            onChange={(e) => { setProxyDraft(e.target.value); setProxySaved(false); }}
            placeholder={t.ytdlpProxyPlaceholder}
            className="ls-field flex-1 text-sm font-mono"
          />
          <button
            onClick={handleSaveProxy}
            disabled={proxyDraft.trim() === ytdlpProxy && !proxySaved}
            className="ls-button text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {proxySaved ? "✓" : t.ytdlpProxySave}
          </button>
        </div>
      </div>
    </div>
  );
}
