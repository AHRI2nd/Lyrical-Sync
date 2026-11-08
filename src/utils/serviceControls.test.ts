import { afterEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { serviceControls } from "./serviceControls";
import { useServiceStore } from "../stores/useServiceStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

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
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  pause.resolve({ ok: true } as Response);
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(useServiceStore.getState().positionMs).toBe(15_000);

  seek.resolve({ ok: true } as Response);
  await Promise.resolve();
  await Promise.resolve();
  expect(useServiceStore.getState().positionMs).toBe(15_000);
});
