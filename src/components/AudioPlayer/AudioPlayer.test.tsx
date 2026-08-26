// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

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
    seekTo: () => {},
    exportPeaks: () => [[]],
    setPlaybackRate: () => {},
    setVolume: () => {},
    zoom: () => {},
    load: () => Promise.resolve(),
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

import { AudioPlayer } from "./AudioPlayer";
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
