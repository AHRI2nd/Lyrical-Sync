// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { CharSyncView } from "./CharSyncView";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { defaultDocument } from "../../types/lrc";

let rafCallbacks: FrameRequestCallback[];
let seekSpy: ReturnType<typeof vi.spyOn>;

function resetStores() {
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "line-1", timestamp: 10, text: "hello" }] },
    activeLineId: "line-1",
    audioPath: "/music/song.mp3",
    currentTime: 12,
    duration: 100,
    syncMode: "char",
    syncUnit: "char",
    activeSyllableIndex: 0,
    _history: [],
    _future: [],
  });
  useSettingsStore.setState({ spotifyMode: false });
  useServiceStore.setState({ isLoggedIn: false });
}

function setup() {
  const view = render(<CharSyncView />);
  const lane = view.container.querySelector(".h-10") as HTMLDivElement;
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40,
    toJSON: () => ({}),
  });
  return { ...view, lane, playhead: lane.querySelector(".bg-amber-400") as HTMLDivElement };
}

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  resetStores();
  seekSpy = vi.spyOn(audioControls, "seekTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetStores();
});

describe("CharSyncView seek lane", () => {
  it("previews drag movement without changing playback time, then seeks once to the release position", () => {
    const { lane, playhead } = setup();

    fireEvent.pointerDown(lane, { pointerId: 1, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 75 });
    expect(seekSpy).not.toHaveBeenCalled();
    expect(useLrcStore.getState().currentTime).toBe(12);

    act(() => rafCallbacks.splice(0).forEach((callback) => callback(0)));
    expect(playhead.style.left).toBe("75%");
    expect(seekSpy).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 1, button: 0, clientX: 80 });
    expect(seekSpy).toHaveBeenCalledTimes(1);
    expect(seekSpy).toHaveBeenCalledWith(16.4);
    expect(useLrcStore.getState().currentTime).toBe(12);
  });

  it("does not seek when the drag is cancelled or the component unmounts", () => {
    const { lane, unmount } = setup();

    fireEvent.pointerDown(lane, { pointerId: 2, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 70 });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(seekSpy).not.toHaveBeenCalled();

    fireEvent.pointerDown(lane, { pointerId: 3, button: 0, clientX: 20 });
    unmount();
    fireEvent.pointerUp(window, { pointerId: 3, button: 0, clientX: 70 });
    expect(seekSpy).not.toHaveBeenCalled();
  });

  it("cancels an active drag when the audio path changes", () => {
    const { lane } = setup();

    fireEvent.pointerDown(lane, { pointerId: 4, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 80 });
    act(() => useLrcStore.setState({ audioPath: "/music/other.mp3" }));
    fireEvent.pointerUp(window, { pointerId: 4, button: 0, clientX: 80 });

    expect(seekSpy).not.toHaveBeenCalled();
  });

  it("cancels an active drag if playback switches from local audio to Spotify", () => {
    const serviceSeekSpy = vi.spyOn(serviceControls, "seekTo").mockImplementation(() => {});
    const { lane } = setup();

    fireEvent.pointerDown(lane, { pointerId: 5, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 80 });
    act(() => {
      useSettingsStore.setState({ spotifyMode: true });
      useServiceStore.setState({ isLoggedIn: true });
    });
    fireEvent.pointerUp(window, { pointerId: 5, button: 0, clientX: 80 });

    expect(seekSpy).not.toHaveBeenCalled();
    expect(serviceSeekSpy).not.toHaveBeenCalled();
  });

  it("cancels an active Spotify lane drag when the track changes at the same duration", () => {
    useSettingsStore.setState({ spotifyMode: true });
    useServiceStore.setState({ isLoggedIn: true, trackUri: "spotify:track:first" });
    const serviceSeekSpy = vi.spyOn(serviceControls, "seekTo").mockImplementation(() => {});
    const { lane } = setup();

    fireEvent.pointerDown(lane, { pointerId: 6, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 6, clientX: 80 });
    act(() => useServiceStore.setState({ trackUri: "spotify:track:second" }));
    fireEvent.pointerUp(window, { pointerId: 6, button: 0, clientX: 80 });

    expect(serviceSeekSpy).not.toHaveBeenCalled();
  });

  it("uses the frozen displayed window for a new drag while a previous seek is pending", () => {
    const { container, lane } = setup();
    fireEvent.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "+")!);

    fireEvent.pointerDown(lane, { pointerId: 7, button: 0, clientX: 20 });
    act(() => useLrcStore.setState({ currentTime: 20 }));
    fireEvent.pointerUp(window, { pointerId: 7, button: 0, clientX: 80 });
    expect(seekSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(lane, { pointerId: 8, button: 0, clientX: 50 });
    fireEvent.pointerUp(window, { pointerId: 8, button: 0, clientX: 50 });

    expect(seekSpy).toHaveBeenLastCalledWith(12);
  });
});
