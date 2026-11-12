// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, cleanup, waitFor, screen } from "@testing-library/react";

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

// wavesurfer.js는 실제 오디오/캔버스 렌더링이 필요해 jsdom에서 그대로 쓸 수 없음 —
// audioprocess 핸들러(줄 반복 경계 로직)만 검증할 수 있게, on()으로 등록되는 콜백을
// 캡처하고 getDuration/seekTo를 스파이할 수 있는 최소 mock으로 대체.
const { wsHandlers, wsMock } = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const mock = {
    getWrapper: () => ({ classList: { add: () => {} } }),
    registerPlugin: () => ({ on: () => {}, destroy: () => {}, clearRegions: () => {}, getRegions: () => [] }),
    on: (event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; },
    getDuration: () => 100,
    getCurrentTime: () => 0,
    getDecodedData: () => ({ length: 4, sampleRate: 4, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([0, 1, -.5, 0]) }),
    seekTo: () => {},
    exportPeaks: () => [[]],
    setPlaybackRate: () => {},
    setVolume: () => {},
    zoom: () => {},
    load: vi.fn((_url: string, _peaks?: Array<Float32Array | number[]>, _duration?: number) => Promise.resolve()),
    loadBlob: vi.fn((_blob: Blob) => Promise.resolve()),
    play: () => {},
    pause: () => {},
    playPause: () => {},
    destroy: () => {},
  };
  return { wsHandlers: handlers, wsMock: mock };
});

vi.mock("wavesurfer.js", () => ({
  default: { create: () => wsMock },
}));
const spectrumCreate = vi.hoisted(() => vi.fn(() => ({ type: "spectrum" })));
vi.mock("wavesurfer.js/dist/plugins/spectrogram.esm.js", () => ({ default: { create: spectrumCreate } }));
vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => ({
  default: { create: () => ({ on: () => {}, clearRegions: () => {} }) },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useWaveformStore } from "../../stores/useWaveformStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useToastStore } from "../../stores/useToastStore";
import { AudioPlayer } from "./AudioPlayer";
import { invoke } from "@tauri-apps/api/core";
import { audioControls } from "../../utils/audioControls";
import { useLrcStore } from "../../stores/useLrcStore";
import { defaultDocument } from "../../types/lrc";
import type { LrcLine } from "../../types/lrc";

const resetLrc = (lines: LrcLine[], loopLineId: string | null) => {
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines },
    audioPath: null,
    loopLineId,
    _history: [],
    _future: [],
  });
};

const playSpy = vi.spyOn(wsMock, "play");
const seekToSpy = vi.spyOn(wsMock, "seekTo");
const loadSpy = vi.spyOn(wsMock, "load");
const loadBlobSpy = vi.spyOn(wsMock, "loadBlob");
const playPauseSpy = vi.spyOn(wsMock, "playPause");

function waveformSummaryBuffer(): ArrayBuffer {
  const bins = 4;
  const bytes = new Uint8Array(40 + bins * 8);
  const view = new DataView(bytes.buffer);
  bytes.set([76, 83, 87, 70]);
  view.setUint16(4, 1, false);
  view.setUint16(6, 40, false);
  view.setUint32(8, 48_000, false);
  bytes[12] = 1;
  view.setBigUint64(16, BigInt(bins * 256), false);
  view.setBigUint64(24, BigInt(Math.floor(bins * 256 * 1e9 / 48_000)), false);
  view.setUint32(32, 256, false);
  view.setUint32(36, bins, false);
  const minima = [0, -0.25, -0.5, 0];
  const maxima = [0, 0.5, 0.25, 0];
  for (let index = 0; index < bins; index++) {
    view.setFloat32(40 + index * 8, minima[index], false);
    view.setFloat32(44 + index * 8, maxima[index], false);
  }
  return bytes.buffer;
}

