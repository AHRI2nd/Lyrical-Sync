import { useState } from "react";
import { useServiceStore } from "../../stores/useServiceStore";
import { serviceControls } from "../../utils/serviceControls";
import { setSpotifyVolume } from "../../utils/spotifyPlayer";
import { formatDisplayTime } from "../../utils/lrcParser";
import { useI18nStore } from "../../stores/useI18nStore";

interface ServicePlayerPanelProps {
  onSpotifySearch?: () => void;
  onLoadCurrent?: () => void;
}

export function ServicePlayerPanel({ onSpotifySearch, onLoadCurrent }: ServicePlayerPanelProps = {}) {
  const { t } = useI18nStore();
  const {
    isPlaying, isLooping, positionMs, durationMs,
    trackName, artistName, albumName, albumArtUrl,
    toggleLoop,
  } = useServiceStore();

  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const [volume, setVolume] = useState(1.0);

  const positionSec = positionMs / 1000;
  const durationSec = durationMs / 1000;
  const progress = durationMs > 0 ? positionMs / durationMs : 0;

  return (
    <div className="flex flex-col gap-3 w-full select-none">

      {/* Seek bar (bar-mode style) */}
      <div
        className="w-full rounded-xl bg-zinc-800 flex flex-col justify-center px-5"
        style={{ minHeight: 80, paddingTop: 14, paddingBottom: 14, gap: 10 }}
      >
        {/* Track */}
        <div
          className="relative group cursor-pointer"
          style={{ paddingTop: 6, paddingBottom: 6 }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoverRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
          }}
          onMouseLeave={() => setHoverRatio(null)}
          onMouseDown={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            serviceControls.seekTo(ratio * durationSec);
          }}
        >
          {/* Hover tooltip */}
          {hoverRatio !== null && durationSec > 0 && (
            <div
              className="absolute font-mono text-[10px] bg-zinc-700 text-zinc-200 px-1.5 py-0.5 rounded pointer-events-none -translate-x-1/2 whitespace-nowrap z-10"
              style={{
                bottom: "calc(100% - 2px)",
                left: `${Math.max(8, Math.min(92, hoverRatio * 100))}%`,
              }}
            >
              {formatDisplayTime(hoverRatio * durationSec)}
            </div>
          )}

          {/* Track bar */}
          <div
            className="rounded-full relative transition-all duration-150 bg-zinc-700"
            style={{ height: hoverRatio !== null ? 6 : 4, overflow: "visible" }}
          >
            {hoverRatio !== null && (
              <div
                className="absolute inset-y-0 left-0 bg-zinc-500 rounded-full"
                style={{ width: `${hoverRatio * 100}%` }}
              />
            )}
            <div
              className="absolute inset-y-0 left-0 bg-green-500 rounded-full"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg border-2 border-green-400 transition-all duration-150"
              style={{
                width: hoverRatio !== null ? 14 : 10,
                height: hoverRatio !== null ? 14 : 10,
                left: `calc(${progress * 100}% - ${hoverRatio !== null ? 7 : 5}px)`,
                opacity: hoverRatio !== null ? 1 : 0.7,
              }}
            />
          </div>
        </div>

        {/* Time display */}
        <div className="flex justify-between items-center">
          <span className="text-xs font-mono text-zinc-300 tabular-nums">
            {formatDisplayTime(positionSec)}
          </span>
          <button
            onClick={() => setShowRemaining((p) => !p)}
            className="text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors tabular-nums"
          >
            {durationSec > 0
              ? showRemaining
                ? `−${formatDisplayTime(Math.max(0, durationSec - positionSec))}`
                : formatDisplayTime(durationSec)
              : "—"}
          </button>
        </div>
      </div>

      {/* Track info */}
      {trackName ? (
        <div className="flex items-center gap-3 min-w-0 px-1">
          {albumArtUrl && (
            <img
              src={albumArtUrl}
              alt={albumName}
              className="w-10 h-10 rounded shrink-0 object-cover"
            />
          )}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-zinc-100 truncate">{trackName}</span>
            <span className="text-xs text-zinc-400 truncate">{artistName}</span>
          </div>
        </div>
      ) : (
        <div className="h-10 flex items-center px-1">
          <span className="text-xs text-zinc-500">{t.spotifyConnected}</span>
        </div>
      )}

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

      {/* 곡 검색/열기 버튼 */}
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
      </div>

    </div>
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
