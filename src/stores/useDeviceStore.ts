import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "./useLrcStore";
import { useSettingsStore } from "./useSettingsStore";
import { useI18nStore } from "./useI18nStore";
import { toast } from "./useToastStore";

// Windows SMTC(System Media Transport Controls)로 이 PC에서 재생 중인 미디어를
// 소스 앱 무관하게(Spotify 데스크톱, Apple Music, 브라우저 재생 등) 감지.
// Spotify 원격 제어(useServiceStore)와 동일한 폴링+보간 패턴을 따름.

interface NowPlayingInfo {
  title: string;
  artist: string;
  album: string;
  position_ms: number;
  duration_ms: number;
  is_playing: boolean;
  source_app: string;
  last_updated_unix_ms: number;
}

interface DeviceState {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  trackName: string;
  artistName: string;
  albumName: string;
  sourceApp: string;
  hasSession: boolean; // 감지된 세션이 있는지(재생 중이 아니어도 트랙 정보가 있으면 true)
  _lastKnownPositionMs: number;
  _lastStateTimestamp: number;

  startPolling: () => void;
  stopPolling: () => void;
  _startInterpolation: () => void;
  _stopInterpolation: () => void;
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let interpolationRaf: number | null = null;
// 실패 스트릭당 1회만 알림 — 폴링은 계속하되(모드가 켜져 있는 한), 성공하면 리셋돼
// 다음에 다시 끊기면 재알림된다.
let hasNotifiedFailure = false;

export const useDeviceStore = create<DeviceState>((set, get) => ({
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  trackName: "",
  artistName: "",
  albumName: "",
  sourceApp: "",
  hasSession: false,
  _lastKnownPositionMs: 0,
  _lastStateTimestamp: 0,

  startPolling: () => {
    if (pollingInterval !== null) return;
    hasNotifiedFailure = false;
    pollOnce();
    pollingInterval = setInterval(pollOnce, 1000);
  },

  stopPolling: () => {
    if (pollingInterval !== null) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    get()._stopInterpolation();
  },

  _startInterpolation: () => {
    if (interpolationRaf !== null) return;
    const tick = () => {
      const { isPlaying, _lastKnownPositionMs, _lastStateTimestamp, durationMs } = get();
      if (!isPlaying) {
        interpolationRaf = null;
        return;
      }
      const elapsed = Date.now() - _lastStateTimestamp;
      const interpolated = Math.min(_lastKnownPositionMs + elapsed, durationMs);
      set({ positionMs: interpolated });
      if (useSettingsStore.getState().deviceMode) {
        useLrcStore.getState().setCurrentTime(interpolated / 1000);
      }
      interpolationRaf = requestAnimationFrame(tick);
    };
    interpolationRaf = requestAnimationFrame(tick);
  },

  _stopInterpolation: () => {
    if (interpolationRaf !== null) {
      cancelAnimationFrame(interpolationRaf);
      interpolationRaf = null;
    }
  },
}));

async function pollOnce(): Promise<void> {
  if (!useSettingsStore.getState().deviceMode) {
    useDeviceStore.getState()._stopInterpolation();
    return;
  }
  try {
    const info = await invoke<NowPlayingInfo | null>("get_now_playing");
    hasNotifiedFailure = false;
    const store = useDeviceStore.getState();
    if (!info) {
      if (store.hasSession) useDeviceStore.setState({ hasSession: false, isPlaying: false });
      store._stopInterpolation();
      return;
    }

    // last_updated_unix_ms 이후 경과한 시간만큼 위치를 보정(폴링 지연 보상)
    const elapsedSinceUpdate = info.is_playing
      ? Math.max(0, Date.now() - info.last_updated_unix_ms)
      : 0;
    const positionMs = Math.min(info.position_ms + elapsedSinceUpdate, info.duration_ms || info.position_ms);

    useDeviceStore.setState({
      hasSession: true,
      isPlaying: info.is_playing,
      positionMs,
      durationMs: info.duration_ms,
      trackName: info.title,
      artistName: info.artist,
      albumName: info.album,
      sourceApp: info.source_app,
      _lastKnownPositionMs: positionMs,
      _lastStateTimestamp: Date.now(),
    });

    if (useSettingsStore.getState().deviceMode) {
      useLrcStore.getState().setMetadata({ title: info.title, artist: info.artist, album: info.album }, true);
    }

    if (info.is_playing) store._startInterpolation();
    else {
      store._stopInterpolation();
      if (useSettingsStore.getState().deviceMode) useLrcStore.getState().setCurrentTime(positionMs / 1000);
    }
  } catch {
    // 어댑터 호출 자체가 실패(예: macOS 업데이트로 비공식 우회 경로가 막힘) — 폴링은
    // 모드가 켜져 있는 한 계속 재시도하되, 알림은 실패 스트릭당 1회만 띄운다.
    if (!hasNotifiedFailure) {
      hasNotifiedFailure = true;
      toast.error(useI18nStore.getState().t.toast.deviceUnavailable);
    }
  }
}
