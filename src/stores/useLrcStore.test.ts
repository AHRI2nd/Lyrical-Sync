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

import { setDocumentConfirmation } from "../utils/documentTransition";
beforeEach(() => setDocumentConfirmation(async () => "discard"));

import { useLrcStore } from "./useLrcStore";
import type { LrcLine, LrcDocument } from "../types/lrc";
import { saveRecoverySnapshot, loadRecoverySnapshot, clearRecoverySnapshot } from "../utils/recovery";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "./useSettingsStore";
import { parseLrc, serializeLrc } from "../utils/lrcParser";
import { parseSrt, serializeSrt } from "../utils/srtConverter";
import { enqueuePathWrite } from "../utils/pathWriteQueue";

const reset = (lines: LrcLine[], offset = 0) => {
  const doc: LrcDocument = { metadata: { title: "", artist: "", album: "", by: "", offset }, lines, extraTags: {} };
  useLrcStore.setState({
    doc,
    _savedDocument: doc,
    _manualMetadataFields: new Set(),
    _history: [],
    _future: [],
    currentTime: 0,
    activeLineId: null,
    isDirty: false,
  });
};

const lines = () => useLrcStore.getState().doc.lines;

describe("useLrcStore — line actions", () => {
  it("serializes repeated metadata after the actual metadata edit action", () => {
    const doc = parseLrc("[ar:Earlier]\n[x-origin:Old]\n[ar:Latest]\n[x-origin:Recent]\n[00:01.00]lyric");
    useLrcStore.setState({ doc, _history: [], _future: [], isDirty: false });
    useLrcStore.getState().setMetadata({ artist: "Edited" });
    const output = serializeLrc(useLrcStore.getState().doc);
    expect(output).toContain("[ar:Earlier]\n[x-origin:Old]\n[ar:Edited]\n[x-origin:Recent]");
  });

  it("keeps cleared and edited metadata fields while filling untouched fields from audio tags", () => {
    useLrcStore.getState().setMetadata({ title: "Previous title" });
    useLrcStore.getState().setMetadata({ title: "" });
    useLrcStore.getState().setMetadata({ artist: "User artist" });

    useLrcStore.getState().setAudioMetadata({ title: "Tagged title", artist: "Tagged artist", album: "Tagged album" });

    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "", artist: "User artist", album: "Tagged album" });
  });

  it("resets manual metadata ownership when a new document is created", async () => {
    useLrcStore.getState().setMetadata({ title: "Previous title" });
    useLrcStore.getState().setMetadata({ title: "" });

    await useLrcStore.getState().newLrc();
    useLrcStore.getState().setAudioMetadata({ title: "New track title" });

    expect(useLrcStore.getState().doc.metadata.title).toBe("New track title");
  });

  it.each(["\u2028", "\u2029"])("rejects unsafe imported metadata separator %s before writing", async (separator) => {
    const doc = parseLrc(`[ti:safe${separator}[00:02.00]injected]\n[00:01.00]lyric`);
    useLrcStore.setState({ doc, lrcPath: "/working.lrc", isDirty: true });
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "LRC_METADATA_LINE_BREAK" });

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ doc, lrcPath: "/working.lrc", isDirty: true });
  });

  it("does not import audio tags into SRT cue metadata", () => {
    useLrcStore.setState({ lrcPath: "/lyrics.srt" });

    useLrcStore.getState().setAudioMetadata({ title: "Track title" });

    expect(useLrcStore.getState().doc.metadata.title).toBe("");
  });

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

  it("drops stale syllables when edited text no longer matches what save serializes", () => {
    reset([{ id: "1", timestamp: 10, text: "old", syllables: [{ text: "old", time: 10 }] }]);
    useLrcStore.getState().updateLine("1", { text: "new" });
    expect(lines()[0]).toMatchObject({ text: "new", syllables: undefined });
    expect(serializeLrc(useLrcStore.getState().doc).trim()).toBe("[00:10.00]new");
  });

  it("drops untimed syllables that no longer match ordinary text edits", () => {
    reset([{ id: "1", timestamp: 10, text: "old", syllables: [{ text: "old", time: null }] }]);
    useLrcStore.getState().updateLine("1", { text: "new" });
    expect(lines()[0]).toMatchObject({ text: "new", syllables: undefined });
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

  it("keeps imported SRT cue duration when its start time is edited", () => {
    reset([{ id: "1", timestamp: 10, srtEndTime: 12, text: "a" }]);
    useLrcStore.getState().updateLine("1", { timestamp: 11.5 });
    expect(lines()[0]).toMatchObject({ timestamp: 11.5, srtEndTime: 13.5 });
  });

  it("rejects a non-finite edited timestamp without changing the document", () => {
    reset([{ id: "1", timestamp: 1, text: "a" }]);
    const before = useLrcStore.getState().doc;
    useLrcStore.getState().updateLine("1", { timestamp: Number.NaN });
    expect(useLrcStore.getState().doc).toBe(before);
  });

  it("handles lyric rows with large syllable arrays", () => {
    reset([{ id: "1", timestamp: 0, text: "a" }]);
    const syllables = Array.from({ length: 200_000 }, (_, index) => ({ text: "a", time: index / 1000 }));
    expect(() => useLrcStore.getState().commitSyllables("1", syllables)).not.toThrow();
    expect(lines()[0].timestamp).toBe(0);
  });

  it("retimes a line with a large existing syllable array", () => {
    reset([{ id: "1", timestamp: 0, text: "a", syllables: Array.from({ length: 200_000 }, (_, index) => ({ text: "a", time: index / 1000 })) }]);
    expect(() => useLrcStore.getState().updateLine("1", { timestamp: 1 })).not.toThrow();
    expect(lines()[0].timestamp).toBe(1);
  });

  it("rejects timestamp scaling that overflows without changing the document", () => {
    reset([{ id: "1", timestamp: 10, text: "a" }]);
    const before = useLrcStore.getState().doc;
    useLrcStore.getState().scaleTimestamps(Number.MAX_VALUE);
    expect(useLrcStore.getState().doc).toBe(before);
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

  it("preserves glyph timing on case-insensitive rows whose replacement leaves text unchanged", () => {
    const unchanged = { id: "unchanged", timestamp: 1, text: "cat", syllables: [{ text: "cat", time: 1 }] };
    const changed = { id: "changed", timestamp: 2, text: "CAT", syllables: [{ text: "CAT", time: 2 }] };
    reset([unchanged, changed]);

    expect(useLrcStore.getState().replaceInLines("cat", "cat", false)).toBe(2);

    expect(lines()).toEqual([
      unchanged,
      { id: "changed", timestamp: 2, text: "cat", syllables: undefined },
    ]);
    useLrcStore.getState().undo();
    expect(lines()).toEqual([unchanged, changed]);
    useLrcStore.getState().redo();
    expect(lines()).toEqual([
      unchanged,
      { id: "changed", timestamp: 2, text: "cat", syllables: undefined },
    ]);
  });

  it("does not add history or mark dirty when replacements match but change no text", () => {
    const unchanged = { id: "same", timestamp: 1, text: "cat", syllables: [{ text: "cat", time: 1 }] };
    reset([unchanged]);

    expect(useLrcStore.getState().replaceInLines("cat", "cat", false)).toBe(1);

    expect(lines()).toEqual([unchanged]);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
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
  it("restores valid active and loop selections across undo, redo, and history jumps", () => {
    reset([
      { id: "a", timestamp: null, text: "first", syllables: [{ text: "first", time: null }] },
      { id: "b", timestamp: null, text: "second", syllables: [{ text: "second", time: null }] },
    ]);
    useLrcStore.setState({ activeLineId: "b", loopLineId: "b", activeSyllableIndex: 9 });
    useLrcStore.getState().deleteLine("b");
    useLrcStore.setState({ activeLineId: "ghost", loopLineId: "ghost", activeSyllableIndex: 9 });
    useLrcStore.getState().undo();
    expect(useLrcStore.getState()).toMatchObject({ activeLineId: "a", loopLineId: null, activeSyllableIndex: 0 });
    useLrcStore.getState().redo();
    expect(useLrcStore.getState()).toMatchObject({ activeLineId: "a", loopLineId: null, activeSyllableIndex: 0 });
    useLrcStore.getState().jumpToHistory(0);
    expect(useLrcStore.getState()).toMatchObject({ activeLineId: "a", loopLineId: null, activeSyllableIndex: 0 });
  });

  it("undo/redo round-trips an addLine", () => {
    reset([]);
    useLrcStore.getState().addLine("x");
    expect(lines()).toHaveLength(1);
    useLrcStore.getState().undo();
    expect(lines()).toHaveLength(0);
    useLrcStore.getState().redo();
    expect(lines()).toHaveLength(1);
  });

  it("stampAndAdvance with no active line records no history (no empty undo)", () => {
    reset([{ id: "1", timestamp: null, text: "a" }]);
    useLrcStore.setState({ activeLineId: null });
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().stampAndAdvance(); // only selects first line
    expect(useLrcStore.getState()._history.length).toBe(h0);
    expect(useLrcStore.getState().activeLineId).toBe("1");
  });

  it("applyOffset with zero offset records no history", () => {
    reset([{ id: "1", timestamp: 5, text: "a" }], 0);
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().applyOffset();
    expect(useLrcStore.getState()._history.length).toBe(h0);
  });

  it("loadFromRawText replaces the document", async () => {
    reset([{ id: "9", timestamp: null, text: "old" }]);
    await useLrcStore.getState().loadFromRawText("[00:01.00]hello");
    expect(lines()[0].text).toBe("hello");
    expect(lines()[0].timestamp).toBe(1);
  });

  it("does not reuse a row ID retained by undo history after replacing three lines with raw text", async () => {
    reset([]);
    useLrcStore.getState().addLine("first");
    useLrcStore.getState().addLine("second");
    useLrcStore.getState().addLine("third");
    const originalIds = lines().map((line) => line.id);

    await useLrcStore.getState().loadFromRawText("[00:01.00]replacement");
    expect(lines()[0].id).not.toBe(originalIds[0]);
    useLrcStore.getState().undo();
    useLrcStore.getState().addLine("fourth");

    const ids = lines().map((line) => line.id);
    expect(new Set(ids).size).toBe(ids.length);
    useLrcStore.getState().updateLine(originalIds[1], { text: "edited second" });
    expect(lines().filter((line) => line.text === "edited second")).toHaveLength(1);
    useLrcStore.getState().deleteLine(originalIds[1]);
    expect(lines().filter((line) => line.id === originalIds[1])).toHaveLength(0);
    expect(lines().map((line) => line.text)).toEqual(["first", "third", "fourth"]);
  });
});

describe("useLrcStore — line manipulation", () => {
  const mk = (id: string, text: string, ts: number | null = null): LrcLine => ({ id, timestamp: ts, text });

  it("duplicateLine copies text below without timestamp", () => {
    reset([mk("1", "a", 1), mk("2", "b", 2)]);
    const nid = useLrcStore.getState().duplicateLine("1");
    const ls = lines();
    expect(ls.map((l) => l.text)).toEqual(["a", "a", "b"]);
    expect(ls[1].id).toBe(nid);
    expect(ls[1].timestamp).toBeNull();
  });

  it("mergeLineUp combines into previous keeping its timestamp", () => {
    reset([mk("1", "hello", 1), mk("2", "world", 2)]);
    const pid = useLrcStore.getState().mergeLineUp("2");
    const ls = lines();
    expect(ls).toHaveLength(1);
    expect(ls[0].text).toBe("hello world");
    expect(ls[0].timestamp).toBe(1);
    expect(pid).toBe("1");
  });

  it("clears a merged repeat target and restores it only when undo restores the row", () => {
    reset([mk("1", "first", 1), mk("2", "repeated", 2)]);
    useLrcStore.setState({ activeLineId: "2", loopLineId: "2" });

    useLrcStore.getState().mergeLineUp("2");
    expect(useLrcStore.getState().loopLineId).toBeNull();

    useLrcStore.getState().undo();
    expect(lines().map((line) => line.id)).toEqual(["1", "2"]);
    expect(useLrcStore.getState().loopLineId).toBe("2");
    expect(useLrcStore.getState().activeLineId).toBe("2");

    useLrcStore.getState().redo();
    expect(lines().map((line) => line.id)).toEqual(["1"]);
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });

  it("restores a merged repeat target when jumping to the pre-merge history entry", () => {
    reset([mk("1", "first", 1), mk("2", "repeated", 2)]);
    useLrcStore.setState({ activeLineId: "2", loopLineId: "2" });
    useLrcStore.getState().mergeLineUp("2");

    useLrcStore.getState().jumpToHistory(0);

    expect(lines().map((line) => line.id)).toEqual(["1", "2"]);
    expect(useLrcStore.getState().activeLineId).toBe("2");
    expect(useLrcStore.getState().loopLineId).toBe("2");
  });

  it("keeps an unrelated repeat target when merging another row", () => {
    reset([mk("1", "first", 1), mk("2", "middle", 2), mk("3", "repeated", 3)]);
    useLrcStore.setState({ activeLineId: "3", loopLineId: "1" });

    useLrcStore.getState().mergeLineUp("3");
    expect(useLrcStore.getState().loopLineId).toBe("1");

    useLrcStore.getState().undo();
    expect(useLrcStore.getState().loopLineId).toBe("1");
  });

  it("mergeLineUp on the first line is a no-op", () => {
    reset([mk("1", "a"), mk("2", "b")]);
    expect(useLrcStore.getState().mergeLineUp("1")).toBeNull();
    expect(lines()).toHaveLength(2);
  });

  it("splitLine splits at caret; first keeps timestamp, second is new", () => {
    reset([mk("1", "helloworld", 5)]);
    const nid = useLrcStore.getState().splitLine("1", 5);
    const ls = lines();
    expect(ls.map((l) => l.text)).toEqual(["hello", "world"]);
    expect(ls[0].timestamp).toBe(5);
    expect(ls[1].timestamp).toBeNull();
    expect(ls[1].id).toBe(nid);
  });

  it.each([
    { stamp: 3, firstEnd: 3, secondEnd: 6 },
    { stamp: 5, firstEnd: 3.5, secondEnd: 6 },
    { stamp: 8, firstEnd: 3.5, secondEnd: 12 },
  ])("keeps split SRT halves non-overlapping when the second half is stamped at $stamp", async ({ stamp, firstEnd, secondEnd }) => {
    const source = "1\n00:00:01,000 --> 00:00:06,000\nfirstsecond\n\n2\n00:00:04,000 --> 00:00:07,000\nintentional neighbor overlap\n";
    let written = "";
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "read_lrc_file") return Promise.resolve(source);
      if (command === "write_lrc_file") {
        written = (args as { content: string }).content;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await useLrcStore.getState().loadLyricsPath("/split.srt");

    const firstId = lines()[0].id;
    const secondId = useLrcStore.getState().splitLine(firstId, 5);
    useLrcStore.getState().updateLine(secondId, { timestamp: stamp });
    let srtOutput: string;
    if (stamp === 3) {
      await useLrcStore.getState().saveLrc();
      srtOutput = written;
    } else {
      srtOutput = serializeSrt(useLrcStore.getState().doc);
    }

    const output = parseSrt(srtOutput).lines.filter((line) => line.text.trim()).sort((left, right) => left.timestamp! - right.timestamp!);
    expect(output.map(({ text, timestamp, srtEndTime }) => [text, timestamp, srtEndTime])).toEqual([
      ["first", 1, firstEnd],
      ...(stamp < 4
        ? [["second", stamp, secondEnd], ["intentional neighbor overlap", 4, 7]]
        : [["intentional neighbor overlap", 4, 7], ["second", stamp, secondEnd]]),
    ]);

    useLrcStore.getState().undo();
    expect(lines().slice(0, 2).map(({ timestamp, srtEndTime }) => [timestamp, srtEndTime])).toEqual([[1, 3.5], [null, 6]]);
    useLrcStore.getState().redo();
    expect(lines().slice(0, 2).map(({ timestamp, srtEndTime }) => [timestamp, srtEndTime])).toEqual([[1, firstEnd], [stamp, Math.max(stamp, 6)]]);
  });

  it("moveLine reorders lines", () => {
    reset([mk("1", "a"), mk("2", "b"), mk("3", "c")]);
    useLrcStore.getState().moveLine(0, 2);
    expect(lines().map((l) => l.text)).toEqual(["b", "c", "a"]);
  });

  it("line ops are undoable", () => {
    reset([mk("1", "a"), mk("2", "b")]);
    useLrcStore.getState().duplicateLine("1");
    expect(lines()).toHaveLength(3);
    useLrcStore.getState().undo();
    expect(lines()).toHaveLength(2);
  });
});

describe("useLrcStore — bulk line actions", () => {
  const mk = (id: string, text: string, ts: number | null = null): LrcLine => ({ id, timestamp: ts, text });

  it("deleteLines removes all given ids", () => {
    reset([mk("1", "a"), mk("2", "b"), mk("3", "c")]);
    useLrcStore.getState().deleteLines(["1", "3"]);
    expect(lines().map((l) => l.text)).toEqual(["b"]);
  });

  it("shiftLines moves only selected timestamps", () => {
    reset([mk("1", "a", 1), mk("2", "b", 2), mk("3", "c", 3)]);
    useLrcStore.getState().shiftLines(["1", "3"], 0.5);
    expect(lines().map((l) => l.timestamp)).toEqual([1.5, 2, 3.5]);
  });

  it("shiftLines never goes below 0", () => {
    reset([mk("1", "a", 0.2)]);
    useLrcStore.getState().shiftLines(["1"], -1);
    expect(lines()[0].timestamp).toBe(0);
  });

  it("clearTimestamps clears only selected", () => {
    reset([mk("1", "a", 1), mk("2", "b", 2)]);
    useLrcStore.getState().clearTimestamps(["2"]);
    expect(lines().map((l) => l.timestamp)).toEqual([1, null]);
  });
});

describe("recovery snapshot & restoreDoc", () => {
  const mkDoc = (): LrcDocument => ({
    metadata: { title: "T", artist: "A", album: "", by: "", offset: 0 },
    lines: [{ id: "x", timestamp: 1, text: "hi" }],
    extraTags: {},
  });
  beforeEach(() => clearRecoverySnapshot());

  it("save/load round-trips doc and paths", () => {
    saveRecoverySnapshot(mkDoc(), "/x.lrc", "/a.mp3");
    const snap = loadRecoverySnapshot();
    expect(snap?.doc.lines[0].text).toBe("hi");
    expect(snap?.lrcPath).toBe("/x.lrc");
    expect(snap?.audioPath).toBe("/a.mp3");
  });

  it("clear removes the snapshot", () => {
    saveRecoverySnapshot(mkDoc(), null, null);
    clearRecoverySnapshot();
    expect(loadRecoverySnapshot()).toBeNull();
  });

  it("restoreDoc loads doc, marks dirty, reassigns ids", async () => {
    reset([]);
    await useLrcStore.getState().restoreDoc(mkDoc(), "/p.lrc", "/a.mp3");
    const st = useLrcStore.getState();
    expect(st.doc.lines[0].text).toBe("hi");
    expect(st.lrcPath).toBe("/p.lrc");
    expect(st.audioPath).toBe("/a.mp3");
    expect(st.isDirty).toBe(true);
    expect(st.doc.lines[0].id).toBe("1");
  });
});

describe("useLrcStore — security-scoped bookmarks (App Sandbox)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    reset([]);
    useLrcStore.setState({ audioPath: null, audioBookmark: null, lrcPath: null, lrcBookmark: null });
    vi.mocked(invoke).mockReset();
    vi.mocked(open).mockReset();
    vi.mocked(save).mockReset();
  });

  it("ignores an older audio picker after a newer picker selection", async () => {
    let resolveOlder!: (path: string | null) => void;
    let resolveNewer!: (path: string | null) => void;
    vi.mocked(open)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));

    const older = useLrcStore.getState().openAudio();
    const newer = useLrcStore.getState().openAudio();
    resolveNewer("/newer.wav");
    await newer;
    expect(useLrcStore.getState().audioPath).toBe("/newer.wav");

    resolveOlder("/older.wav");
    await older;
    expect(useLrcStore.getState().audioPath).toBe("/newer.wav");
  });

  it("ignores an audio picker result after a newer selection and preserves cancel", async () => {
    let resolvePicker!: (path: string | null) => void;
    vi.mocked(open)
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; }))
      .mockResolvedValueOnce(null);

    const pending = useLrcStore.getState().openAudio();
    useLrcStore.getState().setAudioPath("/selected.wav");
    resolvePicker("/stale.wav");
    await pending;
    expect(useLrcStore.getState().audioPath).toBe("/selected.wav");

    useLrcStore.getState().setAudioPath(null);
    await useLrcStore.getState().openAudio();
    expect(useLrcStore.getState().audioPath).toBeNull();
  });

  it("setAudioPath sets the path immediately and resolves the bookmark asynchronously", async () => {
    vi.mocked(invoke).mockImplementation((cmd: unknown) =>
      cmd === "create_security_bookmark" ? Promise.resolve("bm-a") : Promise.resolve(undefined)
    );
    useLrcStore.getState().setAudioPath("/a.mp3");
    expect(useLrcStore.getState().audioPath).toBe("/a.mp3");
    expect(useLrcStore.getState().audioBookmark).toBeNull();

    await flush();
    expect(useLrcStore.getState().audioBookmark).toBe("bm-a");
  });

  it("does not let a stale bookmark overwrite a newer path (race guard)", async () => {
    let resolveA!: (v: string) => void;
    vi.mocked(invoke).mockImplementation((cmd: unknown, args?: unknown) => {
      if (cmd !== "create_security_bookmark") return Promise.resolve(undefined);
      const path = (args as { path?: string } | undefined)?.path;
      if (path === "/a.mp3") return new Promise((r) => { resolveA = r; });
      return Promise.resolve("bm-b");
    });

    useLrcStore.getState().setAudioPath("/a.mp3"); // slow bookmark creation
    useLrcStore.getState().setAudioPath("/b.mp3"); // switches before A resolves
    await flush();
    expect(useLrcStore.getState().audioBookmark).toBe("bm-b");

    resolveA("bm-a"); // late resolution for the now-stale path
    await flush();
    expect(useLrcStore.getState().audioPath).toBe("/b.mp3");
    expect(useLrcStore.getState().audioBookmark).toBe("bm-b"); // unchanged by the stale resolve
  });

  it("setAudioPath(null) clears the bookmark without invoking bookmark creation", () => {
    useLrcStore.setState({ audioPath: "/old.mp3", audioBookmark: "bm-old" });
    useLrcStore.getState().setAudioPath(null);
    expect(useLrcStore.getState().audioPath).toBeNull();
    expect(useLrcStore.getState().audioBookmark).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("create_security_bookmark", expect.anything());
  });

  it("setAudioPath records the path + resolved bookmark into recentFiles", async () => {
    useSettingsStore.setState({ recentFiles: [] });
    vi.mocked(invoke).mockImplementation((cmd: unknown) =>
      cmd === "create_security_bookmark" ? Promise.resolve("bm-a") : Promise.resolve(undefined)
    );
    useLrcStore.getState().setAudioPath("/a.mp3");
    await flush();
    const files = useSettingsStore.getState().recentFiles;
    expect(files[0]).toMatchObject({ audioPath: "/a.mp3", lrcPath: null, audioBookmark: "bm-a" });
  });

  it("loadLyricsPath resolves lrcBookmark after loading the file", async () => {
    vi.mocked(invoke).mockImplementation((cmd: unknown) => {
      if (cmd === "read_lrc_file") return Promise.resolve("[00:01.00]hello");
      if (cmd === "create_security_bookmark") return Promise.resolve("bm-lrc");
      return Promise.resolve(undefined);
    });
    await useLrcStore.getState().loadLyricsPath("/song.lrc");
    expect(useLrcStore.getState().lrcPath).toBe("/song.lrc");

    await flush();
    expect(useLrcStore.getState().lrcBookmark).toBe("bm-lrc");
  });

  it("loadLyricsPath records the path + resolved bookmark into recentFiles", async () => {
    useSettingsStore.setState({ recentFiles: [] });
    vi.mocked(invoke).mockImplementation((cmd: unknown) => {
      if (cmd === "read_lrc_file") return Promise.resolve("[00:01.00]hello");
      if (cmd === "create_security_bookmark") return Promise.resolve("bm-lrc");
      return Promise.resolve(undefined);
    });
    await useLrcStore.getState().loadLyricsPath("/song.lrc");
    await flush();
    const files = useSettingsStore.getState().recentFiles;
    expect(files[0]).toMatchObject({ lrcPath: "/song.lrc", audioPath: null, lrcBookmark: "bm-lrc" });
  });

  it("preserves CR-only LRC rows through load, edit, and save", async () => {
    const source = "[ti:Song]\r[00:01.00]first\r[00:02.00]second";
    let written = "";
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "read_lrc_file") return Promise.resolve(source);
      if (command === "write_lrc_file") {
        written = (args as { content: string }).content;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await useLrcStore.getState().loadLyricsPath("/legacy-cr-only.lrc");
    useLrcStore.getState().updateLine(lines()[0].id, { text: "edited first" });
    await useLrcStore.getState().saveLrc();

    const restored = parseLrc(written);
    expect(restored.metadata.title).toBe("Song");
    expect(restored.lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([
      [1, "edited first"], [2, "second"],
    ]);
  });

  it("saveLrcAs resolves lrcBookmark for the newly saved lrc path", async () => {
    vi.mocked(save).mockResolvedValue("/new.lrc");
    vi.mocked(invoke).mockImplementation((cmd: unknown) => {
      if (cmd === "write_lrc_file") return Promise.resolve(undefined);
      if (cmd === "create_security_bookmark") return Promise.resolve("bm-new");
      return Promise.resolve(undefined);
    });
    const written = await useLrcStore.getState().saveLrcAs("lrc");
    expect(written).toBe(true);
    expect(useLrcStore.getState().lrcPath).toBe("/new.lrc");

    await flush();
    expect(useLrcStore.getState().lrcBookmark).toBe("bm-new");
  });

  it("does not dispatch a queued Save As write after the document changes", async () => {
    let release!: () => void;
    const blocker = enqueuePathWrite("/queued-save-as.lrc", () => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.mocked(save).mockResolvedValue("/queued-save-as.lrc");
    vi.mocked(invoke).mockImplementation((cmd: unknown, args?: unknown) => {
      if (cmd === "prepare_file_ref") return Promise.resolve(args);
      return Promise.resolve(undefined);
    });
    const pendingSave = useLrcStore.getState().saveLrcAs("lrc");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const current = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...current.doc, lines: [{ id: "replacement", timestamp: null, text: "replacement" }] },
      _documentSession: current._documentSession + 1,
      lrcPath: "/queued-save-as.lrc",
      isDirty: true,
    });
    release();
    await blocker;

    expect(await pendingSave).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/queued-save-as.lrc", isDirty: true });
  });

  it("does not dispatch a queued working-file write after the document changes at the same path", async () => {
    let release!: () => void;
    const blocker = enqueuePathWrite("/queued-save.lrc", () => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    useLrcStore.setState({ lrcPath: "/queued-save.lrc", lrcBookmark: null, isDirty: true });
    const pendingSave = useLrcStore.getState().saveLrc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const current = useLrcStore.getState();
    useLrcStore.setState({ _documentSession: current._documentSession + 1, isDirty: true });
    release();
    await blocker;

    expect(await pendingSave).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects an unrepresentable SRT Save As before writing or changing the working path", async () => {
    vi.mocked(save).mockResolvedValue("/export.srt");
    useLrcStore.setState({
      doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, extraTags: {},
        lines: [{ id: "1", timestamp: 1, text: "first\n\nthird" }] },
      lrcPath: "/working.lrc", isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrcAs("srt")).rejects.toThrow("cannot preserve blank paragraph rows");
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/working.lrc", isDirty: true });
  });

  it("rejects unrepresentable ASS text before writing and keeps the document dirty", async () => {
    useLrcStore.setState({
      doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, extraTags: {},
        lines: [{ id: "1", timestamp: 1, text: "literal {override}" }] },
      lrcPath: "/working.ass", isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "ASS_UNREPRESENTABLE_CONTENT" });
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/working.ass", isDirty: true });
  });

  it("rejects unrepresentable ASS Save As before writing or changing the working path", async () => {
    vi.mocked(save).mockResolvedValue("/export.ass");
    useLrcStore.setState({
      doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, extraTags: {},
        lines: [{ id: "1", timestamp: 1, text: "literal \\N" }] },
      lrcPath: "/working.lrc", isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrcAs("ass")).rejects.toMatchObject({ code: "ASS_UNREPRESENTABLE_CONTENT" });
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/working.lrc", isDirty: true });
  });

  it("rejects an ASS escape assembled across timed syllable tokens before writing", async () => {
    vi.mocked(save).mockResolvedValue("/export.ass");
    const doc: LrcDocument = { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, extraTags: {},
      lines: [{ id: "split", timestamp: 1, text: "\\N", syllables: [{ text: "\\", time: 1 }, { text: "N", time: null }] }] };
    useLrcStore.setState({ doc, lrcPath: "/working.lrc", isDirty: true });

    await expect(useLrcStore.getState().saveLrcAs("ass")).rejects.toMatchObject({ code: "ASS_UNREPRESENTABLE_CONTENT" });

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ doc, lrcPath: "/working.lrc", isDirty: true });
  });

  it("rejects a conflicting LRC escape marker before writing", async () => {
    vi.mocked(save).mockResolvedValue("/export.lrc");
    useLrcStore.setState({
      doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 },
        extraTags: { "x-lyrical-inline-escape": "custom" },
        lines: [{ id: "1", timestamp: 1, text: "literal <00:02.00>" }] },
      lrcPath: "/working.lrc", isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrcAs("lrc")).rejects.toThrow("tag is reserved");
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/working.lrc", isDirty: true });
  });

  it("escapes literal VTT markup in Save As output", async () => {
    vi.mocked(save).mockResolvedValue("/export.vtt");
    let content = "";
    vi.mocked(invoke).mockImplementation((cmd: unknown, args?: unknown) => {
      if (cmd === "write_lrc_file") content = (args as { content: string }).content;
      return Promise.resolve(undefined);
    });
    useLrcStore.setState({
      doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, extraTags: {},
        lines: [{ id: "1", timestamp: 1, text: "<b>A & B > C</b>" }] },
      lrcPath: "/working.lrc", isDirty: true,
    });

    expect(await useLrcStore.getState().saveLrcAs("vtt")).toBe(true);
    expect(content).toContain("&lt;b&gt;A &amp; B &gt; C&lt;/b&gt;");
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/working.lrc", isDirty: true });
  });

  it("restoreDoc sets bookmarks directly from parameters", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) => cmd === "prepare_file_ref" ? Promise.resolve(args) : Promise.resolve(null));
    const doc: LrcDocument = {
      metadata: { title: "T", artist: "", album: "", by: "", offset: 0 },
      lines: [{ id: "x", timestamp: null, text: "hi" }],
      extraTags: {},
    };
    await useLrcStore.getState().restoreDoc(doc, "/p.lrc", "/a.mp3", "bm-lrc", "bm-audio");
    const st = useLrcStore.getState();
    expect(st.lrcBookmark).toBe("bm-lrc");
    expect(st.audioBookmark).toBe("bm-audio");
  });

  it("restoreDoc defaults bookmarks to null when omitted", async () => {
    const doc: LrcDocument = {
      metadata: { title: "T", artist: "", album: "", by: "", offset: 0 },
      lines: [{ id: "x", timestamp: null, text: "hi" }],
      extraTags: {},
    };
    await useLrcStore.getState().restoreDoc(doc, "/p.lrc", "/a.mp3");
    const st = useLrcStore.getState();
    expect(st.lrcBookmark).toBeNull();
    expect(st.audioBookmark).toBeNull();
  });
});

