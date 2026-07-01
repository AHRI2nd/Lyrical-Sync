import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useServiceStore } from "../../stores/useServiceStore";
import { serviceControls } from "../../utils/serviceControls";
import { setSpotifyVolume } from "../../utils/spotifyPlayer";
import { useI18nStore } from "../../stores/useI18nStore";
import { DevicePickerModal } from "./DevicePickerModal";
import { TrackInfoHeader } from "../AudioPlayer/TrackInfoHeader";
import { SeekBar } from "../AudioPlayer/SeekBar";

interface ServicePlayerPanelProps {
  onSpotifySearch?: () => void;
  onLoadCurrent?: () => void;
}

export function ServicePlayerPanel({ onSpotifySearch, onLoadCurrent }: ServicePlayerPanelProps = {}) {
  const { t } = useI18nStore();
  const {
    isPlaying, isLooping, positionMs, durationMs,
    trackName, artistName, albumName, albumArtUrl, trackUri,
    toggleLoop,
  } = useServiceStore();

  // Spotify 콘텐츠 출처표시: 트랙을 Spotify에서 열기 (spotify:track:ID → open.spotify.com)
  const trackUrl = trackUri?.startsWith("spotify:track:")
    ? `https://open.spotify.com/track/${trackUri.split(":")[2]}`
    : null;

  const [volume, setVolume] = useState(1.0);
  const [showDevices, setShowDevices] = useState(false);

  const positionSec = positionMs / 1000;
  const durationSec = durationMs / 1000;

  return (
    <div className="flex flex-col gap-3 w-full select-none">

      {/* Track info — 클릭 시 Spotify에서 열기(출처표시) */}
      <TrackInfoHeader
        icon={<SpotifyGlyph />}
        iconBgClass="bg-green-500/15 text-green-400"
        imageUrl={albumArtUrl || undefined}
        title={trackName}
        subtitle={artistName + (albumName ? ` · ${albumName}` : "")}
        emptyMessage={t.spotifyConnected}
        onClick={trackUrl ? () => openUrl(trackUrl) : undefined}
        linkHint={!!trackUrl}
      />

      {/* Seek bar */}
      <SeekBar
        position={positionSec}
        duration={durationSec}
        onSeek={(s) => serviceControls.seekTo(s)}
        accentClass="bg-green-500"
      />

      {/* 재생 컨트롤 한 줄: 정지(좌) · 전송(중앙) · 반복(우) */}
      <div className="flex items-center gap-0.5">
        <CtrlBtn onClick={() => serviceControls.stopAndReset()} title={t.tooltipStop}>
          <StopIcon />
        </CtrlBtn>
        <div className="flex-1 flex items-center justify-center gap-0.5">
          <CtrlBtn onClick={() => serviceControls.skip(-5)} title={t.tooltipSkipBack5}>
            <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
          </CtrlBtn>
          <CtrlBtn onClick={() => serviceControls.skip(-1)} title={t.tooltipSkipBack1}>
            <TriLeftIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
          </CtrlBtn>
          <CtrlBtn onClick={() => serviceControls.togglePlay()} title={t.tooltipPlayPause} accent>
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </CtrlBtn>
          <CtrlBtn onClick={() => serviceControls.skip(1)} title={t.tooltipSkipFwd1}>
            <span className="text-[10px] font-bold mr-0.5">1</span><TriRightIcon />
          </CtrlBtn>
          <CtrlBtn onClick={() => serviceControls.skip(5)} title={t.tooltipSkipFwd5}>
            <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
          </CtrlBtn>
        </div>
        <CtrlBtn onClick={() => toggleLoop().catch(() => {})} title={t.tooltipLoop} active={isLooping}>
          <LoopIcon />
        </CtrlBtn>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2.5 text-zinc-400" title={`${t.volume} ${Math.round(volume * 100)}%`}>
        <span className="shrink-0"><VolumeIcon /></span>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => {
            const v = parseFloat(Number(e.target.value).toFixed(2));
            setVolume(v);
            setSpotifyVolume(v).catch(() => {});
          }}
          className="range-slim min-w-0 flex-1"
          style={{ background: `linear-gradient(to right, #22c55e ${Math.round(volume * 100)}%, #3f3f46 ${Math.round(volume * 100)}%)`, ["--slim-accent" as string]: "#22c55e" }}
        />
        <span className="shrink-0 w-9 text-right text-xs text-zinc-400 tabular-nums">{Math.round(volume * 100)}%</span>
      </div>

      {/* 곡 검색/열기 버튼 + 기기 선택 */}
      <div className="flex gap-2">
        <button
          onClick={onLoadCurrent}
          className="flex-1 py-2 rounded-lg border border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-300 text-sm transition-colors text-center truncate"
        >
          {t.spotifyLoadCurrent}
        </button>
        <button
          onClick={onSpotifySearch}
          className="flex-1 py-2 rounded-lg border border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-300 text-sm transition-colors text-center truncate"
        >
          {t.spotifySearchTrack}
        </button>
        <button
          onClick={() => setShowDevices(true)}
          title={t.devicePicker.button}
          className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-300 transition-colors flex items-center justify-center"
        >
          <DevicesIcon />
        </button>
      </div>

      {showDevices && <DevicePickerModal onClose={() => setShowDevices(false)} />}

    </div>
  );
}

function SpotifyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="11" height="9" rx="1.5" />
      <rect x="14" y="10" width="6" height="10" rx="1.5" />
      <line x1="7" y1="17" x2="11" y2="17" />
    </svg>
  );
}

function CtrlBtn({
  onClick, title, children, accent, active,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  accent?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        "flex items-center justify-center text-sm transition-colors",
        accent
          ? "w-9 h-9 rounded-full bg-green-600 hover:bg-green-500 active:bg-green-700 text-white"
          : active
            ? "h-9 px-2 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25"
            : "h-9 px-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>;
}
function StopIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z" /></svg>;
}
function SkipBackIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M11 6 L11 18 L4 12 Z M18 6 L18 18 L11 12 Z" /></svg>;
}
function SkipFwdIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6 L6 18 L13 12 Z M13 6 L13 18 L20 12 Z" /></svg>;
}
function TriLeftIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6 L15 18 L7 12 Z" /></svg>;
}
function TriRightIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6 L9 18 L17 12 Z" /></svg>;
}
function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function LoopIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>;
}
