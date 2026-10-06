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
import { formatTimestamp, parseTimestampInput } from "../../utils/lrcParser";

let rafCallbacks: FrameRequestCallback[];
let seekSpy: ReturnType<typeof vi.spyOn>;

function resetStores() {
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "line-1", timestamp: 10, text: "hello" }] },
    activeLineId: "line-1",
    audioPath: "/music/song.mp3",
    currentTime: 12,
    isPlaying: false,
    loopLineId: null,
    duration: 100,
    syncMode: "char",
    syncUnit: "char",
    activeSyllableIndex: 0,
    _history: [],
    _future: [],
  });
  useSettingsStore.setState({ spotifyMode: false, deviceMode: false, glyphWaveformStyle: "bars", glyphWaveformHeight: 96 });
  useServiceStore.setState({ isLoggedIn: false });
}

function setup() {
  const view = render(<CharSyncView />);
  const lane = view.container.querySelector('[data-testid="glyph-seek-lane"]') as HTMLDivElement;
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
  it("shows at least two seconds of context when adjacent lyric timestamps are very close", () => {
    useLrcStore.setState({
      doc: {
        ...defaultDocument(),
        lines: [
          { id: "line-1", timestamp: 10, text: "fast lyric" },
          { id: "line-2", timestamp: 10.13, text: "next lyric" },
        ],
      },
      activeLineId: "line-1",
      currentTime: 10.06,
    });

    const { lane } = setup();
    const labels = [{ textContent: formatTimestamp(Number(lane.dataset.start)) }, { textContent: formatTimestamp(Number(lane.dataset.end)) }];
    const start = parseTimestampInput(labels[0].textContent ?? "");
    const end = parseTimestampInput(labels[1].textContent ?? "");

    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect((end as number) - (start as number)).toBeGreaterThanOrEqual(1.99);
  });

  it("keeps the minimum window inside the track near its start and end", () => {
    const cases = [
      { start: 0.1, end: 0.2, expectedStart: 0, expectedEnd: 2 },
      { start: 99.8, end: 99.9, expectedStart: 98, expectedEnd: 100 },
    ];

    for (const [index, item] of cases.entries()) {
      cleanup();
      useLrcStore.setState({
        doc: {
          ...defaultDocument(),
          lines: [
            { id: "line-1", timestamp: item.start, text: "fast lyric" },
            { id: "line-2", timestamp: item.end, text: "next lyric" },
          ],
        },
        activeLineId: "line-1",
        currentTime: (item.start + item.end) / 2,
      });
      const { lane } = setup();
      const labels = [{ textContent: formatTimestamp(Number(lane.dataset.start)) }, { textContent: formatTimestamp(Number(lane.dataset.end)) }];

      expect(parseTimestampInput(labels[0].textContent ?? ""), `case ${index} start`).toBeCloseTo(item.expectedStart, 1);
      expect(parseTimestampInput(labels[1].textContent ?? ""), `case ${index} end`).toBeCloseTo(item.expectedEnd, 1);
    }
  });

  it("preserves a quarter-second view at 8x zoom for a short lyric interval", () => {
    useLrcStore.setState({
      doc: {
        ...defaultDocument(),
        lines: [
          { id: "line-1", timestamp: 10, text: "fast lyric" },
          { id: "line-2", timestamp: 10.13, text: "next lyric" },
        ],
      },
      activeLineId: "line-1",
      currentTime: 10.06,
    });
    const { lane, container } = setup();

    const zoomIn = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "+")!;
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);

    const labels = [{ textContent: formatTimestamp(Number(lane.dataset.start)) }, { textContent: formatTimestamp(Number(lane.dataset.end)) }];
    const start = parseTimestampInput(labels[0].textContent ?? "");
    const end = parseTimestampInput(labels[1].textContent ?? "");
    expect((end as number) - (start as number)).toBeGreaterThanOrEqual(0.24);
  });

  it("continuously centers playback in a zoomed viewport across lyric boundaries", () => {
    useLrcStore.setState({ isPlaying: true });
    const { lane, container, playhead } = setup();
    fireEvent.click(Array.from(container.querySelectorAll("button")).find(b => b.textContent === "+")!);
    expect(Number(lane.dataset.start)).toBe(10);
    act(() => useLrcStore.setState({ currentTime: 12.5 }));
    expect(Number(lane.dataset.start)).toBe(10.5);
    expect(playhead.style.left).toBe("50%");
    act(() => useLrcStore.setState({ currentTime: 13.5 }));
    expect(Number(lane.dataset.start)).toBeCloseTo(11.5);
    act(() => useLrcStore.setState({ currentTime: 25 }));
    expect(Number(lane.dataset.start)).toBe(23);
    expect(playhead.style.left).toBe("50%");
  });

  it("moves the playhead from left to center, scrolls the waveform, then moves it to the right", () => {
    useLrcStore.setState({ isPlaying: true, currentTime: 0 });
    const { lane, playhead } = setup();
    const cases = [
      { time: 0, start: 0, end: 8, position: 0 },
      { time: 2, start: 0, end: 8, position: 25 },
      { time: 4, start: 0, end: 8, position: 50 },
      { time: 12, start: 8, end: 16, position: 50 },
      { time: 50, start: 46, end: 54, position: 50 },
      { time: 96, start: 92, end: 100, position: 50 },
      { time: 98, start: 92, end: 100, position: 75 },
      { time: 100, start: 92, end: 100, position: 100 },
      { time: 10, start: 6, end: 14, position: 50 },
    ];
    for (const item of cases) {
      act(() => useLrcStore.setState({ currentTime: item.time }));
      expect(Number(lane.dataset.start), `time ${item.time}`).toBe(item.start);
      expect(Number(lane.dataset.end), `time ${item.time}`).toBe(item.end);
      expect(parseFloat(playhead.style.left), `time ${item.time}`).toBe(item.position);
      if (item.position === 100) {
        expect(playhead.style.transform, `visible endpoint at ${item.time}`).toBe(`translateX(-${item.position}%)`);
      }
    }
  });

  it("keeps a track shorter than the minimum window fully visible", () => {
    useLrcStore.setState({
      duration: 0.5, currentTime: 0, isPlaying: true,
      doc: { ...defaultDocument(), lines: [{ id: "line-1", timestamp: 0, text: "short" }] },
    });
    const { lane, playhead } = setup();
    for (const [time, position] of [[0, 0], [0.25, 50], [0.5, 100]]) {
      act(() => useLrcStore.setState({ currentTime: time }));
      expect(Number(lane.dataset.start)).toBe(0);
      expect(Number(lane.dataset.end)).toBe(0.5);
      expect(parseFloat(playhead.style.left)).toBe(position);
    }
  });

  it("keeps tracking without an end boundary before duration is known", () => {
    useLrcStore.setState({ duration: 0, currentTime: 50, isPlaying: true });
    const { lane, playhead } = setup();
    expect(Number(lane.dataset.start)).toBe(46);
    expect(Number(lane.dataset.end)).toBe(54);
    expect(playhead.style.left).toBe("50%");
  });

  it("resumes centered following after a drag seek is acknowledged", () => {
    useLrcStore.setState({ isPlaying: true });
    const { lane, playhead } = setup();
    fireEvent.pointerDown(lane, { pointerId: 9, button: 0, clientX: 20 });
    act(() => useLrcStore.setState({ currentTime: 13 }));
    expect(Number(lane.dataset.start)).toBe(8);
    fireEvent.pointerUp(window, { pointerId: 9, button: 0, clientX: 75 });
    expect(seekSpy).toHaveBeenCalledWith(14);
    act(() => useLrcStore.setState({ currentTime: 14 }));
    expect(Number(lane.dataset.start)).toBe(10);
    expect(playhead.style.left).toBe("50%");
    act(() => useLrcStore.setState({ currentTime: 14.5 }));
    expect(Number(lane.dataset.start)).toBe(10.5);
  });

  it("pans a zoomed viewport without seeking or changing glyph timing", () => {
    const { lane, container, getByRole } = setup();
    fireEvent.click(Array.from(container.querySelectorAll("button")).find(b => b.textContent === "+")!);
    fireEvent.click(getByRole("button", { name: /다음 시간 구간|Next time window/ }));
    expect(Number(lane.dataset.start)).toBe(12);
    expect(seekSpy).not.toHaveBeenCalled();
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it("keeps manual pan detached during playback until explicitly following again", () => {
    useLrcStore.setState({ isPlaying: true, doc: { ...defaultDocument(), lines: [
      { id: "line-1", text: "first", timestamp: 10 }, { id: "line-2", text: "next", timestamp: 30 },
    ] } });
    const { lane, container, getByRole } = setup();
    const zoomIn = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "+")!;
    fireEvent.click(zoomIn); fireEvent.click(zoomIn); fireEvent.click(zoomIn);
    const next = getByRole("button", { name: /다음 시간 구간|Next time window/ });
    fireEvent.click(next); fireEvent.click(next);
    const start = Number(lane.dataset.start);
    act(() => useLrcStore.setState({ currentTime: 12.01 }));
    expect(Number(lane.dataset.start)).toBe(start);
    fireEvent.click(getByRole("button", { name: /재생 위치 따라가기|Follow playback/ }));
    expect(Number(lane.dataset.start)).toBeCloseTo(10.76);
  });

  it("toggles the current line repeat without starting playback and clears it on line change", () => {
    useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
      { id: "line-1", text: "first", timestamp: 10 }, { id: "line-2", text: "next", timestamp: 20 },
    ] }});
    const { getByRole } = setup();
    const repeat = getByRole("button", { name: /줄 반복|Repeat line/ });
    fireEvent.click(repeat);
    expect(repeat.getAttribute("aria-pressed")).toBe("true");
    expect(useLrcStore.getState().loopLineId).toBe("line-1");
    expect(seekSpy).toHaveBeenCalledWith(10);
    expect(useLrcStore.getState().isPlaying).toBe(false);
    fireEvent.click(repeat);
    expect(useLrcStore.getState().loopLineId).toBeNull();
    fireEvent.click(repeat);
    act(() => useLrcStore.setState({ activeLineId: "line-2" }));
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });

  it("disables line repeat when the line has no timestamp or the source is external", () => {
    useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "line-1", text: "first", timestamp: null }] } });
    const { getByRole } = setup();
    expect((getByRole("button", { name: /줄 반복|Repeat line/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "line-1", text: "first", timestamp: 10 }] } });
      useSettingsStore.setState({ deviceMode: true });
    });
    expect((getByRole("button", { name: /줄 반복|Repeat line/ }) as HTMLButtonElement).disabled).toBe(true);
  });

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
    expect(seekSpy).toHaveBeenCalledWith(14.4);
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
