import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../stores/useDeviceStore";

async function deviceTogglePlay(): Promise<void> {
  const store = useDeviceStore.getState();
  const willPlay = !store.isPlaying;
  // 낙관적 갱신: 커맨드 응답 지연 동안 표시 시간이 어긋나지 않도록 즉시 반영(Spotify 패턴과 동일)
  useDeviceStore.setState({
    isPlaying: willPlay,
    _lastKnownPositionMs: store.positionMs,
    _lastStateTimestamp: Date.now(),
  });
  if (willPlay) store._startInterpolation();
  else store._stopInterpolation();
  await invoke("now_playing_toggle_play_pause");
}

async function deviceSeekTo(seconds: number): Promise<void> {
  const posMs = Math.max(0, Math.round(seconds * 1000));
  useDeviceStore.setState({
    positionMs: posMs,
    _lastKnownPositionMs: posMs,
    _lastStateTimestamp: Date.now(),
  });
  await invoke("now_playing_seek", { positionMs: posMs });
}

export const deviceControls = {
  togglePlay: () => { deviceTogglePlay().catch(() => {}); },
  skip: (delta: number) => {
    const { positionMs } = useDeviceStore.getState();
    deviceSeekTo((positionMs + delta * 1000) / 1000).catch(() => {});
  },
  seekTo: (seconds: number) => { deviceSeekTo(seconds).catch(() => {}); },
  // 임의의 다른 앱 세션을 "정지+처음으로"까지 강제하는 건 소스 앱이 지원 안 할 수 있어
  // 일시정지만 수행(Spotify처럼 seek(0)까지는 하지 않음 — 다른 앱 재생을 임의로 되감지 않음)
  stopAndReset: () => {
    const store = useDeviceStore.getState();
    if (store.isPlaying) deviceTogglePlay().catch(() => {});
  },
};
