import { useServiceStore } from "../stores/useServiceStore";
import { useLrcStore } from "../stores/useLrcStore";
import { useSettingsStore } from "../stores/useSettingsStore";

let player: Spotify.Player | null = null;
let pendingToken: string | null = null;
let sdkReady = false;
let pollingInterval: ReturnType<typeof setInterval> | null = null;

// Must be defined before the SDK script executes
window.onSpotifyWebPlaybackSDKReady = () => {
  sdkReady = true;
  if (pendingToken) {
    createPlayer(pendingToken);
    pendingToken = null;
  }
};

export function initSpotifyPlayer(): void {
  const token = useServiceStore.getState().accessToken;
  if (!token) {
    // Token not yet available — start polling only
    startPolling();
    return;
  }
  if (sdkReady) {
    createPlayer(token);
  } else {
    pendingToken = token;
  }
  startPolling();
}

export function disconnectSpotifyPlayer(): void {
  player?.disconnect();
  player = null;
  stopPolling();
}

export async function activateSpotifyPlayer(): Promise<void> {
  if (player) await player.activateElement();
}

export function getSpotifyDeviceId(): string | null {
  return useServiceStore.getState().deviceId;
}

export async function setSpotifyVolume(volume: number): Promise<void> {
  if (player) {
    await player.setVolume(volume);
  }
}

function createPlayer(accessToken: string): void {
  if (player) {
    player.disconnect();
    player = null;
  }

  player = new Spotify.Player({
    name: "Lyrical Sync",
    getOAuthToken: async (cb) => {
      try {
        const token = await useServiceStore.getState().ensureToken();
        cb(token);
      } catch {
        cb(accessToken);
      }
    },
    volume: 1.0,
  });

  player.addListener("ready", ({ device_id }) => {
    useServiceStore.getState().onPlayerReady(device_id);
  });

  player.addListener("player_state_changed", (state) => {
    if (state) useServiceStore.getState().onPlayerStateChanged(state);
  });

  player.addListener("not_ready", () => {
    // SDK 기기가 오프라인이 됨 → deviceId 무효화(전환 대상에서 제외)
    useServiceStore.setState({ deviceId: null });
  });

  // SDK 실패는 기존엔 무음으로 사라졌음. 원인 진단을 위해 노출.
  // - initialization_error: 웹뷰가 EME/Widevine 등 미지원(네이티브 웹뷰에서 흔함)
  // - authentication_error: 토큰/스코프 문제
  // - account_error: Spotify Premium 아님(SDK 재생 불가)
  // - playback_error: 재생 실패(주로 DRM)
  const reportError = (kind: string) => ({ message }: { message: string }) => {
    useServiceStore.getState().setPlayerError(`${kind}: ${message}`);
    console.warn(`[Spotify SDK] ${kind}: ${message}`);
  };
  player.addListener("initialization_error", reportError("initialization_error"));
  player.addListener("authentication_error", reportError("authentication_error"));
  player.addListener("account_error", reportError("account_error"));
  player.addListener("playback_error", reportError("playback_error"));

  player.connect();
}

function startPolling(): void {
  if (pollingInterval !== null) return;
  pollOnce();
  pollingInterval = setInterval(pollOnce, 3000);
}

function stopPolling(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

async function pollOnce(): Promise<void> {
  try {
    const token = await useServiceStore.getState().ensureToken();
    const resp = await fetch("https://api.spotify.com/v1/me/player", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 204 || !resp.ok) return;
    const data = await resp.json();
    if (!data?.item) return;

    const isPlaying = data.is_playing as boolean;
    const positionMs = data.progress_ms as number;
    const track = data.item;
    const artistName = (track.artists as { name: string }[]).map((a) => a.name).join(", ");

    // Only update from poll if SDK isn't providing state (no SDK device active)
    const { deviceId } = useServiceStore.getState();
    const activeDeviceId = data.device?.id as string | undefined;
    if (deviceId && activeDeviceId === deviceId) return; // SDK handles this

    useServiceStore.setState({
      isReady: true,
      isPlaying,
      positionMs,
      durationMs: track.duration_ms,
      trackUri: track.uri,
      trackName: track.name,
      artistName,
      albumName: track.album.name,
      albumArtUrl: (track.album.images as { url: string }[])[0]?.url ?? null,
      _lastKnownPositionMs: positionMs,
      _lastStateTimestamp: Date.now(),
    });
    // Spotify 모드일 때만 문서에 반영
    const inSpotifyMode = useSettingsStore.getState().spotifyMode;
    if (inSpotifyMode) {
      useLrcStore.getState().setMetadata({ title: track.name, artist: artistName, album: track.album.name });
    }

    if (isPlaying) useServiceStore.getState()._startInterpolation();
    else {
      useServiceStore.getState()._stopInterpolation();
      if (inSpotifyMode) useLrcStore.getState().setCurrentTime(positionMs / 1000);
    }
  } catch {
    // ignore
  }
}