function mockSuccessfulAudioStream() {
  let streamNumber = 0;
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "prepare_audio_stream") {
      streamNumber += 1;
      return Promise.resolve({
        streamUrl: `lyrical-audio://localhost/${String(streamNumber).padStart(64, "0")}`,
        contentType: "audio/mpeg",
        fileBytes: 12,
        durationSeconds: 0,
        sampleRate: 48_000,
        channels: 1,
      }) as ReturnType<typeof invoke>;
    }
    if (command === "summarize_audio_stream") return Promise.resolve(waveformSummaryBuffer()) as ReturnType<typeof invoke>;
    if (command === "read_audio_metadata") return Promise.resolve({ title: "", artist: "", album: "" }) as ReturnType<typeof invoke>;
    return Promise.resolve(undefined) as ReturnType<typeof invoke>;
  });
}

describe("AudioPlayer — local audio loading", () => {
  it("gives local volume and waveform zoom sliders localized accessible names", () => {
    const t = useI18nStore.getState().t;
    render(<AudioPlayer />);

    expect(screen.getByRole("slider", { name: t.volume })).toBeTruthy();
    expect(screen.getByRole("slider", { name: t.zoom })).toBeTruthy();
  });

  it("keeps global playback shortcuts inert until local audio is ready", async () => {
    resetLrc([], null);
    render(<AudioPlayer />);
    audioControls.togglePlay();
    expect(playPauseSpy).not.toHaveBeenCalled();

    act(() => useLrcStore.setState({ audioPath: "/music/loading.mp3" }));
    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
    audioControls.togglePlay();
    expect(playPauseSpy).not.toHaveBeenCalled();

    act(() => wsHandlers.ready());
    audioControls.togglePlay();
    expect(playPauseSpy).toHaveBeenCalledOnce();
  });

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    mockSuccessfulAudioStream();
    useToastStore.setState({ toasts: [] });
    loadSpy.mockClear();
    loadBlobSpy.mockClear();
    playPauseSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the waveform canvas visible without audio and hides the empty spectrogram", () => {
    resetLrc([], null);
    const showSpectrogram = useSettingsStore.getState().showSpectrogram;
    useSettingsStore.setState({ showSpectrogram: true });
    const view = render(<AudioPlayer />);
    try {
      expect(view.queryByText(/Open an audio file to display the waveform|오디오 파일을 열어 파형을 표시합니다|音声ファイルを開いて波形を表示します/)).toBeNull();
      const waveformAreas = view.container.querySelectorAll<HTMLDivElement>(".ls-panel > div:nth-child(-n+2)");
      expect([...waveformAreas].map((area) => area.style.display)).toEqual(["", "none"]);
    } finally {
      view.unmount();
      useSettingsStore.setState({ showSpectrogram });
    }
  });

  it("streams MP3 through WaveSurfer with bounded native peaks", async () => {
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/song.mp3" });

    render(<AudioPlayer />);

    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
    expect(loadSpy.mock.calls[0][0]).toMatch(/^lyrical-audio:\/\/localhost\//);
    expect(loadSpy.mock.calls[0][1]?.[0]).toEqual(new Float32Array([0, 0.5, -0.5, 0]));
    expect(loadSpy.mock.calls[0][2]).toBeCloseTo(1024 / 48_000);
    expect(loadBlobSpy).not.toHaveBeenCalled();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("read_audio_file", expect.anything());
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("summarize_audio_stream", expect.objectContaining({
      streamUrl: expect.stringMatching(/^lyrical-audio:\/\/localhost\//),
    }));
  });

  it("clears local playback state when restoring a lyrics-only snapshot", async () => {
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/old.mp3" });
    render(<AudioPlayer />);
    await waitFor(() => expect(loadSpy).toHaveBeenCalled());

    act(() => {
      useLrcStore.getState().setDuration(100);
      wsHandlers.audioprocess(42);
      wsHandlers.play();
    });
    expect(useLrcStore.getState()).toMatchObject({ currentTime: 42, duration: 100, isPlaying: true });

    act(() => useLrcStore.getState().restoreDoc(defaultDocument(), null, null));

    expect(useLrcStore.getState()).toMatchObject({ currentTime: 0, duration: 0, isPlaying: false });
  });

  it("loads the selected local file when Spotify mode is persisted but the user is logged out", async () => {
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/song.mp3" });
    useSettingsStore.setState({ spotifyMode: true, deviceMode: false });
    useServiceStore.setState({ isLoggedIn: false });

    render(<AudioPlayer />);

    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("prepare_audio_stream", expect.objectContaining({ path: "/music/song.mp3" })));
    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
  });

  it("shows a localized error when Spotify login cannot be initiated from the player", async () => {
    resetLrc([], null);
    useSettingsStore.setState({ spotifyMode: true, deviceMode: false, spotifyClientId: "client-id" });
    useServiceStore.setState({ isLoggedIn: false, startLogin: vi.fn().mockRejectedValue(new Error("callback listener failed")) });
    render(<AudioPlayer />);

    fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyConnect }));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: "error", message: useI18nStore.getState().t.toast.spotifyActionFailed });
  });

  it("prepares AIFF from the selected file path without moving bytes through JavaScript", async () => {
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "C:/music/song.aiff" });

    render(<AudioPlayer />);

    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("prepare_audio_stream", expect.objectContaining({ path: "C:/music/song.aiff" }));
    expect(loadBlobSpy).not.toHaveBeenCalled();
  });

  it("shows the localized guidance when audio exceeds the processing budget", async () => {
    vi.mocked(invoke).mockImplementation((command: string) => command === "prepare_audio_stream"
      ? Promise.reject(new Error("AUDIO_RESOURCE_LIMIT")) as ReturnType<typeof invoke>
      : Promise.resolve(undefined) as ReturnType<typeof invoke>);
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/long-song.mp3" });
    render(<AudioPlayer />);

    await waitFor(() => expect(useToastStore.getState().toasts[useToastStore.getState().toasts.length - 1]?.message)
      .toBe(useI18nStore.getState().t.toast.audioResourceLimit));
  });

  it("does not import audio tags when loading the selected audio fails", async () => {
    vi.mocked(invoke).mockImplementation((command: string) => command === "prepare_audio_stream"
      ? Promise.reject(new Error("AUDIO_RESOURCE_LIMIT")) as ReturnType<typeof invoke>
      : Promise.resolve(undefined) as ReturnType<typeof invoke>);
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/unplayable.mp3" });
    render(<AudioPlayer />);

    await waitFor(() => expect(useToastStore.getState().toasts[useToastStore.getState().toasts.length - 1]?.message)
      .toBe(useI18nStore.getState().t.toast.audioResourceLimit));

    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("read_audio_metadata", { path: "/music/unplayable.mp3" });
    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "", artist: "" });
  });

  it("imports empty metadata fields after audio loads successfully", async () => {
    vi.mocked(invoke).mockImplementation((command: string) => command === "read_audio_metadata"
      ? Promise.resolve({ title: "Tagged title", artist: "Tagged artist", album: "" }) as ReturnType<typeof invoke>
      : command === "summarize_audio_stream"
        ? Promise.resolve(waveformSummaryBuffer()) as ReturnType<typeof invoke>
        : command === "prepare_audio_stream"
          ? Promise.resolve({ streamUrl: `lyrical-audio://localhost/${"1".repeat(64)}`, contentType: "audio/mpeg", fileBytes: 1, durationSeconds: 1, sampleRate: 48_000, channels: 1 }) as ReturnType<typeof invoke>
          : Promise.resolve(undefined) as ReturnType<typeof invoke>);
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/valid.mp3" });
    render(<AudioPlayer />);

    await waitFor(() => expect(useLrcStore.getState().doc.metadata).toMatchObject({
      title: "Tagged title", artist: "Tagged artist",
    }));
  });

  it("publishes decoded detail after loading and clears it when audio is unloaded", async () => {
    resetLrc([], null); useLrcStore.setState({ audioPath: "/music/song.wav" });
    render(<AudioPlayer />);
    await waitFor(() => expect(useWaveformStore.getState().source).not.toBeNull());
    expect([...useWaveformStore.getState().source!.getEnvelope(0, 1, 4)!.min]).toEqual([0, -.25, -.5, 0]);
    act(() => useLrcStore.setState({ audioPath: null }));
    expect(useWaveformStore.getState().source).toBeNull();
  });

});

