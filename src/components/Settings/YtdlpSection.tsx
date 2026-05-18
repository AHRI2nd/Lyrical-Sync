import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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

  const fetchLatestTag = async () => {
    try {
      const r = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest");
      const data = await r.json();
      if (typeof data.tag_name === "string") setLatestTag(data.tag_name);
    } catch {
      // ignore — no internet or rate limited
    }
  };

  const refresh = async () => {
    const id = ++refreshIdRef.current;
    setChecking(true);
    setError(null);
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
          // refresh() runs in background; "확인 중…" shows during that time.
          setDlPercent(100);
          setDownloading(false);
          refresh();
        }
      }
    ).then((fn) => {
      unlisten = fn;
      if (!active) fn(); // already unmounted before listen resolved
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async () => {
    setDownloading(true);
    setDlPercent(0);
    setError(null);
    try {
      await invoke("download_ytdlp");
    } catch (e) {
      setDownloading(false);
      setError(String(e));
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
      <p className="text-xs text-zinc-500 leading-relaxed">{t.ytdlpInfoText}</p>

      {/* 설치 상태 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-200">{t.ytdlpTitle}</span>
            {!checking && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                isInstalled ? "bg-emerald-900/50 text-emerald-400" : "bg-zinc-700 text-zinc-400"
              }`}>
                {isInstalled ? t.ytdlpInstalled : t.ytdlpNotInstalled}
              </span>
            )}
            {checking && (
              <span className="text-xs text-zinc-500">확인 중…</span>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={checking || downloading}
            className="px-2.5 py-1 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors disabled:opacity-40"
          >
            {t.ytdlpRefresh}
          </button>
        </div>

        {isInstalled && version && (
          <span className="text-xs text-zinc-500 font-mono">
            {t.ytdlpVersion}: {version}
          </span>
        )}

        {downloading && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all"
                style={{ width: `${dlPercent}%` }}
              />
            </div>
            <span className="text-xs text-zinc-400 tabular-nums w-9 text-right">{dlPercent}%</span>
          </div>
        )}

        {error && <span className="text-xs text-red-400 break-all">{error}</span>}

        {/* Button: hidden while downloading or checking */}
        {!downloading && !checking && (
          !isInstalled ? (
            <button
              onClick={handleDownload}
              className="self-start px-3 py-1.5 text-xs rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              {t.ytdlpDownload}
            </button>
          ) : hasUpdate ? (
            <button
              onClick={handleDownload}
              className="self-start px-2.5 py-1 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              {t.ytdlpUpdate}
            </button>
          ) : null
        )}
      </div>

      <div className="border-t border-zinc-800" />

      {/* YouTube 모드 토글 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-zinc-200">{t.youtubeModeLabel}</span>
          <span className="text-xs text-zinc-500">
            {youtubeMode && isInstalled ? t.youtubeModeOn : t.youtubeModeOff}
          </span>
        </div>
        <button
          onClick={() => setYoutubeMode(!youtubeMode)}
          disabled={!isInstalled}
          className={[
            "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
            youtubeMode && isInstalled ? "bg-red-600" : "bg-zinc-600",
            !isInstalled ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
          role="switch"
          aria-checked={youtubeMode}
          title={!isInstalled ? t.ytdlpNotInstalled : undefined}
        >
          <span
            className={[
              "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
              youtubeMode && isInstalled ? "translate-x-[22px]" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      </div>

      <div className="border-t border-zinc-800" />

      {/* 오디오 품질 */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-200">{t.ytdlpAudioQuality}</span>
        <div className="flex flex-col gap-1.5">
          {(["best", "192", "128"] as const).map((q) => (
            <label key={q} className="flex items-center gap-2.5 cursor-pointer group">
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  ytdlpAudioQuality === q ? "border-red-500 bg-red-500" : "border-zinc-600 group-hover:border-zinc-400"
                }`}
                onClick={() => setYtdlpAudioQuality(q)}
              >
                {ytdlpAudioQuality === q && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span
                className="text-sm text-zinc-300 cursor-pointer"
                onClick={() => setYtdlpAudioQuality(q)}
              >
                {q === "best" ? t.ytdlpQualityBest : q === "192" ? t.ytdlpQuality192 : t.ytdlpQuality128}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      {/* 쿠키 파일 */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-200">{t.ytdlpCookiesFile}</span>
        <p className="text-xs text-zinc-500">{t.ytdlpCookiesFileDesc}</p>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-zinc-400 bg-zinc-800 rounded px-2 py-1.5 truncate font-mono min-w-0">
            {ytdlpCookiesFile || "—"}
          </span>
          <button
            onClick={handleSelectCookies}
            className="shrink-0 px-2.5 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
          >
            {t.ytdlpCookiesSelect}
          </button>
          {ytdlpCookiesFile && (
            <button
              onClick={() => setYtdlpCookiesFile("")}
              className="shrink-0 px-2.5 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-400 transition-colors"
            >
              {t.ytdlpCookiesClear}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      {/* 프록시 */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-200">{t.ytdlpProxy}</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={proxyDraft}
            onChange={(e) => { setProxyDraft(e.target.value); setProxySaved(false); }}
            placeholder={t.ytdlpProxyPlaceholder}
            className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono"
          />
          <button
            onClick={handleSaveProxy}
            disabled={proxyDraft.trim() === ytdlpProxy && !proxySaved}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 transition-colors"
          >
            {proxySaved ? "✓" : t.ytdlpProxySave}
          </button>
        </div>
      </div>
    </div>
  );
}
