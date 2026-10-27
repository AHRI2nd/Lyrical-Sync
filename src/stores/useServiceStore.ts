import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { generatePkce, buildAuthUrl, SPOTIFY_REDIRECT_URI } from "../utils/spotifyAuth";
import { useLrcStore } from "./useLrcStore";
import { useSettingsStore } from "./useSettingsStore";

export interface SpotifyTrack {
  uri: string;
  name: string;
  artistName: string;
  albumName: string;
  albumArtUrl: string | null;
  durationMs: number;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

// Module-level RAF handle — not stored in Zustand since it doesn't drive UI
let interpolationRaf: number | null = null;
type AuthLease = { generation: number; clientId: string };
let refreshPromises = new Map<number, Promise<void>>();
let tokenQueue: Promise<void> = Promise.resolve();
let oauthListenerQueue: Promise<void> = Promise.resolve();
let pendingLoginLease: AuthLease | null = null;

function enqueueTokenTask<T>(task: () => Promise<T>): Promise<T> {
  const result = tokenQueue.then(task, task);
  tokenQueue = result.then(() => undefined, () => undefined);
  return result;
}

function enqueueOAuthListenerTask<T>(task: () => Promise<T>): Promise<T> {
  const result = oauthListenerQueue.then(task, task);
  oauthListenerQueue = result.then(() => undefined, () => undefined);
  return result;
}

function authLease(): AuthLease {
  return {
    generation: useServiceStore.getState()._authGeneration,
    clientId: useSettingsStore.getState().spotifyClientId.trim(),
  };
}

function isCurrentLease(lease: AuthLease): boolean {
  return useServiceStore.getState()._authGeneration === lease.generation &&
    useSettingsStore.getState().spotifyClientId.trim() === lease.clientId;
}

function loadRefreshToken(lease: AuthLease): Promise<string | null> {
  return enqueueTokenTask(async () => {
    if (!isCurrentLease(lease)) return null;
    return await invoke<string | null>("load_refresh_token");
  });
}

function saveRefreshToken(lease: AuthLease, token: string): Promise<boolean> {
  return enqueueTokenTask(async () => {
    if (!isCurrentLease(lease)) return false;
    await invoke("save_refresh_token", { token });
    return true;
  });
}

function clearRefreshToken(): void {
  void enqueueTokenTask(() => invoke("clear_refresh_token")).catch(() => {});
}

function cancelOAuthListener(): void {
  void enqueueOAuthListenerTask(() => invoke("cancel_oauth_listener")).catch(() => {});
}

interface ServiceState {
  // Auth
  isLoggedIn: boolean;
  accessToken: string | null;
  tokenExpiresAt: number | null;
  _authGeneration: number;
  _pendingCodeVerifier: string | null;
  _pendingOAuthState: string | null;

  // SDK / playback
  deviceId: string | null;
  /** 최근 Web Playback SDK 오류(초기화/인증/계정/재생). null=정상 */
  playerError: string | null;
  setPlayerError: (msg: string | null) => void;
  isReady: boolean;
  isPlaying: boolean;
  isLooping: boolean;
  positionMs: number;
  durationMs: number;
  trackUri: string | null;
  trackName: string;
  artistName: string;
  albumName: string;
  albumArtUrl: string | null;
  _lastKnownPositionMs: number;
  _lastStateTimestamp: number;
  _playbackRevision: number;

  // Actions
  startLogin: () => Promise<void>;
  handleCallback: (url: string) => Promise<void>;
  tryRestoreSession: () => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  logout: () => void;
  ensureToken: () => Promise<string>;

  toggleLoop: () => Promise<void>;

  // SDK callbacks (called from spotifyPlayer.ts)
  onPlayerReady: (deviceId: string) => void;
  onPlayerStateChanged: (state: Spotify.PlaybackState) => void;

