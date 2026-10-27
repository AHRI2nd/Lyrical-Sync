import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { useServiceStore } from "./useServiceStore";

const reset = () =>
  useServiceStore.setState({
    isLoggedIn: false,
    accessToken: null,
    tokenExpiresAt: null,
    _pendingCodeVerifier: null,
    _pendingOAuthState: null,
    deviceId: null,
    playerError: null,
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
      if (cmd === "load_refresh_token") return Promise.resolve("stored-refresh-token");
      if (cmd === "refresh_spotify_token") {
        return Promise.resolve({ accessToken: "new-token", refreshToken: undefined, expiresIn: 3600 });
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
      if (cmd === "load_refresh_token") return Promise.resolve("stored-refresh-token");
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
  });

  it("refreshAccessToken re-persists a rotated refresh token", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "load_refresh_token") return Promise.resolve("old-refresh-token");
      if (cmd === "refresh_spotify_token") {
        return Promise.resolve({ accessToken: "new-token", refreshToken: "rotated-refresh-token", expiresIn: 3600 });
      }
      return Promise.resolve(undefined);
    });

    await useServiceStore.getState().refreshAccessToken();
    expect(invoke).toHaveBeenCalledWith("save_refresh_token", { token: "rotated-refresh-token" });
  });

  it("refreshAccessToken logs out on invalid_grant instead of retrying", async () => {
    useServiceStore.setState({ isLoggedIn: true, accessToken: "old-token", tokenExpiresAt: 0 });
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "load_refresh_token") return Promise.resolve("stored-refresh-token");
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
      if (cmd === "load_refresh_token") return Promise.resolve("stored-refresh-token");
      if (cmd === "refresh_spotify_token") return Promise.reject(new Error("network error"));
      return Promise.resolve(undefined);
    });

    await expect(useServiceStore.getState().refreshAccessToken()).rejects.toThrow("network error");
    expect(useServiceStore.getState().isLoggedIn).toBe(true);
  });

  it("refreshAccessToken throws when there is no stored refresh token", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "load_refresh_token") return Promise.resolve(null);
      return Promise.resolve(undefined);
    });

    await expect(useServiceStore.getState().refreshAccessToken()).rejects.toThrow("no_refresh_token");
  });
});

describe("useServiceStore — session restore & logout", () => {
  beforeEach(() => {
    reset();
    invoke.mockReset();
  });

  it("tryRestoreSession logs in with a near-expired token when a stored token exists", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "load_refresh_token" ? Promise.resolve("stored-refresh-token") : Promise.resolve(undefined)
    );
    await useServiceStore.getState().tryRestoreSession();
    expect(useServiceStore.getState().isLoggedIn).toBe(true);
    expect(useServiceStore.getState().tokenExpiresAt).toBe(0);
  });

  it("tryRestoreSession is a no-op when there is no stored token", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "load_refresh_token" ? Promise.resolve(null) : Promise.resolve(undefined)
    );
    await useServiceStore.getState().tryRestoreSession();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
  });

  it("tryRestoreSession silently skips when the keyring is unavailable", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("keyring unavailable")));
    await expect(useServiceStore.getState().tryRestoreSession()).resolves.toBeUndefined();
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
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

describe("OAuth listener security", () => {
  beforeEach(() => { reset(); invoke.mockReset(); invoke.mockResolvedValue(undefined); });
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
    const { useSettingsStore } = await import("./useSettingsStore");
    useSettingsStore.setState({ spotifyClientId: "generation-client" });
    invoke.mockReset().mockResolvedValue(undefined);
    openUrl.mockReset().mockResolvedValue(undefined);
  });

  it("discards a refresh response that arrives after logout and never saves its rotated token", async () => {
    const exchange = deferred<{ accessToken: string; refreshToken: string; expiresIn: number }>();
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
    exchange.resolve({ accessToken: "stale-access", refreshToken: "stale-refresh", expiresIn: 3600 });
    await expect(callback).rejects.toThrow("auth_changed");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("clear_refresh_token"));
    expect(invoke).not.toHaveBeenCalledWith("save_refresh_token", expect.anything());
    expect(useServiceStore.getState().isLoggedIn).toBe(false);
    expect(useServiceStore.getState().accessToken).toBeNull();
  });

  it("consumes an OAuth callback only once", async () => {
    useServiceStore.setState({ _pendingCodeVerifier: "verifier", _pendingOAuthState: "state" });
    invoke.mockImplementation((command: string) => command === "exchange_spotify_token"
      ? Promise.resolve({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600 })
      : Promise.resolve(undefined));

    await useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state");

    await expect(useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state"))
      .rejects.toThrow("invalid_callback");
    expect(invoke.mock.calls.filter(([command]) => command === "exchange_spotify_token")).toHaveLength(1);
  });

  it("keeps a new generation refresh independent from an older pending refresh", async () => {
    const oldRefresh = deferred<{ accessToken: string; expiresIn: number }>();
    const newRefresh = deferred<{ accessToken: string; expiresIn: number }>();
    let refreshCount = 0;
    invoke.mockImplementation((command: string) => {
      if (command === "load_refresh_token") return Promise.resolve(refreshCount === 0 ? "old-refresh" : "new-refresh");
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
    const load = deferred<string | null>();
    invoke.mockImplementation((command: string) => command === "load_refresh_token" ? load.promise : Promise.resolve(undefined));
    const restore = useServiceStore.getState().tryRestoreSession();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("load_refresh_token"));
    useServiceStore.getState().logout();
    load.resolve("stale-refresh");
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

  it("serializes an already-started token save before logout clear so the durable token ends empty", async () => {
    const save = deferred<void>();
    let storedToken: string | null = "old-refresh";
    useServiceStore.setState({ isLoggedIn: true, _pendingCodeVerifier: "verifier", _pendingOAuthState: "state" });
    invoke.mockImplementation((command: string, args?: { token?: string }) => {
      if (command === "exchange_spotify_token") return Promise.resolve({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 });
      if (command === "save_refresh_token") return save.promise.then(() => { storedToken = args?.token ?? null; });
      if (command === "clear_refresh_token") { storedToken = null; return Promise.resolve(undefined); }
      return Promise.resolve(undefined);
    });
    const callback = useServiceStore.getState().handleCallback("http://localhost/callback?code=c&state=state");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("save_refresh_token", { token: "new-refresh" }));
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
});
