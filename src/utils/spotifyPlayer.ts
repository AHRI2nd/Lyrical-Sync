import { spotifyApiRequest, useServiceStore } from "../stores/useServiceStore";
import { useLrcStore } from "../stores/useLrcStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useI18nStore } from "../stores/useI18nStore";
import { toast } from "../stores/useToastStore";

let player: Spotify.Player | null = null;
type AuthLease = { generation: number; clientId: string };
let pendingToken: { lease: AuthLease } | null = null;
let sdkReady = false;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let pollingAbortController: AbortController | null = null;
let pollingGeneration = 0;
let isPolling = false;
let playerGeneration = 0;
let hasNotifiedPollFailure = false;

function currentLease(): AuthLease {
  return {
    generation: useServiceStore.getState()._authGeneration,
    clientId: useSettingsStore.getState().spotifyClientId.trim(),
  };
}

function isCurrentLease(lease: AuthLease): boolean {
  const state = useServiceStore.getState();
  return state._authGeneration === lease.generation &&
    useSettingsStore.getState().spotifyClientId.trim() === lease.clientId;
}

// Must be defined before the SDK script executes
if (typeof window !== "undefined") {
  window.onSpotifyWebPlaybackSDKReady = () => {
    sdkReady = true;
    const pending = pendingToken;
    pendingToken = null;
    if (pending && isCurrentLease(pending.lease)) createPlayer(pending.lease);
  };
}

export function initSpotifyPlayer(): void {
  const lease = currentLease();
  const token = useServiceStore.getState().accessToken;
  if (!token) {
    // Token not yet available — start polling only
    startPolling();
    return;
  }
  if (sdkReady) {
    createPlayer(lease);
  } else {
    pendingToken = { lease };
  }
  startPolling();
}

