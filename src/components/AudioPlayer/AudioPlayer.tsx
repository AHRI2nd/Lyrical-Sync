import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
// 스펙트로그램 플러그인(~36KB)은 토글로 켰을 때만 필요 → 동적 임포트로 초기 번들에서 제외
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { toast } from "../../stores/useToastStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { audioControls } from "../../utils/audioControls";
import { readAudioBytes } from "../../utils/readAudioBytes";
import { activateSpotifyPlayer } from "../../utils/spotifyPlayer";
import { formatDisplayTime } from "../../utils/lrcParser";
import { ServicePlayerPanel } from "../Service/ServicePlayerPanel";
import { DevicePlayerPanel } from "../Service/DevicePlayerPanel";
import { TrackInfoHeader } from "./TrackInfoHeader";
import { SeekBar } from "./SeekBar";
import { NoTrackAlert } from "./NoTrackAlert";
import { useYouTubeLoad } from "./useYouTubeLoad";
import { TransportControls } from "./TransportControls";
// YouTube 모드일 때만 필요 → 지연 로드(초기 번들 절감)
const YouTubeModal = lazy(() => import("./YouTubeModal").then((m) => ({ default: m.YouTubeModal })));
import { VolumeIcon, ZoomIcon, FileGlyph, YouTubeGlyph, YouTubeLinkIcon } from "./icons";

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
  const spectrogramContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const peaksRef = useRef<number[] | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const isLoopingRef = useRef(false);
  const playbackRateRef = useRef(1.0);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlayingLocal] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [duration, setDurationLocal] = useState(0);
  const [currentTime, setCurrentTimeLocal] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(50); // 0–100, center=50
  const [volume, setVolume] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [viewMode, setViewMode] = useState<"waveform" | "bar">("waveform");
  const [showNoTrackAlert, setShowNoTrackAlert] = useState(false);

  // 자체 로컬 상태(currentTimeLocal 등)로 UI를 그리므로 스토어 currentTime은 구독하지 않음
  const { audioPath, setCurrentTime, setIsPlaying, setDuration, openAudio, setAudioPath } = useLrcStore(
    useShallow((s) => ({
      audioPath: s.audioPath, setCurrentTime: s.setCurrentTime, setIsPlaying: s.setIsPlaying,
      setDuration: s.setDuration, openAudio: s.openAudio, setAudioPath: s.setAudioPath,
    }))
  );
  const lines = useLrcStore((s) => s.doc.lines);
  const metadata = useLrcStore((s) => s.doc.metadata);
  const activeLineId = useLrcStore((s) => s.activeLineId);
  const [showMarkers, setShowMarkers] = useState(true);
  const { t } = useI18nStore();
  const { isLoggedIn, startLogin, fetchCurrentlyPlaying, transferPlaybackToApp } = useServiceStore();
  const {
    spotifyMode, spotifyClientId, youtubeMode, deviceMode,
    showSpectrogram, setShowSpectrogram,
  } = useSettingsStore();
  const isServiceMode = isLoggedIn && spotifyMode;

  const {
    ytUrl, ytLoading, ytError, ytModalOpen,
    setYtUrl, setYtError, setYtModalOpen,
    handleYtLoad, handleYtCancel, handleYtModalClose,
  } = useYouTubeLoad(setAudioPath);

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

    // Spotify/기기 감지 모드에선 로컬 파형이 전역 재생상태(currentTime/isPlaying/duration)를
    // 덮어쓰지 않도록 차단(해당 모드가 단일 소스). 로컬 UI 상태(*Local)는 항상 갱신.
    const inService = () => {
      const settings = useSettingsStore.getState();
      return (useServiceStore.getState().isLoggedIn && settings.spotifyMode) || settings.deviceMode;
    };

    ws.on("ready", () => {
      const d = ws.getDuration();
      setDurationLocal(d);
      if (!inService()) setDuration(d);
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
      if (!inService()) setCurrentTime(t);
      // 줄 반복: 반복 대상 줄의 구간(다음 스탬프 줄 시작, 없으면 끝까지) 끝에 닿으면
      // 줄 시작으로 되돌아감. 매 프레임 스토어에서 직접 읽어 클로저 staleness 회피.
      const { loopLineId, doc } = useLrcStore.getState();
      if (loopLineId) {
        const idx = doc.lines.findIndex((l) => l.id === loopLineId);
        const line = idx >= 0 ? doc.lines[idx] : null;
        if (line && line.timestamp !== null) {
          let end = ws.getDuration();
          for (let i = idx + 1; i < doc.lines.length; i++) {
            if (doc.lines[i].timestamp !== null) { end = doc.lines[i].timestamp as number; break; }
          }
          if (t >= end) {
            const d = ws.getDuration();
            if (d > 0) ws.seekTo(Math.max(0, Math.min(1, line.timestamp / d)));
          }
        }
      }
    });
    ws.on("seeking", (t) => {
      setCurrentTimeLocal(t);
      if (!inService()) setCurrentTime(t);
    });
    ws.on("play", () => { setIsPlayingLocal(true); if (!inService()) setIsPlaying(true); });
    ws.on("pause", () => { setIsPlayingLocal(false); if (!inService()) setIsPlaying(false); });
    ws.on("finish", () => {
      if (isLoopingRef.current) {
        ws.seekTo(0);
        ws.play();
      } else {
        setIsPlayingLocal(false);
        if (!inService()) setIsPlaying(false);
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
      if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
      const d = ws.getDuration();
      if (!d) return;
      const t = Math.max(0, Math.min(d, ws.getCurrentTime() + delta));
      ws.seekTo(t / d);
    };
    audioControls.stopAndReset = () => {
      const ws = wsRef.current;
      if (!ws) return;
      if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
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
    // Spotify/기기 감지 모드에서는 로컬 오디오를 재생하지 않는다. audioPath는 파일 모드
    // 때의 값이 모드 전환 후에도 스토어에 남아있을 수 있어(전환 시 일부러 안 지움 —
    // 파일 모드로 돌아오면 다시 쓰도록), 여기서 걸러야 크래시 복구 후 엉뚱한 파일을
    // 다시 로드 시도하는 걸 막을 수 있다.
    if (!wsRef.current || !audioPath || spotifyMode || deviceMode) return;
    let cancelled = false;

    setIsAudioReady(false);

    const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";

    readAudioBytes(audioPath).then(({ bytes, transcoded }) => {
      if (cancelled || !wsRef.current) return;

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

      const mimeType = transcoded ? "audio/wav" : (AUDIO_MIME[ext] ?? "audio/*");
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      return wsRef.current.load(url);
    }).catch((e) => {
      // 새 로드로 인한 중단(AbortError)은 무시, 실제 디코드/읽기 실패만 알림
      if (cancelled || (e && (e as Error).name === "AbortError")) return;
      toast.error(useI18nStore.getState().t.toast.audioLoadFailed);
    });

    return () => { cancelled = true; };
  }, [audioPath, spotifyMode, deviceMode]);

  // 오디오 열면 파일 태그(ID3 등)에서 메타데이터를 읽어 비어 있는 필드만 자동 채움
  useEffect(() => {
    // 위와 동일한 이유로 Spotify/기기 모드에서는 건너뜀 — 안 그러면 크래시 복구 후
    // 남아있던 예전 로컬 파일의 태그로 지금 작업 중인 문서의 메타데이터가 덮어써질 수 있다.
    if (!audioPath || spotifyMode || deviceMode) return;
    let cancelled = false;
    invoke<{ title: string; artist: string; album: string }>("read_audio_metadata", { path: audioPath })
      .then((m) => {
        if (cancelled) return;
        const cur = useLrcStore.getState().doc.metadata;
        const patch: { title?: string; artist?: string; album?: string } = {};
        if (!cur.title.trim() && m.title) patch.title = m.title;
        if (!cur.artist.trim() && m.artist) patch.artist = m.artist;
        if (!cur.album.trim() && m.album) patch.album = m.album;
        if (Object.keys(patch).length > 0) useLrcStore.getState().setMetadata(patch);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [audioPath, spotifyMode, deviceMode]);

  // 오디오 로드 완료 시 현재 zoom 값 적용 (슬라이더 조작 중 zoom은 debounce로 직접 처리)
  useEffect(() => {
    if (!wsRef.current || !isAudioReady) return;
    wsRef.current.zoom(zoomLevelToPixels(zoomLevel));
  }, [isAudioReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  // 마커는 줄 id·타임스탬프·줄번호(인덱스)에만 의존 → 텍스트 편집(타임스탬프 불변)으로는
  // region을 재생성하지 않도록 시그니처로 의존성을 좁힘(키 입력마다 전체 region 재생성 방지).
  const markerSig = useMemo(
    () => lines.map((l, i) => (l.timestamp !== null ? `${l.id}:${l.timestamp}:${i}` : "")).filter(Boolean).join("|"),
    [lines]
  );

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
    // lines/activeLineId는 closure 최신값 사용. markerSig(마커 위치 변경)에만 재생성 →
    // 활성 줄만 바뀔 땐 아래 별도 effect가 스타일만 토글(전체 region 재생성 회피).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerSig, isAudioReady, showMarkers]);

  // 활성 줄 변경: region을 다시 만들지 않고 색/라벨 스타일만 갱신
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !isAudioReady || !showMarkers) return;
    const activeRegionId = activeLineId ? `lyric:${activeLineId}` : null;
    regions.getRegions().forEach((r) => {
      const isActive = r.id === activeRegionId;
      r.setOptions({ color: isActive ? "#ea580c" : "rgba(217, 119, 6, 0.8)" });
      const label = r.element?.querySelector<HTMLElement>(".lyric-marker-num");
      if (label) {
        label.className = isActive ? "lyric-marker-num" : "lyric-marker-num dim";
        label.style.background = isActive ? "#ea580c" : "#b45309";
      }
    });
  }, [activeLineId, isAudioReady, showMarkers, markerSig]);

  // 스펙트로그램 플러그인(~36KB)은 켰을 때만 동적 임포트+생성(초기 번들·FFT 계산 낭비 방지),
  // 끄면 destroy()로 완전히 정리
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !showSpectrogram || !spectrogramContainerRef.current) return;
    let cancelled = false;
    let plugin: InstanceType<typeof import("wavesurfer.js/dist/plugins/spectrogram.esm.js").default> | null = null;
    import("wavesurfer.js/dist/plugins/spectrogram.esm.js").then(({ default: SpectrogramPlugin }) => {
      if (cancelled || !wsRef.current || !spectrogramContainerRef.current) return;
      plugin = wsRef.current.registerPlugin(
        SpectrogramPlugin.create({ container: spectrogramContainerRef.current, height: 80, labels: false, scale: "mel" })
      );
    });
    return () => {
      cancelled = true;
      plugin?.destroy();
    };
  }, [showSpectrogram]);

  const togglePlay = useCallback(() => wsRef.current?.playPause(), []);

  const skip = useCallback((delta: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
    const d = ws.getDuration();
    if (!d) return;
    const t = Math.max(0, Math.min(d, ws.getCurrentTime() + delta));
    ws.seekTo(t / d);
  }, []);

  const stopAndReset = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
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
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      {/* WaveSurfer container must always remain in the DOM while the component
          is mounted — removing it detaches the canvas and breaks the instance
          when switching back from Spotify mode. Hide with display:none instead. */}
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800 cursor-pointer"
        style={{ minHeight: 80, display: (isServiceMode || deviceMode || viewMode === "bar") ? "none" : "" }}
      />
      <div
        ref={spectrogramContainerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800"
        style={{ minHeight: 80, display: (isServiceMode || deviceMode || viewMode === "bar" || !showSpectrogram) ? "none" : "" }}
      />

      {isServiceMode ? (
        <ServicePlayerPanel
          onSpotifySearch={onSpotifySearch}
          onLoadCurrent={handleLoadCurrent}
        />
      ) : deviceMode ? (
        <DevicePlayerPanel />
      ) : (
      <>
      {viewMode === "bar" && (
        <TrackInfoHeader
          icon={youtubeMode ? <YouTubeGlyph /> : <FileGlyph />}
          iconBgClass={youtubeMode ? "bg-red-500/15 text-red-400" : "bg-indigo-500/15 text-indigo-300"}
          title={metadata.title || (audioPath ? (audioPath.split(/[\\/]/).pop() ?? "") : "")}
          subtitle={[metadata.artist, metadata.album].filter(Boolean).join(" · ")}
          emptyMessage={t.noAudioShort}
        />
      )}

      {viewMode === "bar" && (
        <SeekBar
          position={currentTime}
          duration={duration}
          onSeek={audioControls.seekTo}
          accentClass={youtubeMode ? "bg-red-500" : "bg-indigo-500"}
        />
      )}

      {/* 시간 표시 (파형 모드에서만) */}
      {viewMode === "waveform" && (
        <div className="flex justify-between text-xs text-zinc-400 font-mono px-1">
          <span>{formatDisplayTime(currentTime)}</span>
          <span>{formatDisplayTime(duration)}</span>
        </div>
      )}

      <TransportControls
        t={t}
        audioPath={audioPath}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        skip={skip}
        stopAndReset={stopAndReset}
        isLooping={isLooping}
        onToggleLoop={toggleLoop}
        showMarkers={showMarkers}
        onToggleMarkers={() => setShowMarkers((v) => !v)}
        showSpectrogram={showSpectrogram}
        onToggleSpectrogram={() => setShowSpectrogram(!showSpectrogram)}
        playbackRate={playbackRate}
        speedMin={SPEED_STEPS[0]}
        speedMax={SPEED_STEPS[SPEED_STEPS.length - 1]}
        onSpeedDown={() => adjustSpeed(-1)}
        onSpeedUp={() => adjustSpeed(1)}
      />

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

