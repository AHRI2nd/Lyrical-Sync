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

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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

describe("useServiceStore — token refresh", () => {
  beforeEach(() => {
    reset();
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

  it("logout clears auth state and playback fields", () => {
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
    expect(invoke).toHaveBeenCalledWith("clear_refresh_token");
  });
});
