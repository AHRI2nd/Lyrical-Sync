import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { type Translations } from "../../i18n/translations";
import { useServiceStore } from "../../stores/useServiceStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { audioControls } from "../../utils/audioControls";
import { activateSpotifyPlayer } from "../../utils/spotifyPlayer";
import { safeUnlisten } from "../../utils/safeUnlisten";
import { formatDisplayTime } from "../../utils/lrcParser";
import { ServicePlayerPanel } from "../Service/ServicePlayerPanel";

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
  ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", opus: "audio/ogg",
  aiff: "audio/aiff", aif: "audio/aiff",
};

const SPEED_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

// Zoom slider uses a logarithmic scale so that equal slider movements produce
// equal *ratios* of zoom change (better UX) and the default sits exactly at
// the visual center (level 50 out of 0–100).
//   level=0   → 10 px/s  (zoomed out)
//   level=50  → ~71 px/s (default, center)
//   level=100 → 500 px/s (zoomed in)
const ZOOM_PX_MIN = 10;
const ZOOM_PX_MAX = 500;
const zoomLevelToPixels = (level: number) =>
  Math.round(ZOOM_PX_MIN * Math.pow(ZOOM_PX_MAX / ZOOM_PX_MIN, level / 100));

interface AudioPlayerProps {
  onSpotifySearch?: () => void;
  onSpotifyNoClientId?: () => void;
}