describe("AudioPlayer — loop-line boundary (audioprocess handler)", () => {
  beforeEach(() => {
    seekToSpy.mockClear();
    playSpy.mockClear();
    for (const k of Object.keys(wsHandlers)) delete wsHandlers[k];
  });

  afterEach(() => cleanup());

  it("seeks back to the loop line's start once playback reaches the next stamped line", () => {
    resetLrc(
      [
        { id: "a", timestamp: 10, text: "loop me" },
        { id: "b", timestamp: 20, text: "next line" },
      ],
      "a"
    );
    render(<AudioPlayer />);
    const audioprocess = wsHandlers["audioprocess"];
    expect(audioprocess).toBeDefined();

    // 아직 구간(10~20) 안 — 되돌리지 않음
    audioprocess(15);
    expect(seekToSpy).not.toHaveBeenCalled();

    // 다음 스탬프 줄(20) 도달 — 반복 대상 줄 시작(10)으로 되돌림. duration=100 기준 10/100=0.1
    audioprocess(20);
    expect(seekToSpy).toHaveBeenCalledWith(0.1);
  });

  it("loops to the end of the track when the loop line is the last stamped line", () => {
    resetLrc([{ id: "a", timestamp: 10, text: "only line" }], "a");
    render(<AudioPlayer />);
    const audioprocess = wsHandlers["audioprocess"];

    // 다음 스탬프 줄이 없으므로 트랙 끝(getDuration()=100)이 구간 끝
    audioprocess(50);
    expect(seekToSpy).not.toHaveBeenCalled();

    audioprocess(100);
    expect(seekToSpy).toHaveBeenCalledWith(0.1);
  });

  it("restarts the final line at track finish", () => {
    resetLrc([{ id: "a", timestamp: 90, text: "last" }], "a");
    render(<AudioPlayer />);
    wsHandlers["finish"]();
    expect(seekToSpy).toHaveBeenCalledWith(.9);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("gives line repeat priority over whole-track repeat at track finish", () => {
    resetLrc([{ id: "a", timestamp: 90, text: "last" }], "a");
    const { getByRole } = render(<AudioPlayer />);
    const t = useI18nStore.getState().t;
    fireEvent.click(getByRole("button", { name: t.playerMore }));
    fireEvent.click(getByRole("button", { name: t.tooltipLoop }));
    wsHandlers["finish"]();
    expect(seekToSpy).toHaveBeenCalledWith(.9);
    expect(seekToSpy).not.toHaveBeenCalledWith(0);
  });

  it("does not loop stale local audio while an external source is active", () => {
    resetLrc([{ id: "a", timestamp: 10, text: "first" }, { id: "b", timestamp: 20, text: "next" }], "a");
    render(<AudioPlayer />);
    act(() => useSettingsStore.setState({ deviceMode: true }));
    wsHandlers["audioprocess"](20); wsHandlers["finish"]();
    expect(seekToSpy).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
    act(() => useSettingsStore.setState({ deviceMode: false }));
  });

  it("does not seek repeatedly for adjacent equal timestamps", () => {
    resetLrc([{ id: "a", timestamp: 10, text: "first" }, { id: "b", timestamp: 10, text: "same" },
      { id: "c", timestamp: 20, text: "next" }], "a");
    render(<AudioPlayer />);
    wsHandlers["audioprocess"](11);
    expect(seekToSpy).not.toHaveBeenCalled();
    wsHandlers["audioprocess"](20);
    expect(seekToSpy).toHaveBeenCalledWith(.1);
  });

  it("does nothing when no line is set to loop", () => {
    resetLrc([{ id: "a", timestamp: 10, text: "loop me" }, { id: "b", timestamp: 20, text: "next" }], null);
    render(<AudioPlayer />);
    const audioprocess = wsHandlers["audioprocess"];

    audioprocess(20);
    expect(seekToSpy).not.toHaveBeenCalled();
  });
});

describe('AudioPlayer — source ownership', () => {
  afterEach(cleanup);
  it('reloads a reselected path and ignores events from the replaced engine', async () => {
    vi.mocked(invoke).mockReset(); mockSuccessfulAudioStream();
    loadSpy.mockClear();
    useSettingsStore.setState({spotifyMode:false,deviceMode:false});
    resetLrc([],null); useLrcStore.getState().setAudioPath('/same.mp3');
    render(<AudioPlayer />); await waitFor(()=>expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "prepare_audio_stream")).toHaveLength(1));
    await waitFor(()=>expect(loadSpy).toHaveBeenCalledTimes(1));
    const preparedUrl = loadSpy.mock.calls[0][0];
    const oldReady=wsHandlers.ready, oldProcess=wsHandlers.audioprocess;
    act(()=>useLrcStore.getState().setAudioPath('/same.mp3'));
    await waitFor(()=>expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "prepare_audio_stream")).toHaveLength(2));
    const calls = vi.mocked(invoke).mock.calls;
    const revokeIndex = calls.findIndex(([command, args]) => command === "revoke_audio_stream"
      && (args as { streamUrl?: string } | undefined)?.streamUrl === preparedUrl);
    const secondPrepareIndex = calls.findIndex(([command], index) => command === "prepare_audio_stream"
      && calls.slice(0, index).filter(([previous]) => previous === "prepare_audio_stream").length === 1);
    expect(revokeIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeLessThan(secondPrepareIndex);
    act(()=>{ useLrcStore.setState({duration:42,currentTime:5}); oldReady(); oldProcess(90); });
    expect(useLrcStore.getState().duration).toBe(42); expect(useLrcStore.getState().currentTime).toBe(5);
  });
});

