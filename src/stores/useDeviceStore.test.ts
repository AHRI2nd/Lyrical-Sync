import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// zustand persist(useSettingsStore/useI18nStore)용 최소 localStorage 폴리필 (node 환경)
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

const pushErrorToast = vi.fn();
vi.mock("./useToastStore", () => ({ toast: { error: (m: string) => pushErrorToast(m) } }));

import { useDeviceStore } from "./useDeviceStore";
import { useSettingsStore } from "./useSettingsStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useDeviceStore — failure notification", () => {
  beforeEach(() => {
    invoke.mockReset();
    pushErrorToast.mockClear();
    useSettingsStore.getState().setDeviceMode(false);
    useDeviceStore.setState({ hasSession: false, isPlaying: false, positionMs: 0, trackName: "" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    useDeviceStore.getState().stopPolling();
    vi.useRealTimers();
  });

  it("shows a toast once when the adapter fails, then stops repeating it while still failing", async () => {
    invoke.mockRejectedValue(new Error("adapter broken"));
    useSettingsStore.getState().setDeviceMode(true);

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate poll

    expect(pushErrorToast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // 2nd poll, still failing
    await vi.advanceTimersByTimeAsync(1000); // 3rd poll, still failing

    expect(pushErrorToast).toHaveBeenCalledTimes(1);
  });

  it("re-notifies after a successful poll resets the streak and it fails again", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    invoke.mockRejectedValueOnce(new Error("adapter broken"));

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushErrorToast).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValueOnce(null); // recovers — no active session, but call succeeds
    await vi.advanceTimersByTimeAsync(1000);

    invoke.mockRejectedValueOnce(new Error("adapter broken again"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(pushErrorToast).toHaveBeenCalledTimes(2);
  });

  it("does not poll or notify while device mode is off", async () => {
    useSettingsStore.getState().setDeviceMode(false);
    invoke.mockRejectedValue(new Error("adapter broken"));

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).not.toHaveBeenCalled();
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("starting polling again resets the failure streak flag", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    invoke.mockRejectedValue(new Error("adapter broken"));

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushErrorToast).toHaveBeenCalledTimes(1);

    useDeviceStore.getState().stopPolling();
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(pushErrorToast).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow polls and schedules the next poll after the previous one settles", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    const first = deferred<null>();
    invoke.mockReturnValue(first.promise);

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(1);

    first.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("ignores a native response that resolves after polling was stopped and restarted", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    const stale = deferred<any>();
    invoke.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({
      title: "Current", artist: "Artist", album: "Album", position_ms: 1200,
      duration_ms: 30000, is_playing: false, source_app: "Test", last_updated_unix_ms: Date.now(),
    });

    useDeviceStore.getState().startPolling();
    useDeviceStore.getState().stopPolling();
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(useDeviceStore.getState().trackName).toBe("Current");

    stale.resolve({
      title: "Stale", artist: "Artist", album: "Album", position_ms: 9000,
      duration_ms: 30000, is_playing: true, source_app: "Test", last_updated_unix_ms: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(useDeviceStore.getState().trackName).toBe("Current");
    expect(useDeviceStore.getState().positionMs).toBe(1200);
  });

  it("ignores a native response that resolves after leaving device mode", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    const pending = deferred<any>();
    invoke.mockReturnValue(pending.promise);
    useDeviceStore.getState().startPolling();
    useSettingsStore.getState().setDeviceMode(false);
    pending.resolve({
      title: "Out of mode", artist: "Artist", album: "Album", position_ms: 5000,
      duration_ms: 30000, is_playing: false, source_app: "Test", last_updated_unix_ms: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(useDeviceStore.getState().trackName).toBe("");
    expect(useDeviceStore.getState().hasSession).toBe(false);
  });
});
