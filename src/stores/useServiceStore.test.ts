import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// zustand persist(useSettingsStore)용 최소 localStorage 폴리필 (node 환경)
if (typeof globalThis.localStorage === "undefined") {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const { invoke, openUrl } = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...args: unknown[]) => openUrl(...args) }));

import { spotifyApiRequest, useServiceStore } from "./useServiceStore";
import { useSettingsStore } from "./useSettingsStore";
import { useLrcStore } from "./useLrcStore";
import { useToastStore } from "./useToastStore";
import { useI18nStore } from "./useI18nStore";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reset = () =>
  useServiceStore.setState({
    isLoggedIn: false,
    accessToken: null,
    tokenExpiresAt: null,
    _pendingCodeVerifier: null,
    _pendingOAuthState: null,
    deviceId: null,
    activePlaybackDeviceId: null,
    activePlaybackVolumePercent: null,
    playerError: null,
    oauthCallbackListenerReady: false,
    isReady: false,
    isPlaying: false,
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useServiceStore — token refresh", () => {
  beforeEach(() => {
    reset();
    useServiceStore.setState({ isLoggedIn: true });
    invoke.mockReset();
  });

  it("ensureToken returns the cached token without invoking when far from expiry", async () => {
    useServiceStore.setState({ accessToken: "cached-token", tokenExpiresAt: Date.now() + 60 * 60 * 1000 });
    const token = await useServiceStore.getState().ensureToken();
    expect(token).toBe("cached-token");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ensureToken refreshes when the token is within 60s of expiry", async () => {
    useServiceStore.setState({ accessToken: "stale-token", tokenExpiresAt: Date.now() + 1000 });
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "refresh_spotify_token") {
        return Promise.resolve({ accessToken: "new-token", expiresIn: 3600 });
      }
      return Promise.resolve(undefined);
    });

    const token = await useServiceStore.getState().ensureToken();
    expect(token).toBe("new-token");
    expect(useServiceStore.getState().accessToken).toBe("new-token");
  });

  it("refreshAccessToken dedupes concurrent calls into a single refresh request", async () => {
    useServiceStore.setState({ accessToken: null, tokenExpiresAt: 0 });
    let refreshCalls = 0;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "refresh_spotify_token") {
        refreshCalls++;
        return new Promise((resolve) =>
          setTimeout(() => resolve({ accessToken: "new-token", expiresIn: 3600 }), 10)
        );
      }
      return Promise.resolve(undefined);
    });

    const [a, b] = await Promise.all([
      useServiceStore.getState().refreshAccessToken(),
      useServiceStore.getState().refreshAccessToken(),
    ]);
    expect(a).toBe(b);
    expect(refreshCalls).toBe(1);
    expect(invoke).not.toHaveBeenCalledWith("load_refresh_token", expect.anything());
    expect(invoke).toHaveBeenCalledWith("refresh_spotify_token", { clientId: "" });
  });

  it("keeps refresh token rotation inside the native command", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "refresh_spotify_token") {
        return Promise.resolve({ accessToken: "new-token", expiresIn: 3600 });
      }
      return Promise.resolve(undefined);
    });

    await useServiceStore.getState().refreshAccessToken();
    expect(invoke).toHaveBeenCalledWith("refresh_spotify_token", { clientId: "" });
    expect(invoke).not.toHaveBeenCalledWith("load_refresh_token", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("save_refresh_token", expect.anything());
  });

  it("refreshAccessToken logs out on invalid_grant instead of retrying", async () => {
    useServiceStore.setState({ isLoggedIn: true, accessToken: "old-token", tokenExpiresAt: 0 });
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "refresh_spotify_token") return Promise.reject(new Error("invalid_grant"));
      if (cmd === "clear_refresh_token") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await expect(useServiceStore.getState().refreshAccessToken()).rejects.toThrow("invalid_grant");
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
    expect(invoke).toHaveBeenCalledWith("clear_refresh_token");
  });

  it("refreshAccessToken does not log out on a transient (non invalid_grant) failure", async () => {
    useServiceStore.setState({ isLoggedIn: true, accessToken: "old-token", tokenExpiresAt: 0 });
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "refresh_spotify_token") return Promise.reject(new Error("network error"));
      return Promise.resolve(undefined);
    });

    await expect(useServiceStore.getState().refreshAccessToken()).rejects.toThrow("network error");
    expect(useServiceStore.getState().isLoggedIn).toBe(true);
  });

  it("refreshAccessToken throws when there is no stored refresh token", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "refresh_spotify_token") return Promise.reject(new Error("no_refresh_token"));
      return Promise.resolve(undefined);
    });

    await expect(useServiceStore.getState().refreshAccessToken()).rejects.toThrow("no_refresh_token");
  });
});

