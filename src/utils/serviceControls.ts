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
  const { isPlaying, ensureToken } = useServiceStore.getState();
  const token = await ensureToken();
  const endpoint = isPlaying ? "pause" : "play";
  await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export const serviceControls = {
  togglePlay: () => { spotifyTogglePlay().catch(() => {}); },
  skip: (delta: number) => {
    const { positionMs } = useServiceStore.getState();
    spotifySeekTo((positionMs + delta * 1000) / 1000).catch(() => {});
  },
  seekTo: (seconds: number) => { spotifySeekTo(seconds).catch(() => {}); },
  stopAndReset: () => { spotifySeekTo(0).catch(() => {}); },
};