describe("useLrcStore — loop line", () => {
  beforeEach(() => reset([{ id: "1", timestamp: 1, text: "a" }, { id: "2", timestamp: 2, text: "b" }]));

  it("setLoopLine sets and clears the loop target", () => {
    useLrcStore.getState().setLoopLine("1");
    expect(useLrcStore.getState().loopLineId).toBe("1");
    useLrcStore.getState().setLoopLine(null);
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });

  it("deleteLine clears loopLineId if the looping line is removed", () => {
    useLrcStore.getState().setLoopLine("1");
    useLrcStore.getState().deleteLine("1");
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });

  it("deleteLine leaves loopLineId untouched for an unrelated line", () => {
    useLrcStore.getState().setLoopLine("2");
    useLrcStore.getState().deleteLine("1");
    expect(useLrcStore.getState().loopLineId).toBe("2");
  });

  it("deleteLines clears loopLineId if the looping line is among the deleted", () => {
    useLrcStore.getState().setLoopLine("2");
    useLrcStore.getState().deleteLines(["1", "2"]);
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });

  it("newLrc/loadFromRawText/restoreDoc reset loopLineId", async () => {
    useLrcStore.getState().setLoopLine("1");
    await useLrcStore.getState().newLrc();
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });
});

describe("useLrcStore — addLinesFromSpeechSegments", () => {
  beforeEach(() => reset([]));

  it("inserts a blank stamped line per segment, sorted by start time", () => {
    const count = useLrcStore.getState().addLinesFromSpeechSegments([
      { start: 2, end: 3 },
      { start: 0.5, end: 1 },
    ]);
    expect(count).toBe(2);
    const ls = lines();
    expect(ls.map((l) => l.timestamp)).toEqual([0.5, 2]);
    expect(ls.every((l) => l.text === "")).toBe(true);
  });

  it("interleaves new segments among already-stamped lines by time", () => {
    reset([{ id: "1", timestamp: 0, text: "first" }, { id: "2", timestamp: 5, text: "last" }]);
    useLrcStore.getState().addLinesFromSpeechSegments([{ start: 2, end: 2.5 }]);
    expect(lines().map((l) => l.text)).toEqual(["first", "", "last"]);
  });

  it("does not reorder existing unstamped lines", () => {
    reset([{ id: "1", timestamp: null, text: "typed first" }, { id: "2", timestamp: null, text: "typed second" }]);
    useLrcStore.getState().addLinesFromSpeechSegments([{ start: 1, end: 1.5 }]);
    // 미입력 줄은 정렬 기준에서 제외 → 새 줄은 맨 뒤로 붙고 기존 순서는 그대로
    expect(lines().map((l) => l.text)).toEqual(["typed first", "typed second", ""]);
  });

  it("preserves existing order, untimed placement, and stable ties while merging", () => {
    reset([
      { id: "late", timestamp: 10, text: "late" },
      { id: "untimed", timestamp: null, text: "typed" },
      { id: "tie-a", timestamp: 5, text: "tie a" },
      { id: "tie-b", timestamp: 5, text: "tie b" },
      { id: "early", timestamp: 2, text: "early" },
    ]);

    const count = useLrcStore.getState().addLinesFromSpeechSegments([
      { start: 5, end: 5.5 },
      { start: 2, end: 2.5 },
      { start: 5, end: 5.25 },
      { start: 4.9996, end: 5.1 },
    ]);

    expect(count).toBe(4);
    const result = lines();
    expect(result.filter((line) => ["late", "untimed", "tie-a", "tie-b", "early"].includes(line.id))).toEqual([
      { id: "late", timestamp: 10, text: "late" },
      { id: "untimed", timestamp: null, text: "typed" },
      { id: "tie-a", timestamp: 5, text: "tie a" },
      { id: "tie-b", timestamp: 5, text: "tie b" },
      { id: "early", timestamp: 2, text: "early" },
    ]);
    expect(result.map((line) => line.timestamp)).toEqual([2, 5, 5, 5, 10, null, 5, 5, 2]);
    const inserted = result.filter((line) => line.text === "");
    expect(inserted.map((line) => line.timestamp)).toEqual([2, 5, 5, 5]);
    expect(inserted.slice(1).map((line) => Number(line.id))).toEqual(
      inserted.slice(1).map((line) => Number(line.id)).sort((a, b) => a - b),
    );
    expect(new Set(result.map((line) => line.id)).size).toBe(result.length);
    expect(useLrcStore.getState()._history).toHaveLength(1);
  });

  it("handles a large batch with one history entry", () => {
    const segments = Array.from({ length: 10_000 }, (_, index) => ({
      start: (10_000 - index) / 10,
      end: (10_000 - index) / 10 + 0.25,
    }));

    const count = useLrcStore.getState().addLinesFromSpeechSegments(segments);

    expect(count).toBe(10_000);
    expect(lines()).toHaveLength(10_000);
    expect(lines().map((line) => line.timestamp)).toEqual(
      Array.from({ length: 10_000 }, (_, index) => (index + 1) / 10),
    );
    expect(useLrcStore.getState()._history).toHaveLength(1);
  });

  it("returns 0 and does not touch history for an empty segment list", () => {
    useLrcStore.getState().addLinesFromSpeechSegments([]);
    expect(lines()).toEqual([]);
  });
});

