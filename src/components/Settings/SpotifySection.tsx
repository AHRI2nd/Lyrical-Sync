import { useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { useServiceStore } from "../../stores/useServiceStore";

export function SpotifySection({
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
