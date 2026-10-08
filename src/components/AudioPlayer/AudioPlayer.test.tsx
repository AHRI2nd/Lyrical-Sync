// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// Supply controlled engine events; test the component's loop policy, not decoding.
const { handlers, seekTo } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  seekTo: vi.fn(),
}));
vi.mock("wavesurfer.js", () => ({
  default: {
    create: () => ({
      getWrapper: () => document.createElement("div"),
      registerPlugin: () => ({ on: () => {} }),
      on: (event: string, callback: (...args: unknown[]) => void) => {
        handlers.set(event, callback);
      },
      getDuration: () => 100,
      seekTo,
      setVolume: () => {},
      destroy: () => {},
    }),
  },
}));
vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => ({
  default: { create: () => ({}) },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { AudioPlayer } from "./AudioPlayer";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { audioControls } from "../../utils/audioControls";
import { defaultDocument } from "../../types/lrc";

const originalControls = { ...audioControls };

describe("AudioPlayer loop-line boundaries", () => {
  beforeEach(() => {
    handlers.clear();
    seekTo.mockClear();
    localStorage.clear();
    useSettingsStore.setState({ showSpectrogram: false });
    useLrcStore.setState({
      doc: {
        ...defaultDocument(),
        lines: [
          { id: "loop", text: "Repeat", timestamp: 10 },
          { id: "untimed", text: "Not stamped", timestamp: null },
          { id: "next", text: "Next", timestamp: 20 },
        ],
      },
      audioPath: null,
      loopLineId: "loop",
      activeLineId: null,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
    });
  });

  afterEach(() => {
    cleanup();
    Object.assign(audioControls, originalControls);
    localStorage.clear();
  });

  const playbackAt = (seconds: number) => {
    const callback = handlers.get("audioprocess");
    if (!callback) throw new Error("AudioPlayer did not register playback events");
    act(() => callback(seconds));
  };

  it("repeats at the next stamped line and skips untimed lines", () => {
    render(<AudioPlayer />);
    playbackAt(19.9);
    expect(seekTo).not.toHaveBeenCalled();
    expect(useLrcStore.getState().currentTime).toBe(19.9);

    playbackAt(20);
    expect(seekTo.mock.calls).toEqual([[0.1]]);
  });

  it("repeats the last stamped line at the track end", () => {
    useLrcStore.setState({
      doc: {
        ...defaultDocument(),
        lines: [{ id: "loop", text: "Last line", timestamp: 10 }],
      },
    });
    render(<AudioPlayer />);
    playbackAt(99.9);
    expect(seekTo).not.toHaveBeenCalled();

    playbackAt(100);
    expect(seekTo.mock.calls).toEqual([[0.1]]);
  });

  it("does not repeat when line looping is disabled", () => {
    useLrcStore.setState({ loopLineId: null });
    render(<AudioPlayer />);
    playbackAt(20);
    expect(seekTo).not.toHaveBeenCalled();
    expect(useLrcStore.getState().currentTime).toBe(20);
  });
});
