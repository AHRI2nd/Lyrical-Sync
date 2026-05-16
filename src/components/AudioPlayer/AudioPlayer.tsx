import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { audioControls } from "../../utils/audioControls";
import { formatDisplayTime } from "../../utils/lrcParser";

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
  ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", opus: "audio/ogg",
  aiff: "audio/aiff", aif: "audio/aiff",
};

const SPEED_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function AudioPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const isLoopingRef = useRef(false);
  const playbackRateRef = useRef(1.0);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isSeeking = useRef(false);
  const [isPlaying, setIsPlayingLocal] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [duration, setDurationLocal] = useState(0);
  const [currentTime, setCurrentTimeLocal] = useState(0);
  const [zoom, setZoom] = useState(50);
  const [volume, setVolume] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [viewMode, setViewMode] = useState<"waveform" | "bar">("waveform");
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);

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
    // Windows의 가로 스크롤바가 파형 하단을 가리는 문제 방지
    ws.getWrapper().classList.add("ws-scroll");

    ws.on("ready", () => {
      const d = ws.getDuration();
      setDurationLocal(d);
      setDuration(d);
      setIsAudioReady(true);
      // 새 오디오 로드 시 미디어 엘리먼트가 배속을 1.0으로 초기화하므로 재적용
      if (playbackRateRef.current !== 1.0) {
        ws.setPlaybackRate(playbackRateRef.current);
      }
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

    const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
    const isAiff = ext === "aiff" || ext === "aif";
    // AIFF transcoding is only needed for Windows WebView2 (macOS supports AIFF natively).
    // Also, on macOS the temp dir (/var/folders/…) is outside $HOME so readFile would fail.
    const isWindows = navigator.platform.startsWith("Win");
    const needsTranscode = isAiff && isWindows;

    const getBytes = (): Promise<Uint8Array> => {
      if (needsTranscode) {
        return invoke<string>("decode_audio_to_wav", { path: audioPath })
          .then((wavPath) => readFile(wavPath));
      }
      return readFile(audioPath);
    };

    getBytes().then((bytes) => {
      if (cancelled || !wsRef.current) return;

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

      const mimeType = needsTranscode ? "audio/wav" : (AUDIO_MIME[ext] ?? "audio/*");
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      wsRef.current.load(url);
    }).catch(console.error);

    return () => { cancelled = true; };
  }, [audioPath]);

  // 오디오 로드 완료 시 현재 zoom 값 적용 (슬라이더 조작 중 zoom은 debounce로 직접 처리)
  useEffect(() => {
    if (!wsRef.current || !isAudioReady) return;
    wsRef.current.zoom(zoom);
  }, [isAudioReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  const progress = duration > 0 ? currentTime / duration : 0;

  const seekToRatio = useCallback((clientX: number) => {
    if (!seekBarRef.current || !duration) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audioControls.seekTo(ratio * duration);
  }, [duration]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (isSeeking.current) seekToRatio(e.clientX); };
    const onUp = () => { isSeeking.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [seekToRatio]);

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
      if (next !== prev) {
        playbackRateRef.current = next;
        wsRef.current?.setPlaybackRate(next);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800 cursor-pointer"
        style={{ minHeight: 80, display: viewMode === "bar" ? "none" : "" }}
      />

      {viewMode === "bar" && (
        <div
          className="w-full rounded-xl bg-zinc-800 select-none flex flex-col justify-center px-5"
          style={{ minHeight: 80, paddingTop: 14, paddingBottom: 14, gap: 10 }}
        >
          {/* 트랙 영역 */}
          <div
            ref={seekBarRef}
            className="relative group cursor-pointer"
            style={{ paddingTop: 6, paddingBottom: 6 }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHoverRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            }}
            onMouseLeave={() => setHoverRatio(null)}
            onMouseDown={(e) => {
              e.preventDefault();
              isSeeking.current = true;
              seekToRatio(e.clientX);
            }}
          >
            {/* 호버 시간 툴팁 */}
            {hoverRatio !== null && duration > 0 && (
              <div
                className="absolute font-mono text-[10px] bg-zinc-700 text-zinc-200 px-1.5 py-0.5 rounded pointer-events-none -translate-x-1/2 whitespace-nowrap z-10"
                style={{
                  bottom: "calc(100% - 2px)",
                  left: `${Math.max(8, Math.min(92, hoverRatio * 100))}%`,
                }}
              >
                {formatDisplayTime(hoverRatio * duration)}
              </div>
            )}

            {/* 트랙 */}
            <div
              className="rounded-full relative transition-all duration-150 bg-zinc-700"
              style={{ height: hoverRatio !== null ? 6 : 4, overflow: "visible" }}
            >
              {/* 호버 위치 미리보기 */}
              {hoverRatio !== null && (
                <div
                  className="absolute inset-y-0 left-0 bg-zinc-500 rounded-full"
                  style={{ width: `${hoverRatio * 100}%` }}
                />
              )}
              {/* 재생 진행 */}
              <div
                className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full"
                style={{ width: `${progress * 100}%` }}
              />
              {/* 썸 */}
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg border-2 border-indigo-400 transition-all duration-150"
                style={{
                  width: hoverRatio !== null ? 14 : 10,
                  height: hoverRatio !== null ? 14 : 10,
                  left: `calc(${progress * 100}% - ${hoverRatio !== null ? 7 : 5}px)`,
                  opacity: hoverRatio !== null ? 1 : 0.7,
                }}
              />
            </div>
          </div>

          {/* 시간 표시 */}
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-zinc-300 tabular-nums">
              {formatDisplayTime(currentTime)}
            </span>
            <button
              onClick={() => setShowRemaining((p) => !p)}
              className="text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors tabular-nums"
            >
              {duration > 0
                ? showRemaining
                  ? `−${formatDisplayTime(Math.max(0, duration - currentTime))}`
                  : formatDisplayTime(duration)
                : "—"}
            </button>
          </div>
        </div>
      )}

      {/* 시간 표시 (파형 모드에서만) */}
      {viewMode === "waveform" && (
        <div className="flex justify-between text-xs text-zinc-400 font-mono px-1">
          <span>{formatDisplayTime(currentTime)}</span>
          <span>{formatDisplayTime(duration)}</span>
        </div>
      )}

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

      {/* 열기 버튼 */}
      <button
        onClick={openAudio}
        className="w-full py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm transition-colors text-center truncate"
      >
        {t.openAudio}
      </button>

      {/* 볼륨 + 줌 슬라이더: grid로 왼쪽 열 너비 자동 통일 */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "auto 1fr" }}>
        <span className="text-xs text-zinc-400 text-right self-center pr-2">
          {t.volume} <span className="tabular-nums">{Math.round(volume * 100)}%</span>
        </span>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => setVolume(parseFloat(Number(e.target.value).toFixed(2)))}
          className="min-w-0 accent-indigo-500"
        />

        <div className="flex shrink-0 bg-zinc-800 rounded-lg p-0.5 self-center">
          <button
            onClick={() => setViewMode("waveform")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "waveform" ? "bg-zinc-600 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.tooltipViewWaveform}
          </button>
          <button
            onClick={() => setViewMode("bar")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "bar" ? "bg-zinc-600 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.tooltipViewSeekBar}
          </button>
        </div>
        {viewMode === "waveform" ? (
          <input
            type="range" min={10} max={500} value={zoom}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoom(v);
              if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
              zoomDebounceRef.current = setTimeout(() => {
                if (wsRef.current && isAudioReady) wsRef.current.zoom(v);
              }, 80);
            }}
            className="min-w-0 accent-indigo-500"
          />
        ) : (
          <div />
        )}
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

