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
import { useLrcStore } from "./useLrcStore";
import { deviceControls } from "../utils/deviceControls";

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
    vi.unstubAllGlobals();
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

  it("clears a previous device session synchronously when entering device mode", () => {
    useDeviceStore.setState({
      hasSession: true,
      isPlaying: true,
      positionMs: 12_000,
      durationMs: 60_000,
      trackName: "Previous session",
      sourceApp: "Old player",
    });

    useSettingsStore.getState().setDeviceMode(true);

    expect(useDeviceStore.getState()).toMatchObject({
      hasSession: false,
      isPlaying: false,
      positionMs: 0,
      trackName: "",
      sourceApp: "",
    });
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

  it("does not expose or control the previous session while a restarted poll is pending", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    const pending = deferred<any>();
    invoke.mockReturnValue(pending.promise);
    useDeviceStore.setState({ hasSession: true, isPlaying: false, trackName: "Previous track", positionMs: 12000 });

    useDeviceStore.getState().startPolling();
    expect(useDeviceStore.getState()).toMatchObject({ hasSession: false, trackName: "", positionMs: 0 });
    deviceControls.togglePlay();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_now_playing");
  });

  it("clears local playback time when entering device mode without a session", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    useLrcStore.getState().setCurrentTime(42);
    invoke.mockResolvedValueOnce(null);

    useDeviceStore.getState().startPolling();

    expect(useDeviceStore.getState().hasSession).toBe(false);
    expect(useLrcStore.getState().currentTime).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(useLrcStore.getState().currentTime).toBe(0);
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

  it("does not let a poll started before a seek overwrite the requested position", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    useDeviceStore.setState({ hasSession: true });
    const poll = deferred<any>();
    invoke.mockImplementation((command: string) => command === "get_now_playing" ? poll.promise : Promise.resolve());
    useDeviceStore.getState().startPolling();
    useDeviceStore.setState({ hasSession: true });
    deviceControls.seekTo(5);
    expect(useDeviceStore.getState().positionMs).toBe(5000);

    poll.resolve({ title: "Track", artist: "Artist", album: "Album", position_ms: 1200,
      duration_ms: 30000, is_playing: false, source_app: "Test", last_updated_unix_ms: Date.now() });
    await vi.advanceTimersByTimeAsync(0);

    expect(useDeviceStore.getState().positionMs).toBe(5000);
  });

  it("ignores non-finite seek positions without mutating state or calling native code", () => {
    useDeviceStore.setState({ hasSession: true, positionMs: 1250, _lastKnownPositionMs: 1200 });

    deviceControls.seekTo(Number.NaN);
    deviceControls.seekTo(Number.POSITIVE_INFINITY);
    deviceControls.seekTo(Number.NEGATIVE_INFINITY);
    deviceControls.seekTo(Number.MAX_SAFE_INTEGER);

    expect(useDeviceStore.getState()).toMatchObject({ positionMs: 1250, _lastKnownPositionMs: 1200 });
    expect(invoke).not.toHaveBeenCalled();
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("does not roll back a newer polled track position when an old seek fails", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    useDeviceStore.setState({
      hasSession: true, trackName: "Old track", sourceApp: "Old player", positionMs: 1000,
      durationMs: 30000, _lastKnownPositionMs: 1000, _lastStateTimestamp: Date.now(),
    });
    let rejectSeek!: (error: Error) => void;
    const pendingSeek = new Promise<void>((_resolve, reject) => { rejectSeek = reject; });
    invoke.mockImplementation((command: string) => command === "now_playing_seek"
      ? pendingSeek
      : Promise.resolve({ title: "New track", artist: "Artist", album: "Album", position_ms: 9000,
        duration_ms: 30000, is_playing: false, source_app: "New player", last_updated_unix_ms: Date.now() }));

    deviceControls.seekTo(5);
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(useDeviceStore.getState()).toMatchObject({ trackName: "New track", positionMs: 9000 });

    rejectSeek(new Error("stale seek failed"));
    await vi.waitFor(() => expect(pushErrorToast).toHaveBeenCalledOnce());
    expect(useDeviceStore.getState()).toMatchObject({ trackName: "New track", positionMs: 9000 });
  });

  it("reports a failed seek and lets the next poll restore the authoritative position", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    useDeviceStore.setState({ hasSession: true });
    invoke.mockImplementation((command: string) => command === "now_playing_seek"
      ? Promise.reject(new Error("seek failed"))
      : Promise.resolve({ title: "Track", artist: "Artist", album: "Album", position_ms: 1200,
        duration_ms: 30000, is_playing: false, source_app: "Test", last_updated_unix_ms: Date.now() }));

    deviceControls.seekTo(5);
    await vi.waitFor(() => expect(pushErrorToast).toHaveBeenCalledOnce());
    expect(useDeviceStore.getState().positionMs).toBe(0);
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(useDeviceStore.getState().positionMs).toBe(1200);
  });

  it("rolls back an optimistic play toggle and reports command failure", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useDeviceStore.setState({ hasSession: true, isPlaying: false, positionMs: 1250, _lastKnownPositionMs: 1200 });
    invoke.mockRejectedValue(new Error("toggle failed"));

    deviceControls.togglePlay();
    expect(useDeviceStore.getState().isPlaying).toBe(true);
    await vi.waitFor(() => expect(pushErrorToast).toHaveBeenCalledOnce());

    expect(useDeviceStore.getState().isPlaying).toBe(false);
    expect(useDeviceStore.getState().positionMs).toBe(1250);
    expect(useDeviceStore.getState()._lastKnownPositionMs).toBe(1200);
  });

  it("clears stale track timing and editor time when the active session disappears", async () => {
    const { useLrcStore } = await import("./useLrcStore");
    useSettingsStore.getState().setDeviceMode(true);
    useDeviceStore.setState({
      hasSession: true,
      isPlaying: true,
      positionMs: 12000,
      durationMs: 90000,
      trackName: "Previous track",
      artistName: "Artist",
      albumName: "Album",
      sourceApp: "Player",
      _lastKnownPositionMs: 12000,
      _lastStateTimestamp: Date.now(),
    });
    useLrcStore.getState().setCurrentTime(12);
    invoke.mockResolvedValueOnce(null);

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(useDeviceStore.getState()).toMatchObject({
      hasSession: false,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      trackName: "",
      artistName: "",
      albumName: "",
      sourceApp: "",
      _lastKnownPositionMs: 0,
    });
    expect(useLrcStore.getState().currentTime).toBe(0);
  });

  it("does not infer that an invalid native timestamp means playback reached the track end", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    invoke.mockResolvedValue({ title: "Track", artist: "Artist", album: "Album", position_ms: 1500,
      duration_ms: 60000, is_playing: true, source_app: "Test", last_updated_unix_ms: 0 });
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(useDeviceStore.getState().positionMs).toBe(1500);
    expect(useDeviceStore.getState().durationMs).toBe(60000);
  });

  it("does not cap interpolation to duration when duration is unknown", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    const raf: { tick?: FrameRequestCallback } = {};
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { raf.tick = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    invoke.mockResolvedValue({ title: "Unknown length", artist: "Artist", album: "Album", position_ms: 3000,
      duration_ms: 0, is_playing: true, source_app: "Test", last_updated_unix_ms: Date.now() });
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    useDeviceStore.setState({ _lastStateTimestamp: Date.now() - 2000 });
    raf.tick?.(0);
    expect(useDeviceStore.getState().positionMs).toBeGreaterThan(3000);
  });

  it("clamps interpolation at zero if the system clock moves backwards", () => {
    vi.setSystemTime(new Date(10_000));
    useSettingsStore.getState().setDeviceMode(true);
    const raf: { tick?: FrameRequestCallback } = {};
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { raf.tick = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useDeviceStore.setState({
      isPlaying: true,
      positionMs: 1000,
      durationMs: 0,
      _lastKnownPositionMs: 1000,
      _lastStateTimestamp: 10_000,
    });

    useDeviceStore.getState()._startInterpolation();
    vi.setSystemTime(new Date(8_000));
    raf.tick?.(0);

    expect(useDeviceStore.getState().positionMs).toBe(0);
    expect(useLrcStore.getState().currentTime).toBe(0);
  });

  it("keeps lyric stamping aligned with a paused device seek", () => {
    useSettingsStore.getState().setDeviceMode(true);
    useDeviceStore.setState({ hasSession: true, isPlaying: false, positionMs: 59_000, durationMs: 60_000 });
    useLrcStore.setState({
      currentTime: 59,
      doc: { ...useLrcStore.getState().doc, lines: [{ id: "stamp", text: "line", timestamp: null }] },
    });
    invoke.mockReturnValue(new Promise<void>(() => {}));

    deviceControls.seekTo(20);
    useLrcStore.getState().stampCurrentLine("stamp");

    expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(20);
  });

  it("clamps a device skip to the known track duration", () => {
    useSettingsStore.getState().setDeviceMode(true);
    useDeviceStore.setState({ hasSession: true, isPlaying: true, positionMs: 59_000, durationMs: 60_000 });
    invoke.mockReturnValue(new Promise<void>(() => {}));

    deviceControls.skip(5);

    expect(invoke).toHaveBeenCalledWith("now_playing_seek", { positionMs: 60_000 });
    expect(useDeviceStore.getState().positionMs).toBe(60_000);
  });
});