describe("useServiceStore — player state", () => {
  beforeEach(() => {
    reset();
    useSettingsStore.setState({ spotifyMode: true });
    useLrcStore.getState().setCurrentTime(45);
    useServiceStore.setState({
      isPlaying: true,
      positionMs: 45000,
      durationMs: 180000,
      trackUri: "spotify:track:old",
      trackName: "Old track",
      artistName: "Artist",
      albumName: "Album",
      albumArtUrl: "https://example.test/cover.jpg",
      _lastKnownPositionMs: 45000,
      _lastStateTimestamp: Date.now(),
    });
  });

  it("clears stale playback and lyric time when the SDK state has no current track", () => {
    useServiceStore.getState().onPlayerStateChanged({
      paused: true,
      position: 0,
      duration: 0,
      track_window: { current_track: null },
    } as unknown as Spotify.PlaybackState);

    expect(useServiceStore.getState()).toMatchObject({
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      trackUri: null,
      trackName: "",
      artistName: "",
      albumName: "",
      albumArtUrl: null,
      _lastKnownPositionMs: 0,
    });
    expect(useLrcStore.getState().currentTime).toBe(0);
  });

  it("does not start interpolation or overwrite lyrics from a late SDK event outside Spotify mode", () => {
    useSettingsStore.setState({ spotifyMode: false });
    const doc = { ...useLrcStore.getState().doc, metadata: { ...useLrcStore.getState().doc.metadata, title: "Local title" } };
    useLrcStore.setState({ doc, currentTime: 12 });
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    useServiceStore.getState().onPlayerStateChanged({
      paused: false,
      position: 45_000,
      duration: 180_000,
      track_window: { current_track: {
        uri: "spotify:track:late", name: "Late SDK track", artists: [{ name: "Artist" }],
        album: { name: "Album", images: [] },
      } },
    } as unknown as Spotify.PlaybackState);

    expect(useServiceStore.getState().trackName).toBe("Late SDK track");
    expect(requestFrame).not.toHaveBeenCalled();
    expect(useLrcStore.getState().doc).toBe(doc);
    expect(useLrcStore.getState().currentTime).toBe(12);
  });
});

describe("currently playing response shapes", () => {
  beforeEach(() => {
    reset();
    useServiceStore.setState({
      isLoggedIn: true,
      accessToken: "token",
      tokenExpiresAt: Date.now() + 3_600_000,
    });
  });

  it("maps Spotify episode items without assuming track artist or album fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          uri: "spotify:episode:episode-id",
          name: "Episode title",
          duration_ms: 1_200_000,
          show: {
            name: "Podcast name",
            publisher: "Podcast publisher",
            images: [{ url: "https://images.example/podcast.jpg" }],
          },
        },
      }),
    }));

    await expect(useServiceStore.getState().fetchCurrentlyPlaying()).resolves.toEqual({
      uri: "spotify:episode:episode-id",
      name: "Episode title",
      artistName: "Podcast publisher",
      albumName: "Podcast name",
      albumArtUrl: "https://images.example/podcast.jpg",
      durationMs: 1_200_000,
    });
  });

  it("rejects a malformed currently playing item with a stable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ item: { name: "Missing URI and duration" } }),
    }));

    await expect(useServiceStore.getState().fetchCurrentlyPlaying()).rejects.toThrow("invalid_spotify_playback_item");
  });
});