it('reattaches an enabled spectrogram after replacing the audio engine', async () => {
  spectrumCreate.mockClear(); vi.mocked(invoke).mockReset(); mockSuccessfulAudioStream();
  useSettingsStore.setState({spotifyMode:false,deviceMode:false,showSpectrogram:true});
  resetLrc([],null); useLrcStore.getState().setAudioPath('/spectrogram.mp3');
  const view=render(<AudioPlayer />);
  try {
    await waitFor(()=>expect(spectrumCreate).toHaveBeenCalledTimes(1));
    act(()=>useLrcStore.getState().setAudioPath('/spectrogram.mp3'));
    await waitFor(()=>expect(spectrumCreate).toHaveBeenCalledTimes(2));
  } finally { view.unmount(); useSettingsStore.setState({showSpectrogram:false}); }
});

it('retains decoded waveform data when only the lyric document changes', async () => {
  vi.mocked(invoke).mockReset(); mockSuccessfulAudioStream();
  useSettingsStore.setState({spotifyMode:false,deviceMode:false}); resetLrc([],null);
  useLrcStore.getState().setAudioPath('/kept.mp3'); const view=render(<AudioPlayer />);
  try {
    await waitFor(()=>expect(useWaveformStore.getState().source).not.toBeNull());
    const source=useWaveformStore.getState().source;
    act(()=>useLrcStore.setState(s=>({_documentSession:s._documentSession+1})));
    expect(useWaveformStore.getState().source).toBe(source);
  } finally { view.unmount(); }
});
it('keeps the selected volume when the audio engine is replaced', async () => {
  const volumeSpy=vi.spyOn(wsMock,'setVolume');
  vi.mocked(invoke).mockReset(); mockSuccessfulAudioStream();
  useSettingsStore.setState({spotifyMode:false,deviceMode:false}); resetLrc([],null);
  useLrcStore.getState().setAudioPath('/volume.mp3'); const view=render(<AudioPlayer />);
  try {
    fireEvent.change(view.container.querySelector('input[max="1"]')!,{target:{value:'0.25'}});
    expect(volumeSpy).toHaveBeenLastCalledWith(.25); volumeSpy.mockClear();
    act(()=>useLrcStore.getState().setAudioPath('/volume.mp3'));
    expect(volumeSpy).toHaveBeenCalledWith(.25);
  } finally { view.unmount(); volumeSpy.mockRestore(); }
});

it("exposes waveform and seek bar selection states", async () => {
  const { useI18nStore } = await import("../../stores/useI18nStore");
  useSettingsStore.setState({ spotifyMode: false, deviceMode: false, youtubeMode: false });
  resetLrc([], null);
  const { getByRole } = render(<AudioPlayer />), t = useI18nStore.getState().t;
  expect(getByRole("button", { name: t.tooltipViewWaveform }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(getByRole("button", { name: t.tooltipViewSeekBar }));
  expect(getByRole("button", { name: t.tooltipViewSeekBar }).getAttribute("aria-pressed")).toBe("true");
  expect(getByRole("button", { name: t.tooltipViewWaveform }).getAttribute("aria-pressed")).toBe("false");
});