export function disconnectSpotifyPlayer(): void {
  playerGeneration += 1;
  pendingToken = null;
  const previous = player;
  player = null;
  previous?.disconnect();
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

function disconnectOwnedPlayer(instance: Spotify.Player, generation: number): void {
  if (player !== instance || playerGeneration !== generation) return;
  player = null;
  playerGeneration += 1;
  instance.disconnect();
  stopPolling();
}

function createPlayer(lease: AuthLease): void {
  if (!isCurrentLease(lease)) return;
  const previous = player;
  player = null;
  previous?.disconnect();
  const generation = ++playerGeneration;
  let instance: Spotify.Player;
  const isCurrentInstance = () => player === instance && playerGeneration === generation && isCurrentLease(lease);

  instance = new Spotify.Player({
    name: "Lyrical Sync",
    getOAuthToken: async (cb) => {
      if (!isCurrentLease(lease)) {
        cb("");
        disconnectOwnedPlayer(instance, generation);
        return;
      }
      try {
        const token = await useServiceStore.getState().ensureToken();
        if (!isCurrentInstance()) {
          cb("");
          disconnectOwnedPlayer(instance, generation);
          return;
        }
        cb(token);
      } catch {
        cb("");
        if (!isCurrentLease(lease)) disconnectOwnedPlayer(instance, generation);
      }
    },
    volume: 1.0,
  });
  player = instance;

  instance.addListener("ready", ({ device_id }) => {
    if (!isCurrentInstance()) { disconnectOwnedPlayer(instance, generation); return; }
    useServiceStore.getState().onPlayerReady(device_id);
  });

  instance.addListener("player_state_changed", (state) => {
    if (!isCurrentInstance()) { disconnectOwnedPlayer(instance, generation); return; }
    if (state) useServiceStore.getState().onPlayerStateChanged(state);
  });

  instance.addListener("not_ready", () => {
    if (!isCurrentInstance()) { disconnectOwnedPlayer(instance, generation); return; }
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
  for (const [event, kind] of [
    ["initialization_error", "initialization_error"],
    ["authentication_error", "authentication_error"],
    ["account_error", "account_error"],
    ["playback_error", "playback_error"],
  ] as const) {
    instance.addListener(event, (error) => {
      if (!isCurrentInstance()) { disconnectOwnedPlayer(instance, generation); return; }
      reportError(kind)(error);
    });
  }

  instance.connect();
}

let observedAuthGeneration = useServiceStore.getState()._authGeneration;
useServiceStore.subscribe((state) => {
  if (state._authGeneration === observedAuthGeneration) return;
  observedAuthGeneration = state._authGeneration;
  disconnectSpotifyPlayer();
});

function startPolling(): void {
  if (isPolling || !useSettingsStore.getState().spotifyMode) return;
  isPolling = true;
  hasNotifiedPollFailure = false;
  const generation = ++pollingGeneration;
  void pollOnce(generation, currentLease());
}

function stopPolling(): void {
  isPolling = false;
  pollingGeneration += 1;
  if (pollingTimer !== null) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  pollingAbortController?.abort();
  pollingAbortController = null;
}

function isCurrentPoll(generation: number, lease: AuthLease): boolean {
  return isPolling && pollingGeneration === generation && isCurrentLease(lease) &&
    useSettingsStore.getState().spotifyMode;
}

async function pollOnce(generation: number, lease: AuthLease): Promise<void> {
  if (!isCurrentPoll(generation, lease)) return;
  const playbackRevision = useServiceStore.getState()._playbackRevision;
  const controller = new AbortController();
  pollingAbortController = controller;
  try {
    const t0 = Date.now();
    const data = await spotifyApiRequest("https://api.spotify.com/v1/me/player", {
      signal: controller.signal,
    }, async (resp) => resp.status === 204 ? null : resp.json(), lease);
    hasNotifiedPollFailure = false;
    if (!isCurrentPoll(generation, lease) || useServiceStore.getState()._playbackRevision !== playbackRevision) return;
    if (!data?.item) return;

    const isPlaying = data.is_playing as boolean;
    // progress_ms is already stale by the time the response arrives. Compensate by half the RTT, capped at 750ms.
    const latencyComp = isPlaying ? Math.min(1500, Date.now() - t0) / 2 : 0;
    const positionMs = Math.round((data.progress_ms as number) + latencyComp);
    const track = data.item;
    const artistName = (track.artists as { name: string }[]).map((a) => a.name).join(", ");

    // Only update from poll if SDK isn't providing state (no SDK device active)
    const { deviceId } = useServiceStore.getState();
    const activeDeviceId = data.device?.id as string | undefined;
    if (deviceId && activeDeviceId === deviceId) return; // SDK handles this

    const acceptedRevision = playbackRevision + 1;
    useServiceStore.setState({
      _playbackRevision: acceptedRevision,
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
    // Spotify mode is checked again before document writes.
    if (!isCurrentPoll(generation, lease) || useServiceStore.getState()._playbackRevision !== acceptedRevision) return;
    useLrcStore.getState().setMetadata({ title: track.name, artist: artistName, album: track.album.name }, true);

    if (isPlaying) useServiceStore.getState()._startInterpolation();
    else {
      useServiceStore.getState()._stopInterpolation();
      useLrcStore.getState().setCurrentTime(positionMs / 1000);
    }
  } catch {
    // Abort and stale session errors are expected during stop, mode changes, and logout.
    if (isCurrentPoll(generation, lease) && !controller.signal.aborted && !hasNotifiedPollFailure) {
      hasNotifiedPollFailure = true;
      toast.error(useI18nStore.getState().t.toast.spotifyActionFailed);
    }
  } finally {
    if (pollingAbortController === controller) pollingAbortController = null;
    if (isCurrentPoll(generation, lease)) {
      pollingTimer = setTimeout(() => {
        pollingTimer = null;
        void pollOnce(generation, lease);
      }, 1500);
    }
  }
}

useSettingsStore.subscribe((state, previous) => {
  if (previous.spotifyMode === state.spotifyMode) return;
  if (!state.spotifyMode) {
    useServiceStore.getState()._stopInterpolation();
    stopPolling();
  } else if (useServiceStore.getState().isLoggedIn) {
    startPolling();
  }
});
