// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const { getVolume, setVolume } = vi.hoisted(() => ({ getVolume: vi.fn(), setVolume: vi.fn() }));
vi.mock("../../utils/spotifyPlayer", () => ({
  getSpotifyVolume: (...args: unknown[]) => getVolume(...args),
  setSpotifyVolume: (...args: unknown[]) => setVolume(...args),
}));

import { ServicePlayerPanel } from "./ServicePlayerPanel";
import { useServiceStore } from "../../stores/useServiceStore";
import { useI18nStore } from "../../stores/useI18nStore";

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