describe("useServiceStore — session restore & logout", () => {
  beforeEach(() => {
    reset();
    invoke.mockReset();
  });

  it("tryRestoreSession logs in with a near-expired token when a stored token exists", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "has_refresh_token" ? Promise.resolve(true) : Promise.resolve(undefined)
    );
    await useServiceStore.getState().tryRestoreSession();
    expect(useServiceStore.getState().isLoggedIn).toBe(true);
    expect(useServiceStore.getState().tokenExpiresAt).toBe(0);
  });

  it("tryRestoreSession is a no-op when there is no stored token", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "has_refresh_token" ? Promise.resolve(false) : Promise.resolve(undefined)
    );
    await useServiceStore.getState().tryRestoreSession();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
  });

  it("reports credential-store failures while preserving the signed-out state", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("keyring unavailable")));
    useToastStore.setState({ toasts: [] });
    useI18nStore.getState().setLang("en");
    await expect(useServiceStore.getState().tryRestoreSession()).resolves.toBeUndefined();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "error",
      message: useI18nStore.getState().t.toast.spotifySessionRestoreFailed,
    });
  });

  it("logout clears auth state and playback fields", async () => {
    useServiceStore.setState({
      isLoggedIn: true,
      accessToken: "token",
      tokenExpiresAt: Date.now() + 1000,
      trackName: "Some Song",
    });
    invoke.mockResolvedValue(undefined);
    useServiceStore.getState().logout();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
    expect(useServiceStore.getState().trackName).toBe("");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("clear_refresh_token"));
    expect(invoke).toHaveBeenCalledWith("clear_refresh_token");
  });
});

describe("useServiceStore — Spotify repeat ownership", () => {
  beforeEach(() => {
    reset();
    useServiceStore.setState({ isLoggedIn: true, accessToken: "token", tokenExpiresAt: Date.now() + 3600000, isLooping: false });
  });

  it("adopts track-repeat state from SDK playback events before the next toggle", async () => {
    useSettingsStore.setState({ spotifyMode: true });
    useServiceStore.getState().onPlayerStateChanged({
      paused: true,
      position: 5_000,
      duration: 30_000,
      repeat_mode: 1,
      track_window: { current_track: { uri: "spotify:track:repeat", name: "Repeat", artists: [{ name: "Artist" }], album: { name: "Album", images: [] } } },
    } as any);
    expect(useServiceStore.getState().isLooping).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await useServiceStore.getState().toggleLoop();

    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.spotify.com/v1/me/player/repeat?state=off");
  });

  it("keeps loop state unchanged when Spotify rejects the repeat request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(useServiceStore.getState().toggleLoop()).rejects.toThrow();
    expect(useServiceStore.getState().isLooping).toBe(false);
  });

  it("does not restore loop state after logout while the repeat request is pending", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const toggle = useServiceStore.getState().toggleLoop();
    expect(useServiceStore.getState().isLooping).toBe(true);
    useServiceStore.getState().logout();
    pending.resolve({ ok: true } as Response);
    await toggle;
    expect(useServiceStore.getState().isLooping).toBe(false);
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
  });

  it("keeps the newest of two repeat toggles when responses finish in reverse order", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const older = useServiceStore.getState().toggleLoop();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const newer = useServiceStore.getState().toggleLoop();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(useServiceStore.getState().isLooping).toBe(false);
    second.resolve({ ok: true } as Response);
    await newer;
    first.resolve({ ok: true } as Response);
    await older;
    expect(useServiceStore.getState().isLooping).toBe(false);
  });
});

