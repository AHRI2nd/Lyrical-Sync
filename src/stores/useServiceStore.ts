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

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

// Module-level RAF handle — not stored in Zustand since it doesn't drive UI
let interpolationRaf: number | null = null;

interface ServiceState {
  // Auth
  isLoggedIn: boolean;
  accessToken: string | null;
  tokenExpiresAt: number | null;
  _pendingCodeVerifier: string | null;
  _pendingOAuthState: string | null;

  // SDK / playback
  deviceId: string | null;
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

  _startInterpolation: () => void;
  _stopInterpolation: () => void;
}

export const useServiceStore = create<ServiceState>()((set, get) => ({
  isLoggedIn: false,
  accessToken: null,
  tokenExpiresAt: null,
  _pendingCodeVerifier: null,
  _pendingOAuthState: null,
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
  _lastKnownPositionMs: 0,
  _lastStateTimestamp: 0,

  startLogin: async () => {
    const clientId = useSettingsStore.getState().spotifyClientId.trim();
    if (!clientId) throw new Error("no_client_id");

    const { codeVerifier, codeChallenge } = await generatePkce();
    const state = crypto.randomUUID();
    set({ _pendingCodeVerifier: codeVerifier, _pendingOAuthState: state });

    // Start local HTTP listener before opening the browser so the callback is captured
    await invoke("start_oauth_listener");
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

    const clientId = useSettingsStore.getState().spotifyClientId.trim();
    const resp: TokenResponse = await invoke("exchange_spotify_token", {
      code,
      codeVerifier: _pendingCodeVerifier,
      clientId,
      redirectUri: SPOTIFY_REDIRECT_URI,
    });

    if (resp.refreshToken) {
      await invoke("save_refresh_token", { token: resp.refreshToken });
    }

    set({
      isLoggedIn: true,
      accessToken: resp.accessToken,
      tokenExpiresAt: Date.now() + resp.expiresIn * 1000,
      _pendingCodeVerifier: null,
      _pendingOAuthState: null,
    });
  },

  tryRestoreSession: async () => {
    try {
      const storedToken: string | null = await invoke("load_refresh_token");
      if (!storedToken) return;
      // Mark as logged in with a near-expired token to trigger refresh on first use
      set({ isLoggedIn: true, accessToken: null, tokenExpiresAt: 0 });
    } catch {
      // Keyring unavailable — silently skip
    }
  },

  refreshAccessToken: async () => {
    const clientId = useSettingsStore.getState().spotifyClientId.trim();
    const storedToken: string | null = await invoke("load_refresh_token");
    if (!storedToken) throw new Error("no_refresh_token");

    let resp: TokenResponse;
    try {
      resp = await invoke("refresh_spotify_token", {
        refreshToken: storedToken,
        clientId,
      });
    } catch (e) {
      // 리프레시 토큰 만료/취소(invalid_grant) → 저장 토큰 폐기 + 로그아웃해 재로그인 유도.
      // 재시도하지 않음(Spotify 권장 처리). 2026-07-20부터 리프레시 토큰은 6개월 후 만료.
      if (String(e).includes("invalid_grant")) {
        get().logout();
      }
      throw e;
    }

    if (resp.refreshToken) {
      await invoke("save_refresh_token", { token: resp.refreshToken });
    }

    set({
      isLoggedIn: true,
      accessToken: resp.accessToken,
      tokenExpiresAt: Date.now() + resp.expiresIn * 1000,
    });
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
    get()._stopInterpolation();
    invoke("clear_refresh_token").catch(() => {});
    set({
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
  },

  ensureToken: async () => {
    const { accessToken, tokenExpiresAt } = get();
    if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60_000) {
      return accessToken;
    }
    await get().refreshAccessToken();
    const token = get().accessToken;
    if (!token) throw new Error("no_token");
    return token;
  },

  onPlayerReady: (deviceId: string) => {
    set({ deviceId, isReady: true });
  },

  onPlayerStateChanged: (state: Spotify.PlaybackState) => {
    if (!state) return;
    const track = state.track_window.current_track;
    const positionMs = state.position;
    const isPlaying = !state.paused;

    set({
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
      });
    }
  },

  transferPlaybackToApp: async () => {
    const { deviceId, ensureToken } = get();
    if (!deviceId) return;
    const token = await ensureToken();
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device_ids: [deviceId], play: true }),
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