describe("useLrcStore — snapLinesToBeatGrid", () => {
  beforeEach(() => reset([]));

  it("returns the number of selected timed rows actually changed", () => {
    reset([
      { id: "changed", timestamp: 1.34, text: "Changed" },
      { id: "already", timestamp: 0.5, text: "Already aligned" },
      { id: "untimed", timestamp: null, text: "Untimed" },
    ]);

    const count = useLrcStore.getState().snapLinesToBeatGrid(["changed", "already", "untimed"], 120, 0);

    expect(count).toBe(1);
    expect(lines().map((line) => line.timestamp)).toEqual([1.5, 0.5, null]);
    expect(useLrcStore.getState()._history).toHaveLength(1);
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("returns zero without changing an all-untimed document", () => {
    reset([{ id: "untimed", timestamp: null, text: "Untimed" }]);
    const before = useLrcStore.getState().doc;

    expect(useLrcStore.getState().snapLinesToBeatGrid([], 120, 0)).toBe(0);
    expect(useLrcStore.getState().doc).toBe(before);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it.each([
    { bpm: 0, offset: 0 },
    { bpm: 120, offset: Number.NaN },
  ])("rejects invalid grid inputs without mutation ($bpm, $offset)", ({ bpm, offset }) => {
    reset([{ id: "timed", timestamp: 1.34, text: "Timed" }]);
    const before = useLrcStore.getState().doc;

    expect(useLrcStore.getState().snapLinesToBeatGrid([], bpm, offset)).toBe(0);
    expect(useLrcStore.getState().doc).toBe(before);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("returns zero and leaves document, history, and dirty state untouched when nothing changes", () => {
    reset([
      { id: "aligned", timestamp: 0.5, text: "Aligned" },
      { id: "untimed", timestamp: null, text: "Untimed" },
    ]);
    const before = useLrcStore.getState().doc;

    const count = useLrcStore.getState().snapLinesToBeatGrid([], 120, 0);

    expect(count).toBe(0);
    expect(useLrcStore.getState().doc).toBe(before);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });
});

describe("useLrcStore scoped file references", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    reset([]);
    useLrcStore.setState({ lrcPath: null, lrcBookmark: null, audioBookmark: null, audioPath: null });
    useSettingsStore.setState({ recentFiles: [] });
  });

  it("keeps a refreshed bookmark when opening a moved recent lyric file", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "prepare_file_ref") return Promise.resolve({ path: "/moved/song.lrc", bookmark: "fresh" });
      if (cmd === "read_lrc_file") return Promise.resolve("[00:01.00]hello");
      return Promise.reject(new Error("Unexpected command"));
    });
    await useLrcStore.getState().loadLyricsPath("/old/song.lrc", "old");
    expect(useLrcStore.getState().lrcPath).toBe("/moved/song.lrc");
    expect(useLrcStore.getState().lrcBookmark).toBe("fresh");
    expect(useSettingsStore.getState().recentFiles[0].lrcBookmark).toBe("fresh");
  });

  it("rejects a malformed SRT cue without replacing unsaved document state or writing", async () => {
    const originalDoc = { metadata: { title: "Unsaved", artist: "", album: "", by: "", offset: 0 },
      lines: [{ id: "unsaved", timestamp: null, text: "keep this edit" }], extraTags: {} };
    useLrcStore.setState({
      doc: originalDoc,
      lrcPath: "/existing.srt", audioPath: "/existing.wav", isDirty: true,
      _history: [originalDoc], _future: [],
    });
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "prepare_file_ref") return Promise.resolve({ path: "/incoming.srt", bookmark: "fresh" });
      if (cmd === "read_lrc_file") return Promise.resolve(
        "1\n00:00:01,000 --> 00:00:02,000\nfirst\n\n2\n00:00:xx,000 --> 00:00:03,000\nsecond\n",
      );
      return Promise.reject(new Error(`Unexpected command: ${String(cmd)}`));
    });

    await expect(useLrcStore.getState().loadLyricsPath("/incoming.srt")).rejects.toMatchObject({ code: "SRT_MALFORMED_CUE" });

    const state = useLrcStore.getState();
    expect(state.doc).toBe(originalDoc);
    expect(state.lrcPath).toBe("/existing.srt");
    expect(state.audioPath).toBe("/existing.wav");
    expect(state.isDirty).toBe(true);
    expect(state._history).toEqual([originalDoc]);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "write_lrc_file")).toBe(false);
  });

  it("writes a restored lyric file using its persisted bookmark", async () => {
    useLrcStore.setState({ lrcPath: "/song.lrc", lrcBookmark: "old", isDirty: true });
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "prepare_file_ref") return Promise.resolve({ path: "/song.lrc", bookmark: "fresh" });
      if (cmd === "write_lrc_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("Unexpected command"));
    });
    expect(await useLrcStore.getState().saveLrc()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({
      path: "/song.lrc", bookmark: "fresh",
    }));
    expect(useLrcStore.getState().lrcBookmark).toBe("fresh");
  });

  it("saves a bookmark-resolved same-format rename using the refreshed destination", async () => {
    useLrcStore.setState({
      lrcPath: "/old/song.lrc", lrcBookmark: "old", isDirty: true,
      doc: { ...useLrcStore.getState().doc, lines: [{ id: "saved", timestamp: 1, text: "hello" }] },
    });
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "prepare_file_ref") return Promise.resolve({ path: "/moved/song.lrc", bookmark: "fresh" });
      if (command === "write_lrc_file") return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${String(command)}`));
    });
    expect(await useLrcStore.getState().saveLrc()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({
      path: "/moved/song.lrc", bookmark: "fresh", content: expect.stringContaining("[00:01.00]"),
    }));
    expect(useLrcStore.getState().lrcPath).toBe("/moved/song.lrc");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it.each([
    { source: "/old/song.lrc", resolved: "/moved/song.srt", title: "LRC to SRT" },
    { source: "/old/song.srt", resolved: "/moved/song.lrc", title: "SRT to LRC" },
  ])("does not save after bookmark resolution changes format ($title)", async ({ source, resolved }) => {
    useLrcStore.setState({ lrcPath: source, lrcBookmark: "old", isDirty: true });
    if (source.endsWith(".srt")) {
      useLrcStore.setState({ doc: { ...useLrcStore.getState().doc, metadata: { ...useLrcStore.getState().doc.metadata, title: "Must remain LRC" } } });
    }
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "prepare_file_ref") return Promise.resolve({ path: resolved, bookmark: "fresh" });
      if (command === "write_lrc_file") return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${String(command)}`));
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "LYRIC_SAVE_FORMAT_CHANGED" });

    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "write_lrc_file")).toBe(false);
    expect(useLrcStore.getState().lrcPath).toBe(source);
    expect(useLrcStore.getState().lrcBookmark).toBe("old");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });
  it("retains a newly selected file grant while its lyrics are edited", async () => {
    let finish!: (bookmark: string) => void;
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "read_lrc_file") return Promise.resolve("[00:01.00]hello");
      if (cmd === "create_security_bookmark") return new Promise<string>((resolve) => { finish = resolve; });
      return Promise.reject(new Error("Unexpected command"));
    });
    await useLrcStore.getState().loadLyricsPath("/song.lrc");
    useLrcStore.setState({ doc: { ...useLrcStore.getState().doc, metadata: { ...useLrcStore.getState().doc.metadata, title: "Edited" } } });
    finish("selected-grant");
    await vi.waitFor(() => expect(useLrcStore.getState().lrcBookmark).toBe("selected-grant"));
  });

  it("refreshes the active file grant across edits but rejects another file", () => {
    useLrcStore.setState({ audioPath: "/old/song.mp3", audioBookmark: "old" });
    useLrcStore.setState({ doc: { ...useLrcStore.getState().doc } });
    useLrcStore.getState().refreshFileReference("audio", { path: "/old/song.mp3", bookmark: "old" },
      { path: "/moved/song.mp3", bookmark: "fresh" });
    expect(useLrcStore.getState().audioBookmark).toBe("fresh");
    useLrcStore.getState().refreshFileReference("audio", { path: "/another/song.mp3", bookmark: "old" },
      { path: "/wrong/song.mp3", bookmark: "wrong" });
    expect(useLrcStore.getState().audioPath).toBe("/moved/song.mp3");
  });

});

