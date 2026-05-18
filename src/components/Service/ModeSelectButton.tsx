import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { audioControls } from "../../utils/audioControls";

export function ModeSelectButton() {
  const [open, setOpen] = useState(false);
  const [ytdlpInstalled, setYtdlpInstalled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18nStore();
  const spotifyMode = useSettingsStore((s) => s.spotifyMode);
  const youtubeMode = useSettingsStore((s) => s.youtubeMode);
  const setSpotifyMode = useSettingsStore((s) => s.setSpotifyMode);
  const setYoutubeMode = useSettingsStore((s) => s.setYoutubeMode);
  const isLoggedIn = useServiceStore((s) => s.isLoggedIn);
  const isReady = useServiceStore((s) => s.isReady);
  const trackName = useServiceStore((s) => s.trackName);
  const pausePlayback = useServiceStore((s) => s.pausePlayback);

  const checkYtdlp = () => {
    invoke<string | null>("check_ytdlp").then((v) => setYtdlpInstalled(v !== null)).catch(() => {});
  };

  useEffect(() => {
    checkYtdlp();
  }, []);

  // Re-check when yt-dlp installation completes
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    listen<{ done: boolean }>("ytdlp-install-progress", (e) => {
      if (active && e.payload.done) checkYtdlp();
    }).then((fn) => { unlisten = fn; if (!active) fn(); });
    return () => { active = false; unlisten?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentLabel = youtubeMode
    ? t.modeYouTube
    : spotifyMode
    ? isReady && trackName
      ? trackName.length > 14 ? trackName.slice(0, 12) + "…" : trackName
      : "Spotify"
    : t.modeFile;

  const currentColor = youtubeMode
    ? "bg-red-700 hover:bg-red-600 text-white"
    : spotifyMode
    ? isLoggedIn && isReady
      ? "bg-green-700 hover:bg-green-600 text-white"
      : isLoggedIn
      ? "bg-green-900/50 hover:bg-green-800/60 text-green-300 border border-green-800"
      : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
    : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100";

  const selectFile = () => {
    if (spotifyMode && isLoggedIn) pausePlayback();
    else audioControls.pause();
    setSpotifyMode(false); setYoutubeMode(false); setOpen(false);
  };
  const selectSpotify = () => {
    audioControls.pause();
    setSpotifyMode(true); setYoutubeMode(false); setOpen(false);
  };
  const selectYouTube = () => {
    if (spotifyMode && isLoggedIn) pausePlayback();
    else audioControls.pause();
    setSpotifyMode(false); setYoutubeMode(true); setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => { setOpen((v) => !v); checkYtdlp(); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${currentColor}`}
      >
        <span className="text-zinc-400 font-normal">{t.modeSelect}</span>
        <span className="text-[10px] text-zinc-500">|</span>
        {spotifyMode && !youtubeMode && <SpotifyIcon />}
        {youtubeMode && <YouTubeIcon />}
        <span className="max-w-[100px] truncate">{currentLabel}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden py-1">
          <ModeOption
            label={t.modeFile}
            active={!spotifyMode && !youtubeMode}
            icon={<FileIcon />}
            onClick={selectFile}
          />
          <ModeOption
            label="Spotify"
            active={spotifyMode && !youtubeMode}
            icon={<SpotifyIcon />}
            onClick={selectSpotify}
          />
          <ModeOption
            label={ytdlpInstalled ? t.modeYouTube : `${t.modeYouTube} ${t.modeComingSoon}`}
            active={youtubeMode}
            disabled={!ytdlpInstalled}
            icon={<YouTubeIcon />}
            onClick={ytdlpInstalled ? selectYouTube : () => {}}
          />
        </div>
      )}
    </div>
  );
}

function ModeOption({
  label, active, disabled, icon, onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors",
        disabled
          ? "text-zinc-600 cursor-not-allowed"
          : active
          ? "text-white bg-zinc-700"
          : "text-zinc-300 hover:bg-zinc-700 hover:text-white",
      ].join(" ")}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="truncate">{label}</span>
      {active && <span className="ml-auto text-indigo-400 text-[10px]">✓</span>}
    </button>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="2,3.5 5,6.5 8,3.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
