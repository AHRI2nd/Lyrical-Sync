// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, screen } from "@testing-library/react";

const { getVolume, setVolume } = vi.hoisted(() => ({ getVolume: vi.fn(), setVolume: vi.fn() }));
vi.mock("../../utils/spotifyPlayer", () => ({
  getSpotifyVolume: (...args: unknown[]) => getVolume(...args),
  setSpotifyVolume: (...args: unknown[]) => setVolume(...args),
}));

import { ServicePlayerPanel } from "./ServicePlayerPanel";
import { useServiceStore } from "../../stores/useServiceStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useToastStore } from "../../stores/useToastStore";

beforeEach(() => {
  getVolume.mockReset().mockResolvedValue(0.5).mockResolvedValueOnce(0.42).mockResolvedValueOnce(0.67);
  setVolume.mockReset().mockResolvedValue(undefined);
  useI18nStore.getState().setLang("en");
  useServiceStore.setState({
    deviceId: "web-player",
    activePlaybackDeviceId: "web-player",
    activePlaybackVolumePercent: 42,
    trackUri: null,
    isPlaying: false,
    isLooping: false,
  });
});

afterEach(cleanup);

it("syncs its volume slider when the active playback device changes", async () => {
  const { container } = render(<ServicePlayerPanel />);
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

  await waitFor(() => expect(slider.value).toBe("0.42"));
  expect(slider.disabled).toBe(false);

  useServiceStore.setState({ activePlaybackDeviceId: "external-speaker" });
  await waitFor(() => expect(slider.value).toBe("0.67"));
  expect(getVolume).toHaveBeenCalledTimes(2);
});

it("refreshes a remote volume change without changing the active device", async () => {
  useServiceStore.setState({ activePlaybackDeviceId: "external-speaker", activePlaybackVolumePercent: 30 });
  getVolume.mockReset().mockResolvedValue(0.3);
  const { container } = render(<ServicePlayerPanel />);
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
  await waitFor(() => expect(slider.value).toBe("0.3"));

  act(() => useServiceStore.setState({ activePlaybackVolumePercent: 80 }));

  await waitFor(() => expect(slider.value).toBe("0.8"));
});

it("does not overwrite a volume value while the user is adjusting it", async () => {
  const { container } = render(<ServicePlayerPanel />);
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
  await waitFor(() => expect(slider.value).toBe("0.42"));

  fireEvent.change(slider, { target: { value: "0.8" } });
  act(() => useServiceStore.setState({ activePlaybackVolumePercent: 60 }));

  expect(slider.value).toBe("0.8");
});

it("ignores a late initial volume read after the user starts adjusting", async () => {
  let resolveVolume!: (value: number) => void;
  getVolume.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveVolume = resolve; }));
  const { container } = render(<ServicePlayerPanel />);
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

  await waitFor(() => expect(slider.value).toBe("0.42"));
  fireEvent.change(slider, { target: { value: "0.8" } });
  await act(async () => { resolveVolume(0.2); });

  expect(slider.value).toBe("0.8");
});

it("cancels a pending volume write when playback changes devices", async () => {
  const { container } = render(<ServicePlayerPanel />);
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
  await waitFor(() => expect(slider.value).toBe("0.42"));

  vi.useFakeTimers();
  fireEvent.change(slider, { target: { value: "0.8" } });
  act(() => useServiceStore.setState({ activePlaybackDeviceId: "external-speaker" }));
  await act(async () => { await Promise.resolve(); });
  act(() => { vi.runOnlyPendingTimers(); });

  expect(setVolume).not.toHaveBeenCalled();
  expect(slider.value).toBe("0.67");
  vi.useRealTimers();
});

it("reports a failed Spotify repeat change after restoring the prior state", async () => {
  useServiceStore.setState({
    isLoggedIn: true,
    accessToken: "token",
    tokenExpiresAt: Date.now() + 3_600_000,
    isLooping: false,
  });
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  render(<ServicePlayerPanel />);

  fireEvent.click(screen.getByTitle(useI18nStore.getState().t.tooltipLoop));

  await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  expect(useServiceStore.getState().isLooping).toBe(false);
  expect(useToastStore.getState().toasts[0]?.message).toBe(useI18nStore.getState().t.toast.spotifyActionFailed);
});
