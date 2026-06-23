import { useServiceStore } from "../stores/useServiceStore";

async function spotifySeekTo(seconds: number): Promise<void> {
  const posMs = Math.max(0, Math.round(seconds * 1000));
  // Update local state immediately for responsive UI
  useServiceStore.setState({
    positionMs: posMs,
    _lastKnownPositionMs: posMs,
    _lastStateTimestamp: Date.now(),
  });
  const token = await useServiceStore.getState().ensureToken();
  await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${posMs}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function spotifyTogglePlay(): Promise<void> {
  const store = useServiceStore.getState();
  const willPlay = !store.isPlaying;
  // 낙관적 갱신: API 응답 지연 동안 표시 시간이 실제 재생과 어긋나지 않도록
  // 현재 표시 위치에서 앵커를 다시 잡고 isPlaying·보간을 즉시 반영.
  useServiceStore.setState({
    isPlaying: willPlay,
    _lastKnownPositionMs: store.positionMs,
    _lastStateTimestamp: Date.now(),
  });
  if (willPlay) store._startInterpolation();
  else store._stopInterpolation();

  const token = await store.ensureToken();
  await fetch(`https://api.spotify.com/v1/me/player/${willPlay ? "play" : "pause"}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function spotifyStop(): Promise<void> {
  // 정지 = 일시정지 + 처음으로. 보간 멈추고 isPlaying 즉시 false(시간 괴리 방지).
  const store = useServiceStore.getState();
  store._stopInterpolation();
  useServiceStore.setState({ isPlaying: false });
  const token = await store.ensureToken();
  await fetch("https://api.spotify.com/v1/me/player/pause", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  await spotifySeekTo(0);
}

export const serviceControls = {
  togglePlay: () => { spotifyTogglePlay().catch(() => {}); },
  skip: (delta: number) => {
    const { positionMs } = useServiceStore.getState();
    spotifySeekTo((positionMs + delta * 1000) / 1000).catch(() => {});
  },
  seekTo: (seconds: number) => { spotifySeekTo(seconds).catch(() => {}); },
  stopAndReset: () => { spotifyStop().catch(() => {}); },
};