export function AudioPlayer({ onSpotifySearch, onSpotifyNoClientId }: AudioPlayerProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const peaksRef = useRef<number[] | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const isLoopingRef = useRef(false);
  const playbackRateRef = useRef(1.0);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const isSeeking = useRef(false);
  const [isPlaying, setIsPlayingLocal] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [duration, setDurationLocal] = useState(0);
  const [currentTime, setCurrentTimeLocal] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(50); // 0–100, center=50
  const [volume, setVolume] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [viewMode, setViewMode] = useState<"waveform" | "bar">("waveform");
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const [showNoTrackAlert, setShowNoTrackAlert] = useState(false);

  // 자체 로컬 상태(currentTimeLocal 등)로 UI를 그리므로 스토어 currentTime은 구독하지 않음
  const { audioPath, setCurrentTime, setIsPlaying, setDuration, openAudio, setAudioPath } = useLrcStore(
    useShallow((s) => ({
      audioPath: s.audioPath, setCurrentTime: s.setCurrentTime, setIsPlaying: s.setIsPlaying,
      setDuration: s.setDuration, openAudio: s.openAudio, setAudioPath: s.setAudioPath,
    }))
  );
  const lines = useLrcStore((s) => s.doc.lines);
  const activeLineId = useLrcStore((s) => s.activeLineId);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const { t } = useI18nStore();
  const { isLoggedIn, startLogin, fetchCurrentlyPlaying, transferPlaybackToApp } = useServiceStore();
  const { spotifyMode, spotifyClientId, youtubeMode, ytdlpAudioQuality, ytdlpCookiesFile, ytdlpProxy } = useSettingsStore();
  const isServiceMode = isLoggedIn && spotifyMode;

  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytModalOpen, setYtModalOpen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ percent: number; speed: string; eta: string; done: boolean }>(
      "ytdlp-audio-progress",
      (e) => {
        if (e.payload.done) setYtLoading(false);
      }
    ).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { safeUnlisten(unlisten); };
  }, []);

  const handleYtLoad = async () => {
    const url = ytUrl.trim();
    if (!url) return;
    setYtLoading(true);
    setYtError(null);
    try {
      const path = await invoke<string>("ytdlp_load_audio", {
        url,
        quality: ytdlpAudioQuality,
        cookiesFile: ytdlpCookiesFile,
        proxy: ytdlpProxy,
      });
      setAudioPath(path);
      setYtModalOpen(false);
      setYtUrl("");
    } catch (e) {
      setYtError(String(e));
    } finally {
      setYtLoading(false);
    }
  };

  const handleYtCancel = () => {
    invoke("cancel_ytdlp_load").catch(() => {});
    setYtLoading(false);
  };

  const handleYtModalClose = () => {
    if (ytLoading) return;
    setYtModalOpen(false);
    setYtError(null);
  };

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

    // 가사 타임스탬프 마커 플러그인
    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;

    // 파형의 가사 마커 클릭 → 해당 줄 선택 (에디터가 activeLineId 변경에 따라 자동 스크롤)
    regions.on("region-clicked", (region, e) => {
      if (typeof region.id === "string" && region.id.startsWith("lyric:")) {
        e.stopPropagation(); // 파형 탐색(시크) 방지
        useLrcStore.getState().setActiveLineId(region.id.slice("lyric:".length));
      }
    });

    ws.on("ready", () => {
      const d = ws.getDuration();
      setDurationLocal(d);
      setDuration(d);
      setIsAudioReady(true);
      // 글자 동기화 레인 파형용 정규화 peaks 캐시
      try {
        peaksRef.current = ws.exportPeaks({ channels: 1, maxLength: 4000 })[0] ?? null;
      } catch {
        peaksRef.current = null;
      }
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
    audioControls.pause = () => wsRef.current?.pause();
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
    audioControls.getPeaks = () => peaksRef.current;
    audioControls.seekTo = (seconds: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const d = ws.getDuration();
      if (!d) return;
      ws.seekTo(Math.max(0, Math.min(1, seconds / d)));
    };
  });

  const blobUrlRef = useRef<string | null>(null);

  // 언마운트 시 마지막 Blob URL 해제 (경로 변경 시엔 아래 로드 effect가 직전 URL을 해제)
  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

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

    const getBytes = async (): Promise<Uint8Array> => {
      // Windows AIFF는 임시 WAV로 트랜스코딩(임시 폴더는 fs 스코프 밖)
      const path = needsTranscode
        ? await invoke<string>("decode_audio_to_wav", { path: audioPath })
        : audioPath;
      try {
        // 빠른 경로: fs 스코프(미디어 디렉터리) 내 파일은 plugin readFile (바이너리 채널)
        return await readFile(path);
      } catch {
        // 스코프 밖 파일(임시 폴더, 외장 드라이브 등)은 거부되므로
        // 스코프 제약이 없는 커스텀 커맨드로 폴백 (raw 바이너리 반환)
        const buf = await invoke<ArrayBuffer>("read_audio_file", { path });
        return new Uint8Array(buf);
      }
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
    wsRef.current.zoom(zoomLevelToPixels(zoomLevel));
  }, [isAudioReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  // 보조기능 오버플로우(⋯) 바깥 클릭 시 닫기
  useEffect(() => {
    if (!showMore) return;
    const h = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showMore]);

  // 가사 타임스탬프 마커를 파형에 동기화
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !isAudioReady) return;
    regions.clearRegions();
    if (!showMarkers) return;
    // 마커는 순수 시각 표시 — 파형 클릭(탐색)을 가로막지 않도록 pointer-events 해제하되,
    // 가사 마커만 clickable로 두어 클릭 시 해당 줄을 선택할 수 있게 함.
    lines.forEach((l, i) => {
      if (l.timestamp === null) return;
      const isActive = l.id === activeLineId;
      const r = regions.addRegion({
        id: `lyric:${l.id}`,
        start: l.timestamp,
        color: isActive ? "#ea580c" : "rgba(217, 119, 6, 0.8)",
        drag: false,
        resize: false,
      });
      if (r.element) {
        r.element.style.pointerEvents = "auto";
        r.element.style.cursor = "pointer";
        r.element.style.overflow = "visible";
        r.element.classList.add("lyric-marker");
        // 상단에 줄 번호(에디터 행 번호와 동일, 1-based). 활성 줄은 항상,
        // 비활성 줄은 겹침 방지를 위해 마커 호버 시에만 표시.
        const label = document.createElement("div");
        label.textContent = String(i + 1);
        label.className = isActive ? "lyric-marker-num" : "lyric-marker-num dim";
        label.style.cssText = [
          "position:absolute", "top:0", "left:50%", "transform:translateX(-50%)",
          "font:600 9px ui-monospace,SFMono-Regular,monospace", "line-height:1.4",
          "padding:0 3px", "border-radius:0 0 3px 3px", "color:#fff",
          `background:${isActive ? "#ea580c" : "#b45309"}`,
          "pointer-events:none", "white-space:nowrap", "z-index:5",
        ].join(";");
        r.element.appendChild(label);
      }
    });
  }, [lines, activeLineId, isAudioReady, showMarkers]);

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

  const handleSpotifyLogin = async () => {
    if (!spotifyClientId.trim()) {
      onSpotifyNoClientId?.();
      return;
    }
    try { await startLogin(); } catch { /* error shown in settings */ }
  };

  const handleLoadCurrent = async () => {
    try {
      const track = await fetchCurrentlyPlaying();
      if (track) {
        await activateSpotifyPlayer(); // 사용자 제스처에서 오디오 잠금 해제(SDK 기기로 재생 위함)
        await transferPlaybackToApp();
      } else setShowNoTrackAlert(true);
    } catch { setShowNoTrackAlert(true); }
  };

  return (
    <>
      {showNoTrackAlert && (
        <NoTrackAlert t={t} onClose={() => setShowNoTrackAlert(false)} />
      )}
      {ytModalOpen && (
        <YouTubeModal
          t={t}
          ytUrl={ytUrl}
          ytLoading={ytLoading}
          ytError={ytError}
          onChangeUrl={(v) => { setYtUrl(v); setYtError(null); }}
          onLoad={handleYtLoad}
          onCancel={handleYtCancel}
          onClose={handleYtModalClose}
        />
      )}
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      {/* WaveSurfer container must always remain in the DOM while the component
          is mounted — removing it detaches the canvas and breaks the instance
          when switching back from Spotify mode. Hide with display:none instead. */}
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800 cursor-pointer"
        style={{ minHeight: 80, display: (isServiceMode || viewMode === "bar") ? "none" : "" }}
      />

      {isServiceMode ? (
        <ServicePlayerPanel
          onSpotifySearch={onSpotifySearch}
          onLoadCurrent={handleLoadCurrent}
        />
      ) : (
      <>
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

      {/* 재생 컨트롤 한 줄: 정지(좌) · 전송(중앙) · 더보기(우). relative를 행 전체에
          두어 팝오버가 좁은 카드 폭(우측 정렬) 안에 들어오게 함 */}
      <div className="relative flex items-center gap-0.5" ref={moreRef}>
        <CtrlBtn onClick={stopAndReset} title={t.tooltipStop}>
          <StopIcon />
        </CtrlBtn>

        <div className="flex-1 flex items-center justify-center gap-0.5">
          <CtrlBtn onClick={() => skip(-5)} title={t.tooltipSkipBack5}>
            <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
          </CtrlBtn>
          <CtrlBtn onClick={() => skip(-1)} title={t.tooltipSkipBack1}>
            <TriLeftIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
          </CtrlBtn>
          <CtrlBtn onClick={togglePlay} disabled={!audioPath} title={t.tooltipPlayPause} accent>
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </CtrlBtn>
          <CtrlBtn onClick={() => skip(1)} title={t.tooltipSkipFwd1}>
            <span className="text-[10px] font-bold mr-0.5">1</span><TriRightIcon />
          </CtrlBtn>
          <CtrlBtn onClick={() => skip(5)} title={t.tooltipSkipFwd5}>
            <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
          </CtrlBtn>
        </div>

        <CtrlBtn
          onClick={() => setShowMore((v) => !v)}
          title={t.playerMore}
          active={showMore || isLooping || playbackRate !== 1.0}
        >
          <MoreIcon />
        </CtrlBtn>
        {showMore && (
          <div className="absolute right-0 bottom-full mb-2 z-40 w-56 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-300">{t.tooltipLoop}</span>
                <button onClick={toggleLoop} className={popToggleCls(isLooping)} title={t.tooltipLoop}>
                  <LoopIcon />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-300">{t.tooltipMarkers}</span>
                <button onClick={() => setShowMarkers((v) => !v)} className={popToggleCls(showMarkers)} title={t.tooltipMarkers}>
                  <MarkerIcon />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-300">{t.playerSpeed}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => adjustSpeed(-1)}
                    disabled={playbackRate <= SPEED_STEPS[0]}
                    className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-zinc-200 text-sm font-bold leading-none transition-colors"
                  >−</button>
                  <span className="w-12 text-center text-xs font-mono text-zinc-200 tabular-nums">{playbackRate.toFixed(2)}×</span>
                  <button
                    onClick={() => adjustSpeed(1)}
                    disabled={playbackRate >= SPEED_STEPS[SPEED_STEPS.length - 1]}
                    className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-zinc-200 text-sm font-bold leading-none transition-colors"
                  >+</button>
                </div>
              </div>
            </div>
          )}
        </div>

      {/* 열기 버튼 */}
      {spotifyMode ? (
        !isLoggedIn ? (
          <button
            onClick={handleSpotifyLogin}
            className="w-full py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm transition-colors text-center truncate"
          >
            {t.spotifyConnect}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleLoadCurrent}
              className="flex-1 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm transition-colors text-center truncate"
            >
              {t.spotifyLoadCurrent}
            </button>
            <button
              onClick={onSpotifySearch}
              className="flex-1 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm transition-colors text-center truncate"
            >
              {t.spotifySearchTrack}
            </button>
          </div>
        )
      ) : youtubeMode ? (
        <button
          onClick={() => setYtModalOpen(true)}
          className="w-full py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm transition-colors text-center truncate flex items-center justify-center gap-2"
        >
          <YouTubeLinkIcon />
          {ytLoading ? t.youtubeLoading : t.youtubeOpenLink}
        </button>
      ) : (
        <button
          onClick={openAudio}
          className="w-full py-2 rounded-lg border border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-300 text-sm transition-colors text-center truncate"
        >
          {t.openAudio}
        </button>
      )}

      {/* 볼륨 (스피커 아이콘 + 슬림 슬라이더) */}
      <div className="flex items-center gap-2.5 text-zinc-400" title={`${t.volume} ${Math.round(volume * 100)}%`}>
        <span className="shrink-0"><VolumeIcon /></span>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => setVolume(parseFloat(Number(e.target.value).toFixed(2)))}
          className="range-slim min-w-0 flex-1"
          style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(volume * 100)}%, #3f3f46 ${Math.round(volume * 100)}%)` }}
        />
        <span className="shrink-0 w-9 text-right text-xs text-zinc-400 tabular-nums">{Math.round(volume * 100)}%</span>
      </div>

      {/* 줌 + 뷰 토글 */}
      <div className="flex items-center gap-2.5 text-zinc-400">
        {viewMode === "waveform" ? (
          <>
            <span className="shrink-0"><ZoomIcon /></span>
            <input
              type="range" min={0} max={100} value={zoomLevel}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomLevel(v);
                if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
                zoomDebounceRef.current = setTimeout(() => {
                  if (wsRef.current && isAudioReady) wsRef.current.zoom(zoomLevelToPixels(v));
                }, 80);
              }}
              className="range-slim min-w-0 flex-1"
              style={{ background: `linear-gradient(to right, #6366f1 ${zoomLevel}%, #3f3f46 ${zoomLevel}%)` }}
            />
          </>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex shrink-0 bg-zinc-800 rounded-lg p-0.5">
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
      </div>

      {!audioPath && (
        <p className="text-center text-zinc-500 text-sm">{t.noAudio}</p>
      )}
      </>
      )}
    </div>
    </>
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
        "flex items-center justify-center text-sm transition-colors",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        accent
          ? "w-9 h-9 rounded-full bg-indigo-500 hover:bg-indigo-400 active:bg-indigo-600 text-white"
          : active
            ? "h-9 px-2 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
            : "h-9 px-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white",
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
  // 채워진 이중 삼각형 (◀◀ 되감기)
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 6 L11 18 L4 12 Z M18 6 L18 18 L11 12 Z" />
    </svg>
  );
}


