import { useServiceStore } from "../../stores/useServiceStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";

interface Props {
  onNoClientId: () => void;
  onConnected: () => void;
}

export function SpotifyButton({ onNoClientId, onConnected }: Props) {
  const { t } = useI18nStore();
  const { isLoggedIn, isReady, trackName } = useServiceStore();
  const { spotifyClientId, startLogin } = {
    spotifyClientId: useSettingsStore((s) => s.spotifyClientId),
    startLogin: useServiceStore((s) => s.startLogin),
  };

  const handleClick = async () => {
    if (isLoggedIn) {
      onConnected();
      return;
    }
    if (!spotifyClientId.trim()) {
      onNoClientId();
      return;
    }
    try {
      await startLogin();
    } catch {
      // error shown in SettingsModal
    }
  };

  const label = isReady && trackName
    ? trackName.length > 16 ? trackName.slice(0, 14) + "…" : trackName
    : isLoggedIn
    ? t.spotifyConnected
    : t.spotifyConnect;

  return (
    <button
      onClick={handleClick}
      title="Spotify"
      className={[
        "flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg transition-colors font-medium shrink-0",
        isReady
          ? "bg-green-700 hover:bg-green-600 text-white"
          : isLoggedIn
          ? "bg-green-900/50 hover:bg-green-800/60 text-green-300 border border-green-800"
          : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100",
      ].join(" ")}
    >
      <SpotifyIcon />
      <span className="max-w-[120px] truncate">{label}</span>
    </button>
  );
}

function SpotifyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}
