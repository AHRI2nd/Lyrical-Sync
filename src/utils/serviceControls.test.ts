import { afterEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { serviceControls } from "./serviceControls";
import { useServiceStore } from "../stores/useServiceStore";
import { useLrcStore } from "../stores/useLrcStore";
import { useSettingsStore } from "../stores/useSettingsStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  useServiceStore.getState().logout();
  vi.unstubAllGlobals();
});

it("clamps a Spotify skip to the known track duration", async () => {
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3_600_000,
    isPlaying: true,
    positionMs: 59_000,
    durationMs: 60_000,
    _lastKnownPositionMs: 59_000,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: 0,
  });
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);

  serviceControls.skip(5);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.spotify.com/v1/me/player/seek?position_ms=60000");
  expect(useServiceStore.getState().positionMs).toBe(60_000);
});

it("keeps lyric stamping aligned with a paused Spotify seek", () => {
  useSettingsStore.setState({ spotifyMode: true, deviceMode: false });
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3_600_000,
    isPlaying: false,
    positionMs: 59_000,
    durationMs: 60_000,
    _lastKnownPositionMs: 59_000,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: 0,
  });
  useLrcStore.setState({
    currentTime: 59,
    doc: { ...useLrcStore.getState().doc, lines: [{ id: "stamp", text: "line", timestamp: null }] },
  });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>(() => {})));

  serviceControls.seekTo(20);
  useLrcStore.getState().stampCurrentLine("stamp");

  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(20);
});

it("resets a paused Spotify track to the beginning", async () => {
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3_600_000,
    isPlaying: false,
    positionMs: 12_000,
    durationMs: 60_000,
    _lastKnownPositionMs: 12_000,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: 0,
  });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
  vi.stubGlobal("fetch", fetchMock);

  serviceControls.stopAndReset();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await Promise.resolve();
  await Promise.resolve();

  expect(fetchMock.mock.calls[0][0]).toBe("https://api.spotify.com/v1/me/player/seek?position_ms=0");
  expect(useServiceStore.getState()).toMatchObject({ isPlaying: false, positionMs: 0, _lastKnownPositionMs: 0 });
});

it("does not let a delayed Stop reset a newer Spotify seek", async () => {
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3_600_000,
    isPlaying: true,
    positionMs: 5_000,
    _lastKnownPositionMs: 5_000,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: 0,
  });
  const pause = deferred<Response>();
  const seek = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(pause.promise).mockReturnValueOnce(seek.promise);
  vi.stubGlobal("fetch", fetchMock);

  serviceControls.stopAndReset();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  serviceControls.seekTo(15);
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(useServiceStore.getState().positionMs).toBe(15_000);

  pause.resolve({ ok: true } as Response);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(useServiceStore.getState().positionMs).toBe(15_000);

  seek.resolve({ ok: true } as Response);
  await Promise.resolve();
  await Promise.resolve();
  expect(useServiceStore.getState().positionMs).toBe(15_000);
});

it("sends rapid Spotify seeks in the same order as their optimistic state", async () => {
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3_600_000,
    positionMs: 0,
    durationMs: 60_000,
    _lastKnownPositionMs: 0,
    _lastStateTimestamp: Date.now(),
    _playbackRevision: 0,
  });
  const first = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, status: 204 } as Response);
  vi.stubGlobal("fetch", fetchMock);

  serviceControls.seekTo(10);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  serviceControls.seekTo(20);
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(useServiceStore.getState().positionMs).toBe(20_000);

  first.resolve({ ok: true, status: 204 } as Response);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(String(fetchMock.mock.calls[0][0])).toContain("position_ms=10000");
  expect(String(fetchMock.mock.calls[1][0])).toContain("position_ms=20000");
});