describe("Spotify API request failures", () => {
  beforeEach(() => {
    reset();
    useServiceStore.setState({ isLoggedIn: true, accessToken: "token", tokenExpiresAt: Date.now() + 3600000 });
  });

  it("does not report an HTTP error as an empty device list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(useServiceStore.getState().fetchDevices()).rejects.toThrow("403");
  });

  it("rejects malformed successful Spotify device responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: "not-an-array" }),
    }));
    await expect(useServiceStore.getState().fetchDevices()).rejects.toThrow("invalid_spotify_devices");
  });

  it("filters malformed Spotify device entries before the picker consumes them", async () => {
    const valid = { id: "device-1", name: "Speaker", type: "speaker", is_active: false, volume_percent: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: [valid, null, { id: "missing-fields" }] }),
    }));
    await expect(useServiceStore.getState().fetchDevices()).resolves.toEqual([valid]);
  });

  it("never sends the Spotify bearer token to a non-Spotify origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(spotifyApiRequest("https://attacker.example/collect", {}, async () => undefined))
      .rejects.toThrow("invalid_spotify_origin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a Spotify API request when the session logs out", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }));

    const pending = useServiceStore.getState().transferToDevice("device", false);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    useServiceStore.getState().logout();

    await expect(pending).rejects.toThrow();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("does not send a track play request after logout during token refresh", async () => {
    useServiceStore.setState({ accessToken: null, tokenExpiresAt: 0 });
    const refresh = deferred<{ accessToken: string; expiresIn: number }>();
    invoke.mockImplementation((command: string) => {
      if (command === "refresh_spotify_token") return refresh.promise;
      return Promise.resolve(undefined);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pendingPlay = useServiceStore.getState().playTrack("spotify:track:track-id");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("refresh_spotify_token", expect.any(Object)));
    useServiceStore.getState().logout();
    await expect(pendingPlay).rejects.toThrow();
    refresh.resolve({ accessToken: "stale-token", expiresIn: 3600 });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
  });

  it("includes token refresh in the Spotify request deadline", async () => {
    vi.useFakeTimers();
    useServiceStore.setState({ accessToken: null, tokenExpiresAt: 0 });
    const refresh = deferred<{ accessToken: string; expiresIn: number }>();
    invoke.mockImplementation((command: string) => {
      if (command === "refresh_spotify_token") return refresh.promise;
      return Promise.resolve(undefined);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pending = spotifyApiRequest("https://api.spotify.com/v1/me/player/devices", {}, async (response) => response.json());
    const outcome = expect(pending).rejects.toThrow("spotify_timeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await outcome;
    refresh.resolve({ accessToken: "late-token", expiresIn: 3600 });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("times out a stalled Spotify API request", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }));

    const pending = useServiceStore.getState().fetchDevices();
    const outcome = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await outcome;
    expect(observedSignal?.aborted).toBe(true);
  });
});

describe("OAuth listener security", () => {
  beforeEach(() => {
    reset();
    useServiceStore.setState({ oauthCallbackListenerReady: true });
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });
  it("does not start Spotify login until the app callback listener is ready", async () => {
    const { useSettingsStore } = await import("./useSettingsStore");
    useSettingsStore.setState({ spotifyClientId: "public-client-id" });
    useServiceStore.setState({ oauthCallbackListenerReady: false });

    await expect(useServiceStore.getState().startLogin()).rejects.toThrow("spotify_callback_listener_unavailable");
    expect(invoke).not.toHaveBeenCalledWith("start_oauth_listener", expect.anything());
    expect(openUrl).not.toHaveBeenCalled();
  });
  it("passes the pending random state to the native listener", async () => {
    const { useSettingsStore } = await import("./useSettingsStore");
    useSettingsStore.setState({ spotifyClientId: "public-client-id" });
    await useServiceStore.getState().startLogin();
    expect(invoke).toHaveBeenCalledWith("start_oauth_listener", { state: useServiceStore.getState()._pendingOAuthState });
  });
  it("logout cancels the listener and invalidates pending callback credentials", async () => {
    useServiceStore.setState({ _pendingOAuthState: "old-state", _pendingCodeVerifier: "old-verifier" });
    useServiceStore.getState().logout();
    expect(useServiceStore.getState()._pendingOAuthState).toBeNull();
    expect(useServiceStore.getState()._pendingCodeVerifier).toBeNull();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_oauth_listener"));
  });
});

