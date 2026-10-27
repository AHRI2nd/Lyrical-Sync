// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { useServiceStore } from "../stores/useServiceStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { disconnectSpotifyPlayer, initSpotifyPlayer } from "./spotifyPlayer";

type Listener = (...args: any[]) => void;
class MockSpotifyPlayer {
  static instances: MockSpotifyPlayer[] = [];
  listeners = new Map<string, Listener>();
  options: { getOAuthToken: (callback: (token: string) => void) => Promise<void> };
  disconnect = vi.fn();
  connect = vi.fn();
  activateElement = vi.fn(async () => {});
  setVolume = vi.fn(async () => {});
  constructor(options: MockSpotifyPlayer["options"]) {
    this.options = options;
    MockSpotifyPlayer.instances.push(this);
  }
  addListener(event: string, listener: Listener) { this.listeners.set(event, listener); return true; }
  emit(event: string, ...args: any[]) { this.listeners.get(event)?.(...args); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  MockSpotifyPlayer.instances = [];
  disconnectSpotifyPlayer();
  invoke.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ spotifyClientId: "spotify-player-test", spotifyMode: false });
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "access-token",
    tokenExpiresAt: Date.now() + 3600000,
    deviceId: null,
    isReady: false,
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    trackName: "",
    trackUri: null,
    artistName: "",
    albumName: "",
    albumArtUrl: null,
    _playbackRevision: 0,
    playerError: null,
  });
  (globalThis as any).Spotify = { Player: MockSpotifyPlayer };
});

afterEach(() => {
  disconnectSpotifyPlayer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("discards a token queued before the SDK becomes ready if logout invalidates its lease", () => {
  const generation = useServiceStore.getState()._authGeneration;
  initSpotifyPlayer();
  expect(MockSpotifyPlayer.instances).toHaveLength(0);
  useServiceStore.getState().logout();
  (window as any).onSpotifyWebPlaybackSDKReady();
  expect(MockSpotifyPlayer.instances).toHaveLength(0);
  expect(useServiceStore.getState()._authGeneration).toBeGreaterThan(generation);
});

it("ignores late ready, playback, and error callbacks from a disconnected player", () => {
  initSpotifyPlayer();
  const oldPlayer = MockSpotifyPlayer.instances[0];
  expect(oldPlayer).toBeDefined();
  useServiceStore.getState().logout();
  useServiceStore.setState({ playerError: "new session error", trackName: "New session" });

  oldPlayer.emit("ready", { device_id: "old-device" });
  oldPlayer.emit("player_state_changed", {
    paused: false,
    position: 8000,
    duration: 20000,
    track_window: { current_track: { uri: "spotify:track:old", name: "Old Song", artists: [{ name: "Old Artist" }], album: { name: "Old Album", images: [] } } },
  });
  oldPlayer.emit("authentication_error", { message: "old failure" });

  expect(oldPlayer.disconnect).toHaveBeenCalledOnce();
  expect(useServiceStore.getState()).toMatchObject({
    isLoggedIn: false,
    deviceId: null,
    trackName: "New session",
    playerError: "new session error",
  });
});

it("returns an empty OAuth token instead of a captured old access token when refresh finishes stale", async () => {
  const refresh = deferred<{ accessToken: string; expiresIn: number }>();
  useServiceStore.setState({ tokenExpiresAt: 0 });
  invoke.mockImplementation((command: string) => {
    if (command === "load_refresh_token") return Promise.resolve("refresh-token");
    if (command === "refresh_spotify_token") return refresh.promise;
    return Promise.resolve(undefined);
  });
  initSpotifyPlayer();
  const instance = MockSpotifyPlayer.instances[0];
  const callback = vi.fn();
  const tokenRequest = instance.options.getOAuthToken(callback);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("refresh_spotify_token", expect.any(Object)));

  useServiceStore.getState().logout();
  refresh.resolve({ accessToken: "stale-refreshed-token", expiresIn: 3600 });
  await tokenRequest;
  expect(callback).toHaveBeenCalledWith("");
  expect(callback).not.toHaveBeenCalledWith("access-token");
  expect(useServiceStore.getState().accessToken).toBeNull();
});

it("connects only one player for the current auth lease and supplies its current token", async () => {
  initSpotifyPlayer();
  const instance = MockSpotifyPlayer.instances[0];
  const callback = vi.fn();
  await instance.options.getOAuthToken(callback);
  expect(callback).toHaveBeenCalledWith("access-token");
  initSpotifyPlayer();
  expect(MockSpotifyPlayer.instances).toHaveLength(2);
  expect(instance.disconnect).toHaveBeenCalledOnce();
});

function spotifyResponse(trackName: string) {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      is_playing: false,
      progress_ms: 1200,
      item: {
        uri: `spotify:track:${trackName}`,
        name: trackName,
        artists: [{ name: "Artist" }],
        album: { name: "Album", images: [] },
        duration_ms: 30000,
      },
      device: { id: "remote-device" },
    }),
  } as Response;
}

it("does not overlap Spotify polls and schedules the next request after settlement", async () => {
  const first = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValue(first.promise);
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  useSettingsStore.setState({ spotifyMode: true });
  initSpotifyPlayer();

  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(6000);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  first.resolve(spotifyResponse("first"));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1499);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("ignores an in-flight Spotify response after disconnect and a newer poll result", async () => {
  const stale = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(spotifyResponse("current"));
  vi.stubGlobal("fetch", fetchMock);
  useSettingsStore.setState({ spotifyMode: true });
  initSpotifyPlayer();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  disconnectSpotifyPlayer();
  initSpotifyPlayer();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(useServiceStore.getState().trackName).toBe("current"));
  expect(useServiceStore.getState().trackName).toBe("current");

  stale.resolve(spotifyResponse("stale"));
  await Promise.resolve();
  await Promise.resolve();
  expect(useServiceStore.getState().trackName).toBe("current");
});

it("does not let an older remote poll overwrite a newer accepted SDK playback state", async () => {
  const pending = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValue(pending.promise);
  vi.stubGlobal("fetch", fetchMock);
  useSettingsStore.setState({ spotifyMode: true });
  initSpotifyPlayer();
  await Promise.resolve();

  useServiceStore.getState().onPlayerStateChanged({
    paused: false,
    position: 7000,
    duration: 30000,
    track_window: { current_track: { uri: "spotify:track:sdk", name: "SDK Song", artists: [{ name: "SDK Artist" }], album: { name: "SDK Album", images: [] } } },
  } as any);
  pending.resolve(spotifyResponse("old-remote"));
  await Promise.resolve();
  await Promise.resolve();

  expect(useServiceStore.getState().trackName).toBe("SDK Song");
  expect(useServiceStore.getState().positionMs).toBe(7000);
});

it("discards an in-flight remote response after leaving Spotify mode", async () => {
  const pending = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValue(pending.promise);
  vi.stubGlobal("fetch", fetchMock);
  useSettingsStore.setState({ spotifyMode: true });
  initSpotifyPlayer();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  useSettingsStore.getState().setSpotifyMode(false);
  pending.resolve(spotifyResponse("out-of-mode"));
  await Promise.resolve();
  await Promise.resolve();

  expect(useServiceStore.getState().trackName).toBe("");
  expect(useServiceStore.getState().positionMs).toBe(0);
});
