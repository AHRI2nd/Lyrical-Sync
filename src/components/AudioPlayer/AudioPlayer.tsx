import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { readFile } from "@tauri-apps/plugin-fs";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { audioControls } from "../../utils/audioControls";
import { formatDisplayTime } from "../../utils/lrcParser";

const SPEED_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function AudioPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const isLoopingRef = useRef(false);
  const [isPlaying, setIsPlayingLocal] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [duration, setDurationLocal] = useState(0);
  const [currentTime, setCurrentTimeLocal] = useState(0);
  const [zoom, setZoom] = useState(50);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  const { audioPath, setCurrentTime, setIsPlaying, setDuration, openAudio } = useLrcStore();
  const { t } = useI18nStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#6366f1",
      progressColor: "#a5b4fc",
      cursorColor: "#f43f5e",
      height: 80,
      normalize: true,
      interact: true,
    });

    ws.on("ready", () => {
      const d = ws.getDuration();
      setDurationLocal(d);
      setDuration(d);
      setIsAudioReady(true);
    });
    ws.on("audioprocess", (t) => {
      setCurrentTimeLocal(t);
      setCurrentTime(t);
    });
    ws.on("seeking", (t) => {
      setCurrentTimeLocal(t);
      setCurrentTime(t);
    });
    ws.on("play", () => { setIsPlaying(true); setIsPlayingLocal(true); });
    ws.on("pause", () => { setIsPlaying(false); setIsPlayingLocal(false); });
    ws.on("finish", () => {
      if (isLoopingRef.current) {
        ws.seekTo(0);
        ws.play();
      } else {
        setIsPlaying(false);
        setIsPlayingLocal(false);
      }
    });

    wsRef.current = ws;
    return () => ws.destroy();
  }, [setCurrentTime]);

  useEffect(() => {
    audioControls.togglePlay = () => wsRef.current?.playPause();
    audioControls.skip = (delta: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const d = ws.getDuration();
      if (!d) return;
      const t = Math.max(0, Math.min(d, ws.getCurrentTime() + delta));
      ws.seekTo(t / d);
    };
    audioControls.stopAndReset = () => {
      const ws = wsRef.current;
      if (!ws) return;
      ws.pause();
      ws.seekTo(0);
      setCurrentTimeLocal(0);
      setCurrentTime(0);
    };
    audioControls.seekTo = (seconds: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const d = ws.getDuration();
      if (!d) return;
      ws.seekTo(Math.max(0, Math.min(1, seconds / d)));
    };
  });

  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!wsRef.current || !audioPath) return;
    let cancelled = false;

    setIsAudioReady(false);

    readFile(audioPath).then((bytes) => {
      if (cancelled || !wsRef.current) return;

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

      const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
      const mime: Record<string, string> = {
        mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
        ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", opus: "audio/ogg",
        aiff: "audio/aiff", aif: "audio/aiff",
      };
      const blob = new Blob([bytes], { type: mime[ext] ?? "audio/*" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      wsRef.current.load(url);
    }).catch(console.error);

    return () => { cancelled = true; };
  }, [audioPath]);

  useEffect(() => {
    if (!wsRef.current || !isAudioReady) return;
    wsRef.current.zoom(zoom);
  }, [zoom, isAudioReady]);

  useEffect(() => {
    wsRef.current?.setPlaybackRate(playbackRate);
  }, [playbackRate]);

  const togglePlay = useCallback(() => wsRef.current?.playPause(), []);

  const skip = useCallback((delta: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    const d = ws.getDuration();
    if (!d) return;
    const t = Math.max(0, Math.min(d, ws.getCurrentTime() + delta));
    ws.seekTo(t / d);
  }, []);

  const stopAndReset = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.pause();
    ws.seekTo(0);
    setCurrentTimeLocal(0);
    setCurrentTime(0);
  }, [setCurrentTime]);

  const toggleLoop = useCallback(() => {
    setIsLooping((prev) => {
      isLoopingRef.current = !prev;
      return !prev;
    });
  }, []);

  const adjustSpeed = useCallback((dir: 1 | -1) => {
    setPlaybackRate((prev) => {
      const idx = SPEED_STEPS.indexOf(prev);
      const next = idx === -1
        ? 1.0
        : SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + dir))];
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800 cursor-pointer"
        style={{ minHeight: 80 }}
      />

      {/* 시간 표시 */}
      <div className="flex justify-between text-xs text-zinc-400 font-mono px-1">
        <span>{formatDisplayTime(currentTime)}</span>
        <span>{formatDisplayTime(duration)}</span>
      </div>

      {/* Row 1: 스킵 + 재생 */}
      <div className="flex items-center justify-center gap-1.5">
        <CtrlBtn onClick={() => skip(-5)} title={t.tooltipSkipBack5}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(-1)} title={t.tooltipSkipBack1}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
        </CtrlBtn>
        <CtrlBtn
          onClick={togglePlay}
          disabled={!audioPath}
          title={t.tooltipPlayPause}
          accent
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(1)} title={t.tooltipSkipFwd1}>
          <span className="text-[10px] font-bold mr-0.5">1</span><SkipFwdIcon />
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(5)} title={t.tooltipSkipFwd5}>
          <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
        </CtrlBtn>
      </div>

      {/* Row 2: 정지 + 반복 + 배속 */}
      <div className="flex items-center justify-center gap-1.5">
        <CtrlBtn onClick={stopAndReset} title={t.tooltipStop}>
          <StopIcon />
        </CtrlBtn>
        <CtrlBtn onClick={toggleLoop} title={t.tooltipLoop} active={isLooping}>
          <LoopIcon />
        </CtrlBtn>

        <div className="flex items-center gap-1 ml-1">
          <CtrlBtn
            onClick={() => adjustSpeed(-1)}
            title={t.tooltipSpeedDown}
            disabled={playbackRate <= SPEED_STEPS[0]}
          >
            <span className="text-sm font-bold leading-none">−</span>
          </CtrlBtn>
          <div className="w-14 h-9 rounded-lg bg-zinc-800 border border-zinc-600 flex items-center justify-center select-none">
            <span className="text-xs font-mono text-zinc-200 tabular-nums">
              {playbackRate.toFixed(2)}×
            </span>
          </div>
          <CtrlBtn
            onClick={() => adjustSpeed(1)}
            title={t.tooltipSpeedUp}
            disabled={playbackRate >= SPEED_STEPS[SPEED_STEPS.length - 1]}
          >
            <span className="text-sm font-bold leading-none">+</span>
          </CtrlBtn>
        </div>
      </div>

      {/* 줌 + 열기 */}
      <div className="flex items-center gap-3">
        <button
          onClick={openAudio}
          className="w-28 shrink-0 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm transition-colors text-center truncate"
        >
          {t.openAudio}
        </button>
        <label className="w-10 shrink-0 text-xs text-zinc-400 text-right">{t.zoom}</label>
        <input
          type="range" min={10} max={500} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1 min-w-0 accent-indigo-500"
        />
      </div>

      {!audioPath && (
        <p className="text-center text-zinc-500 text-sm">{t.noAudio}</p>
      )}
    </div>
  );
}

function CtrlBtn({
  onClick, title, children, active, accent, disabled,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={[
        "h-9 px-3 rounded-lg flex items-center justify-center text-sm transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        accent
          ? "bg-indigo-500 hover:bg-indigo-400 active:bg-indigo-600 text-white px-5 shadow-md"
          : active
            ? "bg-indigo-500 hover:bg-indigo-400 text-white"
            : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

function SkipFwdIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  );
}