describe("auth generation ownership", () => {
  beforeEach(async () => {
    reset();
    useServiceStore.setState({ oauthCallbackListenerReady: true });
    const { useSettingsStore } = await import("./useSettingsStore");
    useSettingsStore.setState({ spotifyClientId: "generation-client" });
    invoke.mockReset().mockResolvedValue(undefined);
    openUrl.mockReset().mockResolvedValue(undefined);
  });

  it("discards a refresh response that arrives after logout and never saves its rotated token", async () => {
    const exchange = deferred<{ accessToken: string; refreshTokenHandle?: string; expiresIn: number }>();
    useServiceStore.setState({
      isLoggedIn: true, _pendingCodeVerifier: "verifier", _pendingOAuthState: "state",
    });
    invoke.mockImplementation((command: string) => {
      if (command === "exchange_spotify_token") return exchange.promise;
      return Promise.resolve(undefined);
    });
    const callback = useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("exchange_spotify_token", expect.any(Object)));
    useServiceStore.getState().logout();
    exchange.resolve({ accessToken: "stale-access", refreshTokenHandle: "stale-handle", expiresIn: 3600 });
    await expect(callback).rejects.toThrow("auth_changed");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("clear_refresh_token"));
    expect(invoke).not.toHaveBeenCalledWith("persist_pending_refresh_token", expect.anything());
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
  });

  it("consumes an OAuth callback only once", async () => {
    useServiceStore.setState({ _pendingCodeVerifier: "verifier", _pendingOAuthState: "state" });
    invoke.mockImplementation((command: string) => command === "exchange_spotify_token"
      ? Promise.resolve({ accessToken: "access", refreshTokenHandle: "pending-handle", expiresIn: 3600 })
      : Promise.resolve(undefined));

    await useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state");
    expect(invoke).toHaveBeenCalledWith("exchange_spotify_token", expect.objectContaining({ state: "state" }));
    expect(invoke).toHaveBeenCalledWith("persist_pending_refresh_token", { handle: "pending-handle" });

    await expect(useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state"))
      .rejects.toThrow("invalid_callback");
    expect(invoke.mock.calls.filter(([command]) => command === "exchange_spotify_token")).toHaveLength(1);
  });

  it("keeps a new generation refresh independent from an older pending refresh", async () => {
    const oldRefresh = deferred<{ accessToken: string; expiresIn: number }>();
    const newRefresh = deferred<{ accessToken: string; expiresIn: number }>();
    let refreshCount = 0;
    invoke.mockImplementation((command: string) => {
      if (command === "refresh_spotify_token") return ++refreshCount === 1 ? oldRefresh.promise : newRefresh.promise;
      return Promise.resolve(undefined);
    });
    useServiceStore.setState({ isLoggedIn: true, tokenExpiresAt: 0 });
    const oldRequest = useServiceStore.getState().refreshAccessToken();
    await vi.waitFor(() => expect(refreshCount).toBe(1));

    useServiceStore.getState().logout();
    useServiceStore.setState({ isLoggedIn: true, tokenExpiresAt: 0 });
    const newRequest = useServiceStore.getState().refreshAccessToken();
    await vi.waitFor(() => expect(refreshCount).toBe(2));
    newRefresh.resolve({ accessToken: "new-access", expiresIn: 3600 });
    await newRequest;
    oldRefresh.resolve({ accessToken: "old-access", expiresIn: 3600 });
    await expect(oldRequest).rejects.toThrow("auth_changed");

    expect(useServiceStore.getState().accessToken).toBe("new-access");
    expect(useServiceStore.getState().isLoggedIn).toBe(true);
  });

  it("does not restore a stored token after logout while keychain loading is pending", async () => {
    const load = deferred<boolean>();
    invoke.mockImplementation((command: string) => command === "has_refresh_token" ? load.promise : Promise.resolve(undefined));
    const restore = useServiceStore.getState().tryRestoreSession();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("has_refresh_token"));
    useServiceStore.getState().logout();
    load.resolve(true);
    await restore;
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
  });

  it("does not open the browser when OAuth listener startup finishes after logout", async () => {
    const listener = deferred<void>();
    invoke.mockImplementation((command: string) => command === "start_oauth_listener" ? listener.promise : Promise.resolve(undefined));
    const login = useServiceStore.getState().startLogin();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("start_oauth_listener", expect.any(Object)));
    useServiceStore.getState().logout();
    listener.resolve();
    await login;
    expect(openUrl).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_oauth_listener"));
  });

  it("prevents logged-out ensureToken from loading or refreshing credentials", async () => {
    await expect(useServiceStore.getState().ensureToken()).rejects.toThrow("no_token");
    await expect(useServiceStore.getState().refreshAccessToken()).rejects.toThrow("not_logged_in");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("serializes a pending native credential save before logout clear", async () => {
    const save = deferred<void>();
    let storedToken: string | null = "old-refresh";
    useServiceStore.setState({ isLoggedIn: true, _pendingCodeVerifier: "verifier", _pendingOAuthState: "state" });
    invoke.mockImplementation((command: string) => {
      if (command === "exchange_spotify_token") return Promise.resolve({ accessToken: "new-access", refreshTokenHandle: "pending-handle", expiresIn: 3600 });
      if (command === "persist_pending_refresh_token") return save.promise.then(() => { storedToken = "persisted"; });
      if (command === "clear_refresh_token") { storedToken = null; return Promise.resolve(undefined); }
      return Promise.resolve(undefined);
    });
    const callback = useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("persist_pending_refresh_token", { handle: "pending-handle" }));
    useServiceStore.getState().logout();
    save.resolve();
    await expect(callback).rejects.toThrow("auth_changed");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("clear_refresh_token"));
    await Promise.resolve();
    expect(storedToken).toBeNull();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
  });

  it("invalidates the session synchronously when the Spotify Client ID changes", async () => {
    const { useSettingsStore } = await import("./useSettingsStore");
    useServiceStore.setState({ isLoggedIn: true, accessToken: "token", tokenExpiresAt: Date.now() + 3600000 });
    const before = useServiceStore.getState()._authGeneration;
    useSettingsStore.getState().setSpotifyClientId("replacement-client");
    expect(useServiceStore.getState()._authGeneration).toBeGreaterThan(before);
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
  });

  it("does not mark OAuth login complete when the refresh token cannot be stored", async () => {
    useServiceStore.setState({ _pendingCodeVerifier: "verifier", _pendingOAuthState: "state" });
    invoke.mockImplementation((command: string) => command === "exchange_spotify_token"
      ? Promise.resolve({ accessToken: "access", refreshTokenHandle: "pending-handle", expiresIn: 3600 })
      : command === "persist_pending_refresh_token"
        ? Promise.reject(new Error("credential store failed"))
        : Promise.resolve(undefined));

    await expect(useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state"))
      .rejects.toThrow("credential store failed");
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
  });

  it("reports when logout cannot remove persisted credentials", async () => {
    const { useToastStore } = await import("../stores/useToastStore");
    const { useI18nStore } = await import("./useI18nStore");
    useToastStore.setState({ toasts: [] });
    invoke.mockImplementation((command: string) => command === "clear_refresh_token"
      ? Promise.reject(new Error("credential store failed"))
      : Promise.resolve(undefined));

    useServiceStore.getState().logout();
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]?.message).toBe(useI18nStore.getState().t.toast.spotifyTokenCleanupFailed);
  });
});
