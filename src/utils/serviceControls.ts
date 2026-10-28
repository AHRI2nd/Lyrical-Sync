import { spotifyApiRequest, spotifyAuthLease, isSpotifyAuthLeaseCurrent, useServiceStore } from "../stores/useServiceStore";
import { useI18nStore } from "../stores/useI18nStore";
import { toast } from "../stores/useToastStore";

function restorePlayback(
  revision: number,
  snapshot: ReturnType<typeof useServiceStore.getState>,
  includePlaying: boolean,
): void {
  const current = useServiceStore.getState();
  if (current._playbackRevision !== revision) return;
  useServiceStore.setState({
    ...(includePlaying ? { isPlaying: snapshot.isPlaying } : {}),
    positionMs: snapshot.positionMs,
    _lastKnownPositionMs: snapshot._lastKnownPositionMs,
    _lastStateTimestamp: snapshot._lastStateTimestamp,
    _playbackRevision: revision + 1,
  });
  const store = useServiceStore.getState();
  if (store.isPlaying) store._startInterpolation();
  else store._stopInterpolation();
}

function reportControlFailure(): void {
  toast.error(useI18nStore.getState().t.toast.spotifyActionFailed);
}

async function spotifySeekTo(seconds: number): Promise<void> {
  const snapshot = useServiceStore.getState();
  const lease = spotifyAuthLease();
  const posMs = Math.max(0, Math.round(seconds * 1000));
  const revision = snapshot._playbackRevision + 1;
  useServiceStore.setState({
    positionMs: posMs,
    _lastKnownPositionMs: posMs,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: revision,
  });
  try {
    await spotifyApiRequest(`https://api.spotify.com/v1/me/player/seek?position_ms=${posMs}`, {
      method: "PUT",
    }, async () => undefined, lease);
  } catch (error) {
    if (isSpotifyAuthLeaseCurrent(lease)) {
      restorePlayback(revision, snapshot, false);
      reportControlFailure();
    }
    throw error;
  }
}

async function spotifyTogglePlay(): Promise<void> {
  const snapshot = useServiceStore.getState();
  const lease = spotifyAuthLease();
  const willPlay = !snapshot.isPlaying;
  const revision = snapshot._playbackRevision + 1;
  useServiceStore.setState({
    isPlaying: willPlay,
    _lastKnownPositionMs: snapshot.positionMs,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: revision,
  });
  if (willPlay) snapshot._startInterpolation();
  else snapshot._stopInterpolation();

  try {
    await spotifyApiRequest(`https://api.spotify.com/v1/me/player/${willPlay ? "play" : "pause"}`, {
      method: "PUT",
    }, async () => undefined, lease);
  } catch (error) {
    if (isSpotifyAuthLeaseCurrent(lease)) {
      restorePlayback(revision, snapshot, true);
      reportControlFailure();
    }
    throw error;
  }
}

async function spotifyStop(): Promise<void> {
  const snapshot = useServiceStore.getState();
  if (!snapshot.isPlaying) return;
  const lease = spotifyAuthLease();
  const revision = snapshot._playbackRevision + 1;
  useServiceStore.setState({ isPlaying: false, _playbackRevision: revision });
  snapshot._stopInterpolation();
  try {
    await spotifyApiRequest("https://api.spotify.com/v1/me/player/pause", {
      method: "PUT",
    }, async () => undefined, lease);
  } catch (error) {
    if (isSpotifyAuthLeaseCurrent(lease)) {
      restorePlayback(revision, snapshot, true);
      reportControlFailure();
    }
    throw error;
  }

  const paused = useServiceStore.getState();
  const seekRevision = paused._playbackRevision + 1;
  useServiceStore.setState({
    positionMs: 0,
    _lastKnownPositionMs: 0,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: seekRevision,
  });
  try {
    await spotifyApiRequest("https://api.spotify.com/v1/me/player/seek?position_ms=0", {
      method: "PUT",
    }, async () => undefined, lease);
  } catch (error) {
    if (isSpotifyAuthLeaseCurrent(lease)) {
      restorePlayback(seekRevision, paused, false);
      reportControlFailure();
    }
    throw error;
  }
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
