import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { KeybindingsSection } from "./KeybindingsSection";

type Tab = "general" | "shortcuts" | "spotify";

export function SettingsModal({
  onClose,
  initialTab = "general",
}: {
  onClose: () => void;
  initialTab?: Tab;
}) {
  const { t, lang } = useI18nStore();
  const {
    autoSave, uiScale, showElrcSaveNotice, lyricsFontScale, showGlyphTimeMarkers, spotifyClientId, spotifyMode,
    setAutoSave, setUiScale, setShowElrcSaveNotice, setLyricsFontScale, setShowGlyphTimeMarkers, setSpotifyClientId, setSpotifyMode,
  } = useSettingsStore();

  const guideSuffix = lang === "ko" ? "ko" : lang === "ja" ? "ja" : "en";
  const spotifyGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-spotify-guide-${guideSuffix}/`;
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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
          <TabBtn active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
            {t.settingsTabShortcuts}
          </TabBtn>
          <TabBtn active={tab === "spotify"} onClick={() => setTab("spotify")}>
            {t.settingsTabSpotify}
          </TabBtn>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {tab === "general" && (
            <div className="p-5 flex flex-col gap-5">
              {/* Auto save */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsAutoSave}</span>
                  <button
                    onClick={() => setAutoSave(!autoSave)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      autoSave ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={autoSave}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        autoSave ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsAutoSaveDesc}</p>
              </div>

              <div className="border-t border-zinc-800" />

              {/* Enhanced LRC 저장 알림 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsElrcNotice}</span>
                  <button
                    onClick={() => setShowElrcSaveNotice(!showElrcSaveNotice)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      showElrcSaveNotice ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={showElrcSaveNotice}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        showElrcSaveNotice ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsElrcNoticeDesc}</p>
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
                      className="px-2 py-0.5 text-xs rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                  className="range-slim w-full"
                  style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(((uiScale - 0.7) / 0.6) * 100)}%, #3f3f46 ${Math.round(((uiScale - 0.7) / 0.6) * 100)}%)` }}
                />
                <div className="flex justify-between text-xs text-zinc-500 select-none">
                  <span>70%</span>
                  <span>100%</span>
                  <span>130%</span>
                </div>
              </div>

              <div className="border-t border-zinc-800" />

              {/* Lyrics font size */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsLyricsFontSize}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-zinc-300 w-10 text-right">
                      {Math.round(lyricsFontScale * 100)}%
                    </span>
                    <button
                      onClick={() => setLyricsFontScale(1.0)}
                      disabled={lyricsFontScale === 1.0}
                      className="px-2 py-0.5 text-xs rounded text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t.settingsUiScaleReset}
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={1.5}
                  step={0.05}
                  value={lyricsFontScale}
                  onChange={(e) => setLyricsFontScale(Number(e.target.value))}
                  className="range-slim w-full"
                  style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(((lyricsFontScale - 0.8) / 0.7) * 100)}%, #3f3f46 ${Math.round(((lyricsFontScale - 0.8) / 0.7) * 100)}%)` }}
                />
              </div>

              <div className="border-t border-zinc-800" />

              {/* Glyph time markers */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{t.settingsGlyphMarkers}</span>
                  <button
                    onClick={() => setShowGlyphTimeMarkers(!showGlyphTimeMarkers)}
                    className={[
                      "relative w-10 h-5 rounded-full transition-colors shrink-0 p-0 overflow-hidden",
                      showGlyphTimeMarkers ? "bg-indigo-600" : "bg-zinc-600",
                    ].join(" ")}
                    role="switch"
                    aria-checked={showGlyphTimeMarkers}
                  >
                    <span
                      className={[
                        "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        showGlyphTimeMarkers ? "translate-x-[22px]" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">{t.settingsGlyphMarkersDesc}</p>
              </div>
            </div>
          )}

          {tab === "shortcuts" && (
            <div className="p-5">
              <KeybindingsSection />
            </div>
          )}

          {tab === "spotify" && (
            <>
              <div className="px-5 pt-4">
                <GuideBanner color="green" url={spotifyGuideUrl} label={t.settingsViewGuide} />
              </div>
              <SpotifySection
                clientId={spotifyClientId}
                onSaveClientId={setSpotifyClientId}
                spotifyMode={spotifyMode}
                onToggleMode={setSpotifyMode}
              />
            </>
          )}
        </div>
      </div>
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

function GuideBanner({ color, url, label }: { color: "indigo" | "green" | "red"; url: string; label: string }) {
  const colorMap = {
    indigo: "bg-indigo-950/60 border-indigo-800/50 text-indigo-400 hover:text-indigo-300",
    green:  "bg-green-950/60 border-green-800/50 text-green-400 hover:text-green-300",
    red:    "bg-red-950/60 border-red-800/50 text-red-400 hover:text-red-300",
  };
  return (
    <button
      onClick={() => openUrl(url)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${colorMap[color]}`}
    >
      <span>{label}</span>
      <span className="opacity-70">↗</span>
    </button>
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
