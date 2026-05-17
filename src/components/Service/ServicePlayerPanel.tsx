import { useState } from "react";
import { useServiceStore } from "../../stores/useServiceStore";
import { serviceControls } from "../../utils/serviceControls";
import { formatDisplayTime } from "../../utils/lrcParser";
import { useI18nStore } from "../../stores/useI18nStore";

export function ServicePlayerPanel() {
  const { t } = useI18nStore();
  const {
    isPlaying, positionMs, durationMs,
    trackName, artistName, albumName, albumArtUrl,
  } = useServiceStore();

  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);

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

      {/* Row 1: skip + play */}
      <div className="flex items-center justify-center gap-1.5">
        <CtrlBtn onClick={() => serviceControls.skip(-5)} title={t.tooltipSkipBack5}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
        </CtrlBtn>
        <CtrlBtn onClick={() => serviceControls.skip(-1)} title={t.tooltipSkipBack1}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
        </CtrlBtn>
        <CtrlBtn onClick={() => serviceControls.togglePlay()} title={t.tooltipPlayPause} accent>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </CtrlBtn>
        <CtrlBtn onClick={() => serviceControls.skip(1)} title={t.tooltipSkipFwd1}>
          <span className="text-[10px] font-bold mr-0.5">1</span><SkipFwdIcon />
        </CtrlBtn>
        <CtrlBtn onClick={() => serviceControls.skip(5)} title={t.tooltipSkipFwd5}>
          <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
        </CtrlBtn>
      </div>

      {/* Row 2: stop */}
      <div className="flex items-center justify-center gap-1.5">
        <CtrlBtn onClick={() => serviceControls.stopAndReset()} title={t.tooltipStop}>
          <StopIcon />
        </CtrlBtn>
      </div>

    </div>
  );
}

function CtrlBtn({
  onClick, title, children, accent,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        "h-9 px-3 rounded-lg flex items-center justify-center text-sm transition-colors",
        accent
          ? "bg-green-600 hover:bg-green-500 active:bg-green-700 text-white px-5 shadow-md"
          : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200",
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
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>;
}
function SkipFwdIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" /></svg>;
}
