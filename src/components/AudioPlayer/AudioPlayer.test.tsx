// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";

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
    registerPlugin: () => ({ on: () => {} }),
    on: (event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; },
    getDuration: () => 100,
    getCurrentTime: () => 0,
    getDecodedData: () => ({ length: 4, sampleRate: 4, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([0, 1, -.5, 0]) }),
    seekTo: () => {},
    exportPeaks: () => [[]],
    setPlaybackRate: () => {},
    setVolume: () => {},
    zoom: () => {},
    load: vi.fn((_url: string) => Promise.resolve()),
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
vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => ({
  default: { create: () => ({ on: () => {} }) },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../utils/readAudioBytes", () => ({ readAudioBytes: vi.fn() }));

import { useWaveformStore } from "../../stores/useWaveformStore";
import { AudioPlayer } from "./AudioPlayer";
import { readAudioBytes } from "../../utils/readAudioBytes";
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

const seekToSpy = vi.spyOn(wsMock, "seekTo");
const loadSpy = vi.spyOn(wsMock, "load");
const loadBlobSpy = vi.spyOn(wsMock, "loadBlob");

describe("AudioPlayer — local audio loading", () => {
  beforeEach(() => {
    vi.mocked(readAudioBytes).mockReset();
    loadSpy.mockClear();
    loadBlobSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("passes MP3 bytes to WaveSurfer as a typed Blob, without fetching a Blob URL", async () => {
    vi.mocked(readAudioBytes).mockResolvedValue({
      bytes: Uint8Array.from([0x49, 0x44, 0x33]),
      transcoded: false,
    });
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "/music/song.mp3" });

    render(<AudioPlayer />);

    await waitFor(() => expect(loadBlobSpy).toHaveBeenCalledTimes(1));
    const [blob] = loadBlobSpy.mock.calls[0];
    expect(blob.type).toBe("audio/mpeg");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x49, 0x44, 0x33]);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("preserves WAV MIME for audio already transcoded from Windows AIFF", async () => {
    vi.mocked(readAudioBytes).mockResolvedValue({
      bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
      transcoded: true,
    });
    resetLrc([], null);
    useLrcStore.setState({ audioPath: "C:/music/song.aiff" });

    render(<AudioPlayer />);

    await waitFor(() => expect(loadBlobSpy).toHaveBeenCalledTimes(1));
    expect(loadBlobSpy.mock.calls[0][0].type).toBe("audio/wav");
  });

  it("publishes decoded detail after loading and clears it when audio is unloaded", async () => {
    vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
    resetLrc([], null); useLrcStore.setState({ audioPath: "/music/song.wav" });
    render(<AudioPlayer />);
    await waitFor(() => expect(useWaveformStore.getState().source).not.toBeNull());
    expect([...useWaveformStore.getState().source!.getEnvelope(0, 1, 4)!.min]).toEqual([0, 0, -.5, 0]);
    act(() => useLrcStore.setState({ audioPath: null }));
    expect(useWaveformStore.getState().source).toBeNull();
  });

});

describe("AudioPlayer — loop-line boundary (audioprocess handler)", () => {
  beforeEach(() => {
    seekToSpy.mockClear();
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

  it("does nothing when no line is set to loop", () => {
    resetLrc([{ id: "a", timestamp: 10, text: "loop me" }, { id: "b", timestamp: 20, text: "next" }], null);
    render(<AudioPlayer />);
    const audioprocess = wsHandlers["audioprocess"];

    audioprocess(20);
    expect(seekToSpy).not.toHaveBeenCalled();
  });
});