describe("delayed recent-file bookmark ownership", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useSettingsStore.setState({ recentFiles: [] });
    reset([]);
  });

  it("persists a former document bookmark without changing the active document", async () => {
    const grants = new Map<string, (bookmark: string) => void>();
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "read_lrc_file") return Promise.resolve(`[00:01.00]${(args as { path?: string } | undefined)?.path}`);
      if (command === "create_security_bookmark") return new Promise<string>((resolve) => grants.set(String((args as { path?: string } | undefined)?.path), resolve));
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await useLrcStore.getState().loadLyricsPath("/A.lrc");
    await useLrcStore.getState().loadLyricsPath("/B.lrc");
    grants.get("/B.lrc")!("grant-B");
    await vi.waitFor(() => expect(useLrcStore.getState().lrcBookmark).toBe("grant-B"));
    grants.get("/A.lrc")!("grant-A");
    await vi.waitFor(() => expect(useSettingsStore.getState().recentFiles.find((entry) => entry.lrcPath === "/A.lrc")?.lrcBookmark).toBe("grant-A"));

    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/B.lrc", lrcBookmark: "grant-B" });
    const persisted = JSON.parse(localStorage.getItem("lyrical-sync-settings") ?? "{}");
    expect(persisted.state.recentFiles.find((entry: { lrcPath: string }) => entry.lrcPath === "/A.lrc").lrcBookmark).toBe("grant-A");
  });

  it("does not restore a cleared entry or apply an old grant to a reopened path", async () => {
    const grants: Array<{ path: string; resolve: (bookmark: string) => void }> = [];
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "read_lrc_file") return Promise.resolve(`[00:01.00]${(args as { path?: string } | undefined)?.path}`);
      if (command === "create_security_bookmark") return new Promise<string>((resolve) => grants.push({ path: String((args as { path?: string } | undefined)?.path), resolve }));
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await useLrcStore.getState().loadLyricsPath("/same.lrc");
    const firstEntry = useSettingsStore.getState().recentFiles[0];
    useSettingsStore.getState().clearRecentFiles();
    grants[0].resolve("cleared-grant");
    await Promise.resolve();
    expect(useSettingsStore.getState().recentFiles).toEqual([]);

    await useLrcStore.getState().loadLyricsPath("/same.lrc");
    const reopenedEntry = useSettingsStore.getState().recentFiles[0];
    expect(reopenedEntry.openedAt).not.toBe(firstEntry.openedAt);
    grants[1].resolve("new-grant");
    await vi.waitFor(() => expect(useSettingsStore.getState().recentFiles[0].lrcBookmark).toBe("new-grant"));
    grants[0].resolve("stale-grant");
    await Promise.resolve();
    expect(useSettingsStore.getState().recentFiles[0].lrcBookmark).toBe("new-grant");
  });
});

