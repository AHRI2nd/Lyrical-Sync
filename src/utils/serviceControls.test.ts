import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serviceControls } from "./serviceControls";
import { useServiceStore } from "../stores/useServiceStore";
import { useI18nStore } from "../stores/useI18nStore";
import { useToastStore } from "../stores/useToastStore";

beforeEach(() => {
  useI18nStore.getState().setLang("en");
  useToastStore.setState({ toasts: [] });
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3600000,
    isPlaying: false,
    positionMs: 5000,
    durationMs: 60000,
    _lastKnownPositionMs: 5000,
    _lastStateTimestamp: Date.now(),
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("rolls back a failed optimistic playback toggle and reports the error", async () => {
  serviceControls.togglePlay();
  expect(useServiceStore.getState().isPlaying).toBe(true);

  await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));

  expect(useServiceStore.getState().isPlaying).toBe(false);
  expect(useServiceStore.getState().positionMs).toBe(5000);
  expect(useToastStore.getState().toasts[0]?.message).toBe(useI18nStore.getState().t.toast.spotifyActionFailed);
});

it("rolls back a failed seek instead of leaving the optimistic target in the timeline", async () => {
  serviceControls.seekTo(20);
  expect(useServiceStore.getState().positionMs).toBe(20000);

  await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));

  expect(useServiceStore.getState().positionMs).toBe(5000);
});