function SkipFwdIcon() {
  // 채워진 이중 삼각형 (▶▶ 빨리감기)
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6 L6 18 L13 12 Z M13 6 L13 18 L20 12 Z" />
    </svg>
  );
}

function TriLeftIcon() {
  // 채워진 홑 삼각형 (◀ ±1)
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15 6 L15 18 L7 12 Z" />
    </svg>
  );
}

function TriRightIcon() {
  // 채워진 홑 삼각형 (▶ ±1)
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 6 L9 18 L17 12 Z" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="6" />
      <line x1="20" y1="20" x2="15" y2="15" />
      <line x1="10" y1="7" x2="10" y2="13" />
      <line x1="7" y1="10" x2="13" y2="10" />
    </svg>
  );
}

function MarkerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="4" x2="6" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="18" y1="4" x2="18" y2="20" />
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

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

// 오버플로우 팝오버 내 토글 버튼 스타일
function popToggleCls(active: boolean): string {
  return [
    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
    active ? "bg-indigo-500 text-white hover:bg-indigo-400" : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600",
  ].join(" ");
}

function YouTubeLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function YouTubeModal({
  t, ytUrl, ytLoading, ytError,
  onChangeUrl, onLoad, onCancel, onClose,
}: {
  t: Translations;
  ytUrl: string;
  ytLoading: boolean;
  ytError: string | null;
  onChangeUrl: (v: string) => void;
  onLoad: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ytLoading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ytLoading, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-red-500"><YouTubeLinkIcon /></span>
            <span className="font-semibold text-zinc-100 text-sm">{t.youtubeModalTitle}</span>
          </div>
          {!ytLoading && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={ytUrl}
              onChange={(e) => onChangeUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !ytLoading && ytUrl.trim()) onLoad(); }}
              placeholder={t.youtubeUrlPlaceholder}
              disabled={ytLoading}
              autoFocus
              className="flex-1 min-w-0 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono disabled:opacity-50"
            />
          </div>

          {ytLoading && (
            <span className="text-xs text-zinc-400">{t.youtubeLoading}</span>
          )}

          {ytError && (
            <span className="text-xs text-red-400 break-all">{ytError}</span>
          )}

          <div className="flex justify-end gap-2">
            {ytLoading ? (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
              >
                {t.youtubeCancel}
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                >
                  {t.youtubeCancel}
                </button>
                <button
                  onClick={onLoad}
                  disabled={!ytUrl.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {t.youtubeLoad}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NoTrackAlert({ t, onClose }: { t: Translations; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.spotifyNoTrackAlertTitle}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300 whitespace-pre-line">{t.spotifyNoTrackAlertMessage}</p>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onClose}
            className="px-5 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
          >
            {t.spotifyNoTrackAlertOk}
          </button>
        </div>
      </div>
    </div>
  );
}

