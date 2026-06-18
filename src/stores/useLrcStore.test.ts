import { describe, it, expect, beforeEach, vi } from "vitest";

// zustand persist(useSettingsStore)용 최소 localStorage 폴리필 (node 환경)
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

// 파일/이벤트/다이얼로그 Tauri 모듈은 순수 액션 테스트에 불필요 → 스텁
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { useLrcStore } from "./useLrcStore";
import type { LrcLine } from "../types/lrc";

const reset = (lines: LrcLine[], offset = 0) =>
  useLrcStore.setState({
    doc: { metadata: { title: "", artist: "", album: "", by: "", offset }, lines, extraTags: {} },
    _history: [],
    _future: [],
    currentTime: 0,
    activeLineId: null,
    isDirty: false,
  });

const lines = () => useLrcStore.getState().doc.lines;

describe("useLrcStore — line actions", () => {
  beforeEach(() => reset([]));

  it("addLine appends a line", () => {
    useLrcStore.getState().addLine("hello");
    expect(lines().map((l) => l.text)).toEqual(["hello"]);
  });

  it("updateLine patches a field", () => {
    reset([{ id: "1", timestamp: null, text: "a" }]);
    useLrcStore.getState().updateLine("1", { text: "b" });
    expect(lines()[0].text).toBe("b");
  });

  it("deleteLine removes and updates activeLineId", () => {
    reset([{ id: "1", timestamp: null, text: "a" }, { id: "2", timestamp: null, text: "b" }]);
    useLrcStore.setState({ activeLineId: "1" });
    useLrcStore.getState().deleteLine("1");
    expect(lines().map((l) => l.id)).toEqual(["2"]);
    expect(useLrcStore.getState().activeLineId).toBe("2");
  });

  it("stampAndAdvance stamps active line at currentTime and advances", () => {
    reset([{ id: "1", timestamp: null, text: "a" }, { id: "2", timestamp: null, text: "b" }]);
    useLrcStore.setState({ activeLineId: "1", currentTime: 5 });
    useLrcStore.getState().stampAndAdvance();
    expect(lines()[0].timestamp).toBe(5);
    expect(useLrcStore.getState().activeLineId).toBe("2");
  });
});

describe("useLrcStore — offset / shift carry syllable times", () => {
  it("applyOffset shifts line + syllable times and resets offset", () => {
    reset(
      [{ id: "1", timestamp: 10, text: "ab", syllables: [{ text: "a", time: 10 }, { text: "b", time: 11 }] }],
      500 // 0.5s
    );
    useLrcStore.getState().applyOffset();
    expect(lines()[0].timestamp).toBeCloseTo(10.5, 5);
    expect(lines()[0].syllables!.map((s) => s.time)).toEqual([10.5, 11.5]);
    expect(useLrcStore.getState().doc.metadata.offset).toBe(0);
  });

  it("shiftTimeRange shifts only the range incl. syllable times", () => {
    reset([
      { id: "1", timestamp: 10, text: "a", syllables: [{ text: "a", time: 10 }] },
      { id: "2", timestamp: 20, text: "b" },
    ]);
    useLrcStore.getState().shiftTimeRange(0, 0, 2);
    expect(lines()[0].timestamp).toBe(12);
    expect(lines()[0].syllables!.map((s) => s.time)).toEqual([12]);
    expect(lines()[1].timestamp).toBe(20);
  });

  it("replaceInLines drops syllables on changed lines", () => {
    reset([{ id: "1", timestamp: 1, text: "cat", syllables: [{ text: "cat", time: 1 }] }]);
    const n = useLrcStore.getState().replaceInLines("cat", "dog", false);
    expect(n).toBe(1);
    expect(lines()[0].text).toBe("dog");
    expect(lines()[0].syllables).toBeUndefined();
  });
});

describe("useLrcStore — syllable actions", () => {
  it("commitSyllables sets syllables and line.timestamp = min time", () => {
    reset([{ id: "1", timestamp: null, text: "ab" }]);
    useLrcStore.getState().commitSyllables("1", [{ text: "a", time: 5 }, { text: "b", time: 3 }]);
    expect(lines()[0].timestamp).toBe(3);
    expect(lines()[0].syllables).toHaveLength(2);
  });

  it("clearLineSyllables removes syllables but keeps line.timestamp", () => {
    reset([{ id: "1", timestamp: 5, text: "ab", syllables: [{ text: "a", time: 5 }] }]);
    useLrcStore.getState().clearLineSyllables("1");
    expect(lines()[0].syllables).toBeUndefined();
    expect(lines()[0].timestamp).toBe(5);
  });

  it("commitSyllables with recordHistory=false does not push history", () => {
    reset([{ id: "1", timestamp: null, text: "a" }]);
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().commitSyllables("1", [{ text: "a", time: 1 }], false);
    expect(useLrcStore.getState()._history.length).toBe(h0);
  });
});

describe("useLrcStore — history & raw load", () => {
  it("undo/redo round-trips an addLine", () => {
    reset([]);
    useLrcStore.getState().addLine("x");
    expect(lines()).toHaveLength(1);
    useLrcStore.getState().undo();
    expect(lines()).toHaveLength(0);
    useLrcStore.getState().redo();
    expect(lines()).toHaveLength(1);
  });

  it("loadFromRawText replaces the document", () => {
    reset([{ id: "9", timestamp: null, text: "old" }]);
    useLrcStore.getState().loadFromRawText("[00:01.00]hello");
    expect(lines()[0].text).toBe("hello");
    expect(lines()[0].timestamp).toBe(1);
  });
});
