// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

// Supply controlled engine events; test the component's loop policy, not decoding.
const { handlers, seekTo, load, engines, spectrogramCreated, spectrogramDestroyed } = vi.hoisted(() => ({
  spectrogramCreated: vi.fn(), spectrogramDestroyed: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  engines: [] as Map<string, (...args: unknown[]) => void>[],
  seekTo: vi.fn(), load: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("wavesurfer.js", () => ({
  default: {
    create: () => { const events = new Map<string, (...args: unknown[]) => void>(); engines.push(events); return ({
      getWrapper: () => document.createElement("div"),
      registerPlugin: (plugin: { destroy?: () => void }) => plugin.destroy ? plugin : ({ on: () => {}, clearRegions: () => {}, addRegion: () => ({}), getRegions: () => [] }),
      on: (event: string, callback: (...args: unknown[]) => void) => {
        handlers.set(event, callback); events.set(event, callback);
      },
      getDuration: () => 100,
      seekTo, load, loadBlob: load,
      pause: vi.fn(), zoom: vi.fn(), setPlaybackRate: vi.fn(),
      exportPeaks: () => [[0.5]],
      setVolume: () => {},
      destroy: () => {},
    }); },
  },
}));
vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => ({
  default: { create: () => ({}) },
}));
vi.mock("wavesurfer.js/dist/plugins/spectrogram.esm.js", () => ({
  default: { create: () => { spectrogramCreated(); return { destroy: spectrogramDestroyed }; } },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

vi.mock("../../utils/readAudioBytes", () => ({ readAudioBytes: vi.fn() }));
import { readAudioBytes } from "../../utils/readAudioBytes";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AudioPlayer } from "./AudioPlayer";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { audioControls } from "../../utils/audioControls";
import { defaultDocument } from "../../types/lrc";

const originalControls = { ...audioControls };

describe("AudioPlayer loop-line boundaries", () => {
  beforeEach(() => {
    handlers.clear(); engines.length = 0; spectrogramCreated.mockClear(); spectrogramDestroyed.mockClear();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    vi.mocked(readAudioBytes).mockReset();
    seekTo.mockClear();
    load.mockClear();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:audio") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
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
      audioPath: null, audioBookmark: null,
      _documentSession: 0, _audioSelection: 0, isDirty: false,
      loopLineId: "loop",
      activeLineId: null,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
    });
  });

  afterEach(() => {
    cleanup();
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
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
  it("keeps loaded audio when the lyric document changes or its selection dialog is cancelled", async () => {
    const file = { path: "/song.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([1]), transcoded: false });
    useLrcStore.setState({ audioPath: file.path, audioBookmark: null, isDirty: false });
    render(<AudioPlayer />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    act(() => handlers.get("ready")?.());
    await act(async () => { await useLrcStore.getState().newLrc(); });
    vi.mocked(open).mockResolvedValue(null);
    await act(async () => { await useLrcStore.getState().openAudio(); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("rejects metadata from the previous document session", async () => {
    let resolveOld!: (value: { title: string; artist: string; album: string }) => void;
    const oldMetadata = new Promise((resolve) => { resolveOld = resolve; });
    let requests = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "read_audio_metadata") return ++requests === 1 ? oldMetadata
        : Promise.resolve({ title: "", artist: "", album: "" });
      return Promise.resolve(null);
    });
    const file = { path: "/song.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([1]), transcoded: false });
    useLrcStore.setState({ audioPath: file.path, audioBookmark: null, isDirty: false });
    render(<AudioPlayer />);
    await waitFor(() => expect(requests).toBe(1));
    await act(async () => { await useLrcStore.getState().newLrc(); });
    await waitFor(() => expect(requests).toBe(2));
    await act(async () => { resolveOld({ title: "Obsolete", artist: "", album: "" }); await oldMetadata; });
    expect(useLrcStore.getState().doc.metadata.title).toBe("");
  });

  it("resets replacement state and ignores events from the old engine", async () => {
    const file = { path: "/old.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([1]), transcoded: false });
    useLrcStore.setState({ audioPath: file.path, audioBookmark: null });
    render(<AudioPlayer />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const old = engines[engines.length - 1];
    act(() => { old.get("ready")?.(); old.get("play")?.(); old.get("audioprocess")?.(35); });
    expect(audioControls.getPeaks()).toEqual([0.5]);
    vi.mocked(readAudioBytes).mockReturnValue(new Promise(() => {}));
    act(() => useLrcStore.setState({ audioPath: "/next.aiff", _audioSelection: useLrcStore.getState()._audioSelection + 1 }));
    expect(useLrcStore.getState()).toMatchObject({ duration: 0, currentTime: 0, isPlaying: false });
    expect(audioControls.getPeaks()).toBeNull();
    act(() => { old.get("ready")?.(); old.get("play")?.(); old.get("seeking")?.(50); });
    expect(useLrcStore.getState()).toMatchObject({ duration: 0, currentTime: 0, isPlaying: false });
  });

  it("ignores a late read after audio replacement and uses loadBlob", async () => {
    let finish!: (value: Awaited<ReturnType<typeof readAudioBytes>>) => void;
    vi.mocked(readAudioBytes).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    useLrcStore.setState({ audioPath: "/old.mp3", audioBookmark: null });
    render(<AudioPlayer />);
    const file = { path: "/new.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([2]), transcoded: false });
    act(() => useLrcStore.setState({ audioPath: file.path, _audioSelection: useLrcStore.getState()._audioSelection + 1 }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => finish({ file: { path: "/old.mp3", bookmark: null }, bytes: new Uint8Array([1]), transcoded: false }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("restarts a pending same-path read for the new document session", async () => {
    let finish!: (value: Awaited<ReturnType<typeof readAudioBytes>>) => void;
    vi.mocked(readAudioBytes).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    useLrcStore.setState({ audioPath: "/song.mp3", audioBookmark: null, isDirty: false });
    render(<AudioPlayer />);
    const file = { path: "/song.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([2]), transcoded: false });
    await act(async () => { await useLrcStore.getState().newLrc(); });
    await waitFor(() => expect(readAudioBytes).toHaveBeenCalledTimes(2));
    await act(async () => finish({ file, bytes: new Uint8Array([1]), transcoded: false }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reattaches spectrogram to a replacement engine only after readiness", async () => {
    const file = { path: "/song.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([1]), transcoded: false });
    useSettingsStore.setState({ showSpectrogram: true });
    useLrcStore.setState({ audioPath: file.path, audioBookmark: null });
    render(<AudioPlayer />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(spectrogramCreated).not.toHaveBeenCalled();
    act(() => handlers.get("ready")?.());
    await waitFor(() => expect(spectrogramCreated).toHaveBeenCalledTimes(1));
    act(() => useLrcStore.setState({ audioPath: "/next.aiff", _audioSelection: useLrcStore.getState()._audioSelection + 1 }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(spectrogramDestroyed).toHaveBeenCalledTimes(1);
    expect(spectrogramCreated).toHaveBeenCalledTimes(1);
    act(() => handlers.get("ready")?.());
    await waitFor(() => expect(spectrogramCreated).toHaveBeenCalledTimes(2));
  });

  it("clears playback and peaks when audio is removed, then ignores events after unmount", async () => {
    const file = { path: "/song.mp3", bookmark: null };
    vi.mocked(readAudioBytes).mockResolvedValue({ file, bytes: new Uint8Array([1]), transcoded: false });
    useLrcStore.setState({ audioPath: file.path });
    const { unmount } = render(<AudioPlayer />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const old = engines[engines.length - 1];
    act(() => { old.get("ready")?.(); old.get("play")?.(); old.get("seeking")?.(25); });
    act(() => useLrcStore.setState({ audioPath: null, _audioSelection: 1 }));
    expect(useLrcStore.getState()).toMatchObject({ duration: 0, currentTime: 0, isPlaying: false });
    expect(audioControls.getPeaks()).toBeNull();
    unmount();
    act(() => { old.get("ready")?.(); old.get("play")?.(); old.get("audioprocess")?.(50); });
    expect(useLrcStore.getState()).toMatchObject({ duration: 0, currentTime: 0, isPlaying: false });
  });

});