  // Playback API
  transferPlaybackToApp: () => Promise<void>;
  playTrack: (uri: string) => Promise<void>;
  pausePlayback: () => Promise<void>;
  fetchCurrentlyPlaying: () => Promise<SpotifyTrack | null>;
  // 기기 선택
  fetchDevices: () => Promise<SpotifyDevice[]>;
  transferToDevice: (deviceId: string, play: boolean) => Promise<void>;

  _startInterpolation: () => void;
  _stopInterpolation: () => void;
}

export const useServiceStore = create<ServiceState>()((set, get) => ({
  isLoggedIn: false,
  accessToken: null,
  tokenExpiresAt: null,
  _authGeneration: 0,
  _pendingCodeVerifier: null,
  _pendingOAuthState: null,
  deviceId: null,
  playerError: null,
  isReady: false,
  isPlaying: false,
  isLooping: false,
  positionMs: 0,
  durationMs: 0,
  trackUri: null,
  trackName: "",
  artistName: "",
  albumName: "",
  albumArtUrl: null,
  _lastKnownPositionMs: 0,
  _lastStateTimestamp: 0,
  _playbackRevision: 0,

  startLogin: async () => {
    const clientId = useSettingsStore.getState().spotifyClientId.trim();
    if (!clientId) throw new Error("no_client_id");

    const generation = get()._authGeneration + 1;
    const lease = { generation, clientId };
    pendingLoginLease = null;
    set({
      _authGeneration: generation,
      _pendingCodeVerifier: null,
      _pendingOAuthState: null,
      isLoggedIn: false,
      accessToken: null,
      tokenExpiresAt: null,
      deviceId: null,
      isReady: false,
      isPlaying: false,
      isLooping: false,
      positionMs: 0,
      durationMs: 0,
      trackUri: null,
      trackName: "",
      artistName: "",
      albumName: "",
      albumArtUrl: null,
    });
    get()._stopInterpolation();
    cancelOAuthListener();
    clearRefreshToken();

    const { codeVerifier, codeChallenge } = await generatePkce();
    if (!isCurrentLease(lease)) return;
    const state = crypto.randomUUID();
    pendingLoginLease = lease;
    set({ _pendingCodeVerifier: codeVerifier, _pendingOAuthState: state });

    // Start local HTTP listener before opening the browser so the callback is captured
    await enqueueOAuthListenerTask(async () => {
      if (!isCurrentLease(lease)) return;
      await invoke("start_oauth_listener", { state });
    });
    if (!isCurrentLease(lease)) return;
    const authUrl = buildAuthUrl(clientId, codeChallenge, state);
    await openUrl(authUrl);
  },

  handleCallback: async (callbackUrl: string) => {
    const params = new URLSearchParams(new URL(callbackUrl).search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const error = params.get("error");

    if (error) throw new Error(error);

    const { _pendingCodeVerifier, _pendingOAuthState } = get();
    if (!code || !_pendingCodeVerifier || returnedState !== _pendingOAuthState) {
      throw new Error("invalid_callback");
    }

    const lease = pendingLoginLease ?? authLease();
    if (!isCurrentLease(lease)) throw new Error("auth_changed");
    pendingLoginLease = null;
    set({ _pendingCodeVerifier: null, _pendingOAuthState: null });
    const resp: TokenResponse = await invoke("exchange_spotify_token", {
      code,
      codeVerifier: _pendingCodeVerifier,
      clientId: lease.clientId,
      redirectUri: SPOTIFY_REDIRECT_URI,
    });
    if (!isCurrentLease(lease)) throw new Error("auth_changed");

    if (resp.refreshToken) {
      await saveRefreshToken(lease, resp.refreshToken);
    }
    if (!isCurrentLease(lease)) throw new Error("auth_changed");

    set({
      isLoggedIn: true,
      accessToken: resp.accessToken,
      tokenExpiresAt: Date.now() + resp.expiresIn * 1000,
      _pendingCodeVerifier: null,
      _pendingOAuthState: null,
    });
  },

  tryRestoreSession: async () => {
    if (get().isLoggedIn) return;
    const lease = authLease();
    try {
      const storedToken = await loadRefreshToken(lease);
      if (!isCurrentLease(lease) || !storedToken) return;
      // Mark as logged in with a near-expired token to trigger refresh on first use
      set({ isLoggedIn: true, accessToken: null, tokenExpiresAt: 0 });
    } catch {
      // Keyring unavailable — silently skip
    }
  },

  refreshAccessToken: async () => {
    if (!get().isLoggedIn) throw new Error("not_logged_in");
    const lease = authLease();
    const existing = refreshPromises.get(lease.generation);
    if (existing) return existing;
    const promise = (async () => {
      const storedToken = await loadRefreshToken(lease);
      if (!isCurrentLease(lease)) throw new Error("auth_changed");
      if (!storedToken) throw new Error("no_refresh_token");

      let resp: TokenResponse;
      try {
        resp = await invoke("refresh_spotify_token", {
          refreshToken: storedToken,
          clientId: lease.clientId,
        });
      } catch (e) {
        // Refresh-token invalid_grant is terminal only for the lease that received it.
        if (String(e).includes("invalid_grant") && isCurrentLease(lease)) {
          get().logout();
        }
        throw e;
      }
      if (!isCurrentLease(lease)) throw new Error("auth_changed");

      if (resp.refreshToken) {
        await saveRefreshToken(lease, resp.refreshToken);
      }
      if (!isCurrentLease(lease)) throw new Error("auth_changed");

      set({
        isLoggedIn: true,
        accessToken: resp.accessToken,
        tokenExpiresAt: Date.now() + resp.expiresIn * 1000,
      });
    })();
    refreshPromises.set(lease.generation, promise);
    try {
      return await promise;
    } finally {
      if (refreshPromises.get(lease.generation) === promise) refreshPromises.delete(lease.generation);
    }
  },

  toggleLoop: async () => {
    const { isLooping, ensureToken } = get();
    const next = !isLooping;
    const token = await ensureToken();
    await fetch(`https://api.spotify.com/v1/me/player/repeat?state=${next ? "track" : "off"}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    set({ isLooping: next });
  },

  logout: () => {
    const generation = get()._authGeneration + 1;
    pendingLoginLease = null;
    set({
      _authGeneration: generation,
      _pendingOAuthState: null,
      _pendingCodeVerifier: null,
      isLoggedIn: false,
      accessToken: null,
      tokenExpiresAt: null,
      deviceId: null,
      isReady: false,
      isPlaying: false,
      isLooping: false,
      positionMs: 0,
      durationMs: 0,
      trackUri: null,
      trackName: "",
      artistName: "",
      albumName: "",
      albumArtUrl: null,
    });
    get()._stopInterpolation();
    cancelOAuthListener();
    clearRefreshToken();
  },

  ensureToken: async () => {
    const { accessToken, tokenExpiresAt, isLoggedIn } = get();
    if (!isLoggedIn) throw new Error("no_token");
    const lease = authLease();
    if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60_000) {
      return accessToken;
    }
    await get().refreshAccessToken();
    if (!isCurrentLease(lease)) throw new Error("auth_changed");
    const token = get().accessToken;
    if (!token) throw new Error("no_token");
    return token;
  },

  setPlayerError: (msg) => set({ playerError: msg }),

  onPlayerReady: (deviceId: string) => {
    set({ deviceId, isReady: true, playerError: null });
  },

  onPlayerStateChanged: (state: Spotify.PlaybackState) => {
    if (!state) return;
    const track = state.track_window.current_track;
    const positionMs = state.position;
    const isPlaying = !state.paused;

    set({
      _playbackRevision: get()._playbackRevision + 1,
      isPlaying,
      positionMs,
      durationMs: state.duration,
      trackUri: track.uri,
      trackName: track.name,
      artistName: track.artists.map((a) => a.name).join(", "),
      albumName: track.album.name,
      albumArtUrl: track.album.images[0]?.url ?? null,
      _lastKnownPositionMs: positionMs,
      _lastStateTimestamp: Date.now(),
    });

    // Spotify 모드일 때만 문서(가사 위치·메타데이터)에 반영. 파일/유튜브 모드에선 무시.
    const inSpotifyMode = useSettingsStore.getState().spotifyMode;
    if (isPlaying) {
      get()._startInterpolation();
    } else {
      get()._stopInterpolation();
      if (inSpotifyMode) useLrcStore.getState().setCurrentTime(positionMs / 1000);
    }

    if (inSpotifyMode) {
      useLrcStore.getState().setMetadata({
        title: track.name,
        artist: track.artists.map((a) => a.name).join(", "),
        album: track.album.name,
      }, true); // 서비스 자동 동기화 → dirty 미표시
    }
  },

  transferPlaybackToApp: async () => {
    // SDK 'ready'가 아직 안 왔을 수 있으니 deviceId를 잠깐 대기(최대 ~3초)
    let deviceId = get().deviceId;
    for (let i = 0; i < 12 && !deviceId; i++) {
      await new Promise((r) => setTimeout(r, 250));
      deviceId = get().deviceId;
    }
    if (!deviceId) return; // SDK 기기 미준비(playerError 참고) → 기존 기기 유지
    const token = await get().ensureToken();
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device_ids: [deviceId], play: true }),
    });
  },

  fetchDevices: async () => {
    const token = await get().ensureToken();
    const resp = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.devices ?? []) as SpotifyDevice[];
  },

  transferToDevice: async (deviceId, play) => {
    const token = await get().ensureToken();
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [deviceId], play }),
    });
  },

  pausePlayback: async () => {
    const { isPlaying, ensureToken } = get();
    if (!isPlaying) return;
    try {
      const token = await ensureToken();
      await fetch("https://api.spotify.com/v1/me/player/pause", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* ignore */ }
  },

  playTrack: async (uri: string) => {
    const { deviceId: sdkDeviceId, ensureToken } = get();
    const token = await ensureToken();

    const playUrl = sdkDeviceId
      ? `https://api.spotify.com/v1/me/player/play?device_id=${sdkDeviceId}`
      : "https://api.spotify.com/v1/me/player/play";

    let resp = await fetch(playUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] }),
    });

    // If SDK device not found, fall back to any available device
    if (!resp.ok && sdkDeviceId) {
      const devResp = await fetch("https://api.spotify.com/v1/me/player/devices", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (devResp.ok) {
        const { devices = [] } = await devResp.json() as { devices: { id: string; is_active: boolean }[] };
        const target = devices.find((d) => d.is_active) ?? devices[0];
        if (target) {
          await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ device_ids: [target.id], play: false }),
          });
          await new Promise((r) => setTimeout(r, 500));
          resp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${target.id}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ uris: [uri] }),
          });
        }
      }
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text);
    }
  },

  fetchCurrentlyPlaying: async () => {
    const token = await get().ensureToken();
    const resp = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok || resp.status === 204) return null;
    const data = await resp.json();
    if (!data?.item) return null;
    return {
      uri: data.item.uri as string,
      name: data.item.name as string,
      artistName: (data.item.artists as { name: string }[]).map((a) => a.name).join(", "),
      albumName: data.item.album.name as string,
      albumArtUrl: (data.item.album.images as { url: string }[])[0]?.url ?? null,
      durationMs: data.item.duration_ms as number,
    };
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
      if (useSettingsStore.getState().spotifyMode) useLrcStore.getState().setCurrentTime(interpolated / 1000);
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

useSettingsStore.subscribe((state, previous) => {
  if (state.spotifyClientId.trim() === previous.spotifyClientId.trim()) return;
  useServiceStore.getState().logout();
});