describe("useLrcStore SRT save policy", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    vi.mocked(save).mockReset();
    reset([{ id: "1", timestamp: 1, text: "timed", syllables: [{ text: "timed", time: 1 }] }]);
  });

  it("rejects a lossy save over an SRT working file without writing", async () => {
    useLrcStore.setState({ lrcPath: "/existing.srt", lrcBookmark: null, isDirty: true });

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("SRT cannot preserve");

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/existing.srt");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("requires confirmation before converting supported SRT styles and preserves literal tag text", async () => {
    vi.mocked(save).mockResolvedValue("/exports/styled.lrc");
    let content = "";
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "write_lrc_file") content = (args as { content: string }).content;
      return Promise.resolve(undefined);
    });
    const original = parseSrt("1\n00:00:01,000 --> 00:00:03,000\n<i>styled</i> &lt;b&gt;literal&lt;/b&gt;\n");
    useLrcStore.setState({ doc: original, lrcPath: "/source.srt", isDirty: false });

    await expect(useLrcStore.getState().saveLrcAs("lrc")).rejects.toThrow("SRT_ONLY_DATA_NOT_REPRESENTABLE");
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().doc).toBe(original);

    await expect(useLrcStore.getState().saveLrcAs("lrc", undefined, true)).resolves.toBe(true);
    expect(content).toContain("styled <b>literal</b>");
    expect(content).not.toContain("<i>");
    expect(useLrcStore.getState().doc.lines[0].text).toBe("styled <b>literal</b>");
    expect(useLrcStore.getState().doc.lines[0].srtInlineFormatting).toBeUndefined();
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc.lines[0].text).toBe("<i>styled</i> <b>literal</b>");
    expect(useLrcStore.getState().doc.lines[0].srtInlineFormatting).toHaveLength(2);
  });

  it("does not autosave an SRT document into LRC while SRT-only data needs confirmation", async () => {
    const original = parseSrt("1\n00:00:01,000 --> 00:00:03,000\n<b>styled</b>\n");
    useLrcStore.setState({ doc: original, lrcPath: "/working.lrc", isDirty: true });
    useSettingsStore.setState({ autoSave: true });

    await expect(useLrcStore.getState().saveLrc({ autoSaveOnly: true })).resolves.toBe(false);

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().doc).toBe(original);
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("requires confirmation before saving SRT-only styles to the working LRC path", async () => {
    let content = "";
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "write_lrc_file") content = (args as { content: string }).content;
      return Promise.resolve(undefined);
    });
    const original = parseSrt("1\n00:00:01,000 --> 00:00:03,000\n<u>styled</u>\n");
    useLrcStore.setState({ doc: original, lrcPath: "/working.lrc", isDirty: true });

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("SRT_ONLY_DATA_NOT_REPRESENTABLE");
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());

    await expect(useLrcStore.getState().saveLrc({ confirmSrtOnlyDataLoss: true })).resolves.toBe(true);
    expect(content).toContain("styled");
    expect(content).not.toContain("<u>");
    expect(useLrcStore.getState().doc.lines[0].srtInlineFormatting).toBeUndefined();
    expect(useLrcStore.getState().isDirty).toBe(false);
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc.lines[0].text).toBe("<u>styled</u>");
    expect(useLrcStore.getState().doc.lines[0].srtInlineFormatting).toHaveLength(2);
  });

  it("rejects a trailing SRT boundary loss without writing or marking the document clean", async () => {
    vi.mocked(invoke).mockImplementation((command) => command === "prepare_file_ref"
      ? Promise.resolve({ path: "/working.srt", bookmark: "srt-grant" })
      : Promise.resolve(undefined));
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nfirst\n");
    doc.lines.push({ id: "new-end", timestamp: 10, text: "" });
    useLrcStore.setState({ doc, lrcPath: "/working.srt", lrcBookmark: "srt-grant", isDirty: true });

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("SRT cannot preserve");

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState()).toMatchObject({ lrcPath: "/working.srt", lrcBookmark: "srt-grant", isDirty: true });
  });

  it("lets a translated SRT cue be saved after the translation is removed", async () => {
    vi.mocked(invoke).mockResolvedValue("b".repeat(64));
    const imported = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nlyric");
    imported.lines[0].id = "srt-cue";
    useLrcStore.setState({ doc: imported, lrcPath: "/tmp/song.srt", lrcBookmark: null, isDirty: false });
    const lineId = useLrcStore.getState().doc.lines[0].id;
    useLrcStore.getState().updateLine(lineId, { translation: "translated" });

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "SRT_LOSSY_DOCUMENT" });
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());

    useLrcStore.getState().updateLine(lineId, { translation: "" });
    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({
      path: "/tmp/song.srt",
      content: expect.stringContaining("\nlyric\n"),
    }));
    expect(useLrcStore.getState().isDirty).toBe(false);

    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc.lines[0].translation).toBe("translated");
    expect(useLrcStore.getState().isDirty).toBe(true);
    useLrcStore.getState().redo();
    expect(useLrcStore.getState().doc.lines[0].translation).toBe("");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("clears dirty when undo returns to the last successfully saved document", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    reset([{ id: "saved", timestamp: 1, text: "saved line" }]);
    useLrcStore.setState({ lrcPath: "/working.lrc" });
    const savedDocument = useLrcStore.getState().doc;

    useLrcStore.getState().setMetadata({ title: "Edited title" });
    useLrcStore.getState().setLines([
      { id: "saved", timestamp: 1.5, srtEndTime: 2.5, text: "edited line", translation: "translated",
        syllables: [{ text: "edited", time: 1.5 }] },
      { id: "next", timestamp: 2.5, text: "next line" },
    ]);
    expect(useLrcStore.getState().isDirty).toBe(true);

    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
    const lastSaved = useLrcStore.getState().doc;
    expect(lastSaved).not.toBe(savedDocument);
    expect(useLrcStore.getState().isDirty).toBe(false);

    useLrcStore.getState().setMetadata({ title: "Later title" });
    useLrcStore.getState().updateLine("saved", { translation: "later translation" });
    useLrcStore.getState().undo();
    useLrcStore.getState().undo();

    expect(useLrcStore.getState().doc).toBe(lastSaved);
    expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
      timestamp: 1.5, srtEndTime: 2.5, text: "edited line", translation: "translated",
      syllables: [{ text: "edited", time: 1.5 }],
    });
    expect(useLrcStore.getState().doc.metadata.title).toBe("Edited title");
    expect(useLrcStore.getState().isDirty).toBe(false);

    useLrcStore.getState().redo();
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not replace the saved baseline after cancelled or failed Save As", async () => {
    reset([{ id: "saved", timestamp: 1, text: "saved line" }]);
    const savedDocument = useLrcStore.getState().doc;
    useLrcStore.getState().updateLine("saved", { text: "cancelled draft" });
    vi.mocked(save).mockResolvedValueOnce(null);
    await expect(useLrcStore.getState().saveLrcAs("lrc")).resolves.toBe(false);
    expect(useLrcStore.getState().isDirty).toBe(true);
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc).toBe(savedDocument);
    expect(useLrcStore.getState().isDirty).toBe(false);

    useLrcStore.getState().updateLine("saved", { text: "failed draft" });
    vi.mocked(save).mockResolvedValueOnce("/exports/failed.lrc");
    vi.mocked(invoke).mockRejectedValue(new Error("simulated write failure"));
    await expect(useLrcStore.getState().saveLrcAs("lrc")).rejects.toThrow("simulated write failure");
    expect(useLrcStore.getState().isDirty).toBe(true);
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc).toBe(savedDocument);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("tracks a successful Save As LRC snapshot as the new undo-clean point", async () => {
    reset([{ id: "saved", timestamp: 1, text: "original" }]);
    useLrcStore.getState().updateLine("saved", { text: "exported snapshot" });
    vi.mocked(save).mockResolvedValue("/exports/saved.lrc");
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(useLrcStore.getState().saveLrcAs("lrc")).resolves.toBe(true);
    const savedDocument = useLrcStore.getState().doc;
    expect(useLrcStore.getState().lrcPath).toBe("/exports/saved.lrc");
    expect(useLrcStore.getState().isDirty).toBe(false);

    useLrcStore.getState().setMetadata({ title: "later edit" });
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc).toBe(savedDocument);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("uses loaded documents as saved baselines and preserves that baseline across raw edits", async () => {
    reset([]);
    vi.mocked(invoke).mockImplementation((command) => command === "read_lrc_file"
      ? Promise.resolve("[00:01.00]loaded lyric") : Promise.resolve(undefined));

    await useLrcStore.getState().loadLyricsPath("/loaded.lrc");
    const loadedDocument = useLrcStore.getState().doc;
    expect(useLrcStore.getState()._savedDocument).toBe(loadedDocument);
    expect(useLrcStore.getState().isDirty).toBe(false);

    await useLrcStore.getState().loadFromRawText("[00:02.00]raw replacement");
    expect(useLrcStore.getState().isDirty).toBe(true);
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc).toBe(loadedDocument);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("reconciles a successful in-flight save when undo returns to its exact snapshot", async () => {
    reset([{ id: "saved", timestamp: 1, text: "original" }]);
    useLrcStore.setState({ lrcPath: "/working.lrc" });
    useLrcStore.getState().updateLine("saved", { text: "written snapshot" });
    const writtenSnapshot = useLrcStore.getState().doc;
    let finishWrite: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((command) => command === "write_lrc_file"
      ? new Promise<void>((resolve) => { finishWrite = resolve; })
      : Promise.resolve(undefined));

    const savePromise = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    useLrcStore.getState().updateLine("saved", { text: "newer edit" });
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc).toBe(writtenSnapshot);
    expect(useLrcStore.getState().isDirty).toBe(true);

    finishWrite?.();
    await expect(savePromise).resolves.toBe(true);
    expect(useLrcStore.getState().doc).toBe(writtenSnapshot);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("does not apply a completed old save baseline after the document is replaced", async () => {
    reset([{ id: "old", timestamp: 1, text: "old document" }]);
    const oldSavedBaseline = useLrcStore.getState()._savedDocument;
    useLrcStore.setState({ lrcPath: "/old.lrc" });
    useLrcStore.getState().updateLine("old", { text: "old edit" });
    let finishWrite: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((command) => command === "write_lrc_file"
      ? new Promise<void>((resolve) => { finishWrite = resolve; })
      : command === "read_lrc_file" ? Promise.resolve("[00:02.00]new document") : Promise.resolve(undefined));

    const savePromise = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    await useLrcStore.getState().loadFromRawText("[00:03.00]replacement document");
    const replacement = useLrcStore.getState().doc;
    expect(useLrcStore.getState().isDirty).toBe(true);

    finishWrite?.();
    await expect(savePromise).resolves.toBe(true);
    expect(useLrcStore.getState().doc).toBe(replacement);
    expect(useLrcStore.getState()._savedDocument).toBe(oldSavedBaseline);
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("exports rich lyrics to SRT without changing the working document", async () => {
    useLrcStore.setState({ lrcPath: "/working.lrc", lrcBookmark: "working-grant", isDirty: true });
    vi.mocked(save).mockResolvedValue("/exports/lyrics.srt");

    expect(await useLrcStore.getState().saveLrcAs("srt")).toBe(true);

    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/exports/lyrics.srt" }));
    expect(useLrcStore.getState().lrcPath).toBe("/working.lrc");
    expect(useLrcStore.getState().lrcBookmark).toBe("working-grant");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });
});

it.each(['$&', '$$', '$`', "$'", '$1'])('replaces all occurrences with literal dollar text: %s', replacement => {
 reset([{id:'a',timestamp:1,text:'original original'}]);
 useLrcStore.getState().replaceInLines('original',replacement,true);
 expect(lines()[0].text).toBe(`${replacement} ${replacement}`);
 useLrcStore.getState().undo();
 expect(lines()[0].text).toBe('original original');
});
