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
import { useSettingsStore } from "./useSettingsStore";
import type { LrcLine, LrcDocument } from "../types/lrc";
import { saveRecoverySnapshot, loadRecoverySnapshot, clearRecoverySnapshot } from "../utils/recovery";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { serializeLrc } from "../utils/lrcParser";
import { assertSrtDocumentLossless } from "../utils/srtConverter";
import { setDocumentConfirmation } from "../utils/documentTransition";
import { useToastStore } from "./useToastStore";
import { useI18nStore } from "./useI18nStore";

const reset = (lines: LrcLine[], offset = 0) =>
  useLrcStore.setState({
    doc: { metadata: { title: "", artist: "", album: "", by: "", offset }, lines, extraTags: {} },
    _lrcFileHash: "a".repeat(64),
    _history: [],
    _future: [],
    _manualMetadataFields: new Set(),
    _lastEditKey: null,
    currentTime: 0,
    activeLineId: null,
    isDirty: false,
  });

const lines = () => useLrcStore.getState().doc.lines;
const lrcSnapshot = (content: string) => ({ content, sha256: "b".repeat(64) });

describe("useLrcStore — line actions", () => {
  beforeEach(() => reset([]));

  it("ignores a lyric picker result after another document replaces its owner", async () => {
    let resolvePicker!: (path: string | null) => void;
    vi.mocked(open).mockImplementation(() => new Promise((resolve) => { resolvePicker = resolve; }));
    vi.mocked(invoke).mockResolvedValue({ content: "[00:01.00]stale", sha256: "a".repeat(64) });

    const opening = useLrcStore.getState().openLrc();
    await Promise.resolve();
    useLrcStore.getState().loadFromRawText("[00:03.00]new document");
    resolvePicker("/tmp/stale.lrc");
    await opening;

    expect(invoke).not.toHaveBeenCalledWith("read_lrc_file_with_hash", { path: "/tmp/stale.lrc" });
    expect(lines().map((line) => line.text)).toEqual(["new document"]);
  });

  it("addLine appends a line", () => {
    useLrcStore.getState().addLine("hello");
    expect(lines().map((l) => l.text)).toEqual(["hello"]);
  });

  it("updateLine patches a field", () => {
    reset([{ id: "1", timestamp: null, text: "a" }]);
    useLrcStore.getState().updateLine("1", { text: "b" });
    expect(lines()[0].text).toBe("b");
  });

  it("preserves leading glyph delay when restamping an enhanced line", () => {
    reset([{ id: "1", timestamp: 1, text: "ab", syllables: [
      { text: "a", time: 1.2 }, { text: "b", time: 1.5 },
    ] }]);
    useLrcStore.setState({ currentTime: 2 });

    useLrcStore.getState().stampCurrentLine("1");

    expect(lines()[0].timestamp).toBe(2);
    expect(lines()[0].syllables?.map(({ time }) => time)).toEqual([2.2, 2.5]);
  });

  it("drops timed tokens when edited text no longer matches what save serializes", () => {
    reset([{ id: "1", timestamp: 10, text: "old", syllables: [{ text: "old", time: 10 }] }]);
    useLrcStore.getState().updateLine("1", { text: "new" });

    expect(lines()[0].text).toBe("new");
    expect(lines()[0].syllables).toBeUndefined();
    expect(serializeLrc(useLrcStore.getState().doc).trim()).toBe("[00:10.00]new");
  });

  it("drops stale untimed tokens after ordinary text entry", () => {
    reset([{ id: "1", timestamp: 10, text: "old", syllables: [{ text: "old", time: null }] }]);
    useLrcStore.getState().updateLine("1", { text: "new" });

    expect(lines()[0].text).toBe("new");
    expect(lines()[0].syllables).toBeUndefined();
  });

  it("updateLine is undoable — first keystroke pushes history", () => {
    reset([{ id: "1", timestamp: null, text: "a" }]);
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().updateLine("1", { text: "ab" });
    expect(useLrcStore.getState()._history.length).toBe(h0 + 1);
    useLrcStore.getState().undo();
    expect(lines()[0].text).toBe("a");
  });

  it("updateLine coalesces consecutive edits to the same field into one undo step", () => {
    reset([{ id: "1", timestamp: null, text: "a" }]);
    useLrcStore.getState().updateLine("1", { text: "ab" });
    useLrcStore.getState().updateLine("1", { text: "abc" });
    useLrcStore.getState().updateLine("1", { text: "abcd" });
    expect(useLrcStore.getState()._history.length).toBe(1);
    useLrcStore.getState().undo();
    expect(lines()[0].text).toBe("a");
  });

  it("updateLine starts a new undo step after an intervening action", () => {
    reset([{ id: "1", timestamp: null, text: "a" }, { id: "2", timestamp: null, text: "x" }]);
    useLrcStore.getState().updateLine("1", { text: "ab" });
    useLrcStore.getState().addLine("new");
    useLrcStore.getState().updateLine("1", { text: "abc" });
    expect(useLrcStore.getState()._history.length).toBe(3); // editText, addLine, editText
    useLrcStore.getState().undo();
    expect(lines().find((l) => l.id === "1")?.text).toBe("ab"); // only the second edit undone
  });

  it("updateLine starts a new undo step when switching fields on the same line", () => {
    reset([{ id: "1", timestamp: 1, text: "a", translation: "x" }]);
    useLrcStore.getState().updateLine("1", { text: "ab" });
    useLrcStore.getState().updateLine("1", { translation: "y" });
    expect(useLrcStore.getState()._history.length).toBe(2);
  });

  it("setMetadata is undoable and coalesces consecutive edits to the same fields", () => {
    reset([]);
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().setMetadata({ title: "T" });
    useLrcStore.getState().setMetadata({ title: "Ti" });
    useLrcStore.getState().setMetadata({ title: "Tit" });
    expect(useLrcStore.getState()._history.length).toBe(h0 + 1);
    expect(useLrcStore.getState().doc.metadata.title).toBe("Tit");
    useLrcStore.getState().undo();
    expect(useLrcStore.getState().doc.metadata.title).toBe("");
  });

  it("setMetadata(silent) never pushes history or marks dirty", () => {
    reset([]);
    useLrcStore.setState({ isDirty: false });
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().setMetadata({ artist: "A" }, true);
    expect(useLrcStore.getState()._history.length).toBe(h0);
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(useLrcStore.getState().doc.metadata.artist).toBe("A");
    const unchanged = useLrcStore.getState().doc;
    useLrcStore.getState().setMetadata({ artist: "A" }, true);
    expect(useLrcStore.getState().doc).toBe(unchanged);
  });

  it("keeps manually edited metadata fields from being overwritten by automatic track sync", () => {
    reset([]);
    useLrcStore.getState().setMetadata({ title: "My title" });
    useLrcStore.getState().setMetadata({ title: "Track title", artist: "Track artist" }, true);
    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "My title", artist: "Track artist" });
    useLrcStore.getState().newLrc();
    useLrcStore.getState().setMetadata({ title: "Next track" }, true);
    expect(useLrcStore.getState().doc.metadata.title).toBe("Next track");
  });

  it("fills only untouched empty fields from audio tags and marks the document dirty", () => {
    reset([]);
    useLrcStore.getState().setMetadata({ title: "Previously set" });
    useLrcStore.getState().setMetadata({ title: "" });
    useLrcStore.setState({ isDirty: false });

    useLrcStore.getState().setAudioMetadata({ title: "Tag title", artist: "Tag artist" });

    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "", artist: "Tag artist" });
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not add audio-tag metadata to an SRT working document", () => {
    reset([{ id: "srt-line", timestamp: 1, srtEndTime: 2, text: "Cue" }]);
    useLrcStore.setState({ lrcPath: "/tmp/current.srt", isDirty: false });

    useLrcStore.getState().setAudioMetadata({ title: "Tagged title", artist: "Tagged artist" });

    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "", artist: "", album: "" });
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(() => assertSrtDocumentLossless(useLrcStore.getState().doc)).not.toThrow();
  });

  it("tracks document revisions for user edits and undo but excludes silent metadata sync", () => {
    reset([{ id: "1", timestamp: 1, text: "a" }]);
    const initial = useLrcStore.getState()._editRevision;
    useLrcStore.getState().setMetadata({ title: "Edited" });
    expect(useLrcStore.getState()._editRevision).toBe(initial + 1);
    useLrcStore.getState().setMetadata({ artist: "Silent" }, true);
    expect(useLrcStore.getState()._editRevision).toBe(initial + 1);
    useLrcStore.getState().undo();
    expect(useLrcStore.getState()._editRevision).toBe(initial + 2);
  });

  it("requires confirmation before applying fetched lyrics to dirty content", async () => {
    reset([{ id: "1", timestamp: 1, text: "Unsaved lyric" }]);
    useLrcStore.setState({ isDirty: true });
    const before = useLrcStore.getState();
    const confirm = vi.fn(async () => "cancel" as const);
    const unregister = setDocumentConfirmation(confirm);
    const result = await useLrcStore.getState().requestApplyFetchedLyrics(
      "[00:02.00]Fetched lyric", { title: "Fetched" , artist: "Artist", album: "Album" }, before._documentSession,
    );
    unregister();
    expect(confirm).toHaveBeenCalledOnce();
    expect(result).toBe("cancelled");
    expect(useLrcStore.getState().doc).toBe(before.doc);
    expect(useLrcStore.getState()._history).toBe(before._history);
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("reports a failed save before declining fetched-lyrics replacement", async () => {
    reset([{ id: "1", timestamp: 1, text: "Unsaved lyric" }]);
    useLrcStore.setState({ isDirty: true, lrcPath: "/tmp/current.lrc" });
    useToastStore.setState({ toasts: [] });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk write failed"));
    const ownerSession = useLrcStore.getState()._documentSession;
    const unregister = setDocumentConfirmation(async () => "save");

    const result = await useLrcStore.getState().requestApplyFetchedLyrics(
      "[00:02.00]Fetched lyric", undefined, ownerSession,
    );
    unregister();

    expect(result).toBe("cancelled");
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Unsaved lyric");
    expect(useLrcStore.getState().isDirty).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe(useI18nStore.getState().t.toast.saveFailed);
  });

  it("applies fetched lyrics and their metadata only after discard", async () => {
    reset([{ id: "1", timestamp: 1, text: "Unsaved lyric" }]);
    useLrcStore.setState({ isDirty: true, lrcPath: "/tmp/old.lrc" });
    useLrcStore.getState().setMetadata({ title: "Existing title" });
    const before = useLrcStore.getState();
    const unregister = setDocumentConfirmation(async () => "discard");
    const result = await useLrcStore.getState().requestApplyFetchedLyrics(
      "[00:02.00]Fetched lyric", { title: "Fetched", artist: "Artist", album: "Album" }, before._documentSession,
    );
    unregister();
    expect(result).toBe("applied");
    expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["Fetched lyric"]);
    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "Fetched", artist: "Artist", album: "Album", offset: 0 });
    expect(useLrcStore.getState().lrcPath).toBeNull();
    expect(useLrcStore.getState()._history).toEqual([]);
    expect(useLrcStore.getState()._documentSession).toBeGreaterThan(before._documentSession);
  });

  it("uses fetched lyric offset and metadata instead of carrying the previous document forward", async () => {
    reset([{ id: "1", timestamp: 1, text: "Existing lyric" }], 2500);
    useLrcStore.setState({
      doc: {
        ...useLrcStore.getState().doc,
        metadata: { ...useLrcStore.getState().doc.metadata, title: "Previous", artist: "Old artist", album: "Old album" },
      },
    });
    const ownerSession = useLrcStore.getState()._documentSession;

    const result = await useLrcStore.getState().requestApplyFetchedLyrics(
      "[offset:-1000]\n[ti:From fetch]\n[00:03.00]Fetched lyric",
      { title: "From fetch", artist: "New artist", album: "New album" },
      ownerSession,
    );

    expect(result).toBe("applied");
    expect(useLrcStore.getState().doc.metadata).toMatchObject({
      title: "From fetch", artist: "New artist", album: "New album", offset: -1000,
    });
  });

  it("rechecks authorization after edits and rejects a result from an older document session", async () => {
    reset([{ id: "1", timestamp: 1, text: "Original" }]);
    useLrcStore.setState({ isDirty: true });
    const ownerSession = useLrcStore.getState()._documentSession;
    const confirm = vi.fn()
      .mockImplementationOnce(async () => {
        useLrcStore.getState().updateLine("1", { text: "Edited while waiting" });
        return "discard" as const;
      })
      .mockResolvedValueOnce("cancel" as const);
    const unregister = setDocumentConfirmation(confirm);
    const result = await useLrcStore.getState().requestApplyFetchedLyrics(
      "[00:02.00]Fetched", undefined, ownerSession,
    );
    unregister();
    expect(result).toBe("cancelled");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Edited while waiting");

    const stale = await useLrcStore.getState().requestApplyFetchedLyrics("[00:03.00]Stale", undefined, ownerSession);
    expect(stale).toBe("cancelled");
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Edited while waiting");
  });

  it("does not restart confirmation for silent metadata synchronization", async () => {
    reset([{ id: "1", timestamp: 1, text: "Original" }]);
    useLrcStore.setState({ isDirty: true });
    const ownerSession = useLrcStore.getState()._documentSession;
    const confirmation: { resolve?: (choice: "save" | "discard" | "cancel") => void } = {};
    const confirm = vi.fn(() => new Promise<"save" | "discard" | "cancel">((resolve) => { confirmation.resolve = resolve; }));
    const unregister = setDocumentConfirmation(confirm);
    const pending = useLrcStore.getState().requestApplyFetchedLyrics("[00:02.00]Fetched", undefined, ownerSession);
    useLrcStore.getState().setMetadata({ artist: "Automatic" }, true);
    confirmation.resolve?.("discard");
    expect(await pending).toBe("applied");
    expect(confirm).toHaveBeenCalledOnce();
    expect(useLrcStore.getState().doc.metadata.artist).toBe("Automatic");
    unregister();
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

  it("applyOffset shifts imported SRT cue ends with their starts", () => {
    reset([{ id: "1", timestamp: 10, srtEndTime: 12, text: "a" }], 500);
    useLrcStore.getState().applyOffset();
    expect(lines()[0].timestamp).toBe(10.5);
    expect(lines()[0].srtEndTime).toBe(12.5);
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

  it("does not record timing actions that leave all selected timing data unchanged", () => {
    const noOpActions = [
      () => useLrcStore.getState().shiftTimeRange(0, 0, 1),
      () => useLrcStore.getState().shiftLines(["untimed"], 1),
      () => useLrcStore.getState().scaleTimestamps(2),
      () => useLrcStore.getState().clearTimestamps(["untimed"]),
    ];
    for (const action of noOpActions) {
      reset([{ id: "untimed", timestamp: null, text: "lyric" }]);
      const original = useLrcStore.getState().doc;

      action();

      expect(useLrcStore.getState().doc).toBe(original);
      expect(useLrcStore.getState()._history).toHaveLength(0);
      expect(useLrcStore.getState().isDirty).toBe(false);
    }
  });

  it("rejects a shift that would collapse an SRT cue at zero without changing the document", () => {
    reset([{ id: "1", timestamp: 1, srtEndTime: 2, text: "cue" }]);
    const original = useLrcStore.getState().doc;

    useLrcStore.getState().shiftLines(["1"], -3);

    expect(useLrcStore.getState().doc).toBe(original);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("shifts SRT cue ends with selected line starts", () => {
    reset([
      { id: "1", timestamp: 10, srtEndTime: 12, text: "a" },
      { id: "2", timestamp: 20, srtEndTime: 22, text: "b" },
    ]);
    useLrcStore.getState().shiftLines(["1"], 0.5);
    expect(lines().map((line) => [line.timestamp, line.srtEndTime])).toEqual([[10.5, 12.5], [20, 22]]);
  });

  it("scales and clears imported SRT cue ends with their starts", () => {
    reset([{ id: "1", timestamp: 10, srtEndTime: 12, text: "a" }]);
    useLrcStore.getState().scaleTimestamps(2);
    expect([lines()[0].timestamp, lines()[0].srtEndTime]).toEqual([20, 24]);
    useLrcStore.getState().clearTimestamps(["1"]);
    expect(lines()[0].srtEndTime).toBeUndefined();
  });

  it("leaves the document and history untouched when scaling would overflow", () => {
    reset([{ id: "1", timestamp: Number.MAX_VALUE, text: "a" }]);
    useLrcStore.getState().scaleTimestamps(2);
    expect(lines()[0].timestamp).toBe(Number.MAX_VALUE);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("rejects a retime whose dependent cue end would overflow", () => {
    reset([{ id: "1", timestamp: 0, srtEndTime: Number.MAX_VALUE, text: "a" }]);
    useLrcStore.getState().updateLine("1", { timestamp: Number.MAX_VALUE });
    expect([lines()[0].timestamp, lines()[0].srtEndTime]).toEqual([0, Number.MAX_VALUE]);
    expect(useLrcStore.getState()._history).toHaveLength(0);
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
  it("commits a very large syllable list without overflowing the call stack", () => {
    const syllables = Array.from({ length: 200_000 }, (_, index) => ({ text: "x", time: index / 1000 }));
    reset([{ id: "large", timestamp: 0, text: "x".repeat(syllables.length) }]);
    expect(() => useLrcStore.getState().commitSyllables("large", syllables)).not.toThrow();
    expect(lines()[0].timestamp).toBe(0);
    expect(lines()[0].syllables).toHaveLength(200_000);
  });

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

  it("rejects an overflowing SRT retime without changing history or cancelling AI", () => {
    reset([{ id: "1", timestamp: -Number.MAX_VALUE, srtEndTime: -Number.MAX_VALUE / 2, text: "a" }]);
    useLrcStore.getState().addLine("temporary");
    useLrcStore.getState().undo();
    useLrcStore.setState({ aiSyncStatus: "running" });
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    const before = useLrcStore.getState();

    useLrcStore.getState().commitSyllables("1", [{ text: "a", time: Number.MAX_VALUE }]);

    const after = useLrcStore.getState();
    expect(after.doc).toBe(before.doc);
    expect(after._history).toBe(before._history);
    expect(after._future).toBe(before._future);
    expect(after.aiSyncStatus).toBe("running");
    expect(invoke).not.toHaveBeenCalledWith("cancel_alignment", expect.anything());
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

  it("restores a valid active line and clamps glyph selection when undo removes the selected row", () => {
    reset([{ id: "1", timestamp: 5, text: "helloworld" }]);
    useLrcStore.setState({ activeLineId: "1", loopLineId: "missing", activeSyllableIndex: 40 });
    useLrcStore.getState().splitLine("1", 5);

    useLrcStore.getState().undo();

    expect(useLrcStore.getState().activeLineId).toBe("1");
    expect(useLrcStore.getState().loopLineId).toBeNull();
    expect(useLrcStore.getState().activeSyllableIndex).toBe(0);
  });

  it("history entries are labeled by the action that produced them", () => {
    reset([]);
    useLrcStore.getState().addLine("x");
    const history = useLrcStore.getState()._history;
    expect(history[history.length - 1]?.label).toBe("addLine");
  });

  it("jumpToHistory(index) is a no-op when index === current position", () => {
    reset([]);
    useLrcStore.getState().addLine("x");
    const before = useLrcStore.getState().doc;
    useLrcStore.getState().jumpToHistory(useLrcStore.getState()._history.length);
    expect(useLrcStore.getState().doc).toBe(before);
  });

  it("jumpToHistory can jump back multiple steps at once, and forward again", () => {
    reset([]);
    useLrcStore.getState().addLine("a");
    useLrcStore.getState().addLine("b");
    useLrcStore.getState().addLine("c");
    expect(lines()).toHaveLength(3);

    useLrcStore.getState().jumpToHistory(0); // back to the very start
    expect(lines()).toHaveLength(0);
    expect(useLrcStore.getState()._future).toHaveLength(3);

    useLrcStore.getState().jumpToHistory(2); // forward two steps
    expect(lines()).toHaveLength(2);
    expect(useLrcStore.getState()._history).toHaveLength(2);
    expect(useLrcStore.getState()._future).toHaveLength(1);

    // still redoable after a jump (not a dead end)
    useLrcStore.getState().redo();
    expect(lines()).toHaveLength(3);
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

  it("loadFromRawText replaces the document", () => {
    reset([{ id: "9", timestamp: null, text: "old" }]);
    useLrcStore.getState().loadFromRawText("[00:01.00]hello");
    expect(lines()[0].text).toBe("hello");
    expect(lines()[0].timestamp).toBe(1);
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

  it("duplicateLine keeps the translation while clearing timing", () => {
    reset([{ ...mk("1", "a", 1), translation: "번역" }]);
    useLrcStore.getState().duplicateLine("1");
    expect(lines()[1]).toMatchObject({ timestamp: null, text: "a", translation: "번역" });
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

  it("mergeLineUp keeps the later SRT cue end when combining overlapping rows", () => {
    reset([
      { id: "1", timestamp: 1, srtEndTime: 4, text: "first" },
      { id: "2", timestamp: 2, srtEndTime: 5, text: "second" },
    ]);

    useLrcStore.getState().mergeLineUp("2");

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ timestamp: 1, srtEndTime: 5, text: "first second" });
  });

  it("mergeLineUp combines translations instead of discarding the lower line", () => {
    reset([
      { ...mk("1", "hello", 1), translation: "안녕" },
      { ...mk("2", "world", 2), translation: "세계" },
    ]);
    useLrcStore.getState().mergeLineUp("2");
    expect(lines()[0].translation).toBe("안녕\n세계");
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

  it("splitLine divides a translated line at the explicitly chosen translation boundary", () => {
    reset([{ ...mk("1", "helloworld", 5), translation: "안녕 세계" }]);
    const nid = useLrcStore.getState().splitLine("1", 5, { first: "안녕", second: "세계" });
    expect(lines().map((l) => [l.text, l.translation])).toEqual([
      ["hello", "안녕"],
      ["world", "세계"],
    ]);
    expect(lines()[1].id).toBe(nid);
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

  it("snapLinesToBeatGrid snaps only selected timestamps to the nearest beat", () => {
    // 120 BPM = 0.5s 주기, offset 0 → 0.24 -> 0, 1.76 -> 2.0
    reset([mk("1", "a", 0.24), mk("2", "b", 1.76), mk("3", "c", 3)]);
    useLrcStore.getState().snapLinesToBeatGrid(["1", "2"], 120, 0);
    expect(lines().map((l) => l.timestamp)).toEqual([0, 2, 3]);
  });

  it("snapLinesToBeatGrid affects every timestamped line when ids is empty", () => {
    reset([mk("1", "a", 0.24), mk("2", "b", null)]);
    useLrcStore.getState().snapLinesToBeatGrid([], 120, 0);
    expect(lines().map((l) => l.timestamp)).toEqual([0, null]);
  });

  it("snapLinesToBeatGrid shifts syllables on lines that actually move, records no history if nothing moves", () => {
    reset([{ id: "1", timestamp: 0, text: "ab", syllables: [{ text: "a", time: 0 }] }]);
    const h0 = useLrcStore.getState()._history.length;
    useLrcStore.getState().snapLinesToBeatGrid(["1"], 120, 0); // already on-grid → no-op
    expect(useLrcStore.getState()._history.length).toBe(h0);
    expect(lines()[0].syllables).toBeDefined();

    useLrcStore.getState().snapLinesToBeatGrid(["1"], 100, 0.1); // now actually moves
    expect(useLrcStore.getState()._history.length).toBe(h0 + 1);
    expect(lines()[0].syllables).toEqual([{ text: "a", time: 0.1 }]);
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

  it("restoreDoc loads doc, marks dirty, reassigns ids", () => {
    reset([]);
    useLrcStore.getState().restoreDoc(mkDoc(), "/p.lrc", "/a.mp3");
    const st = useLrcStore.getState();
    expect(st.doc.lines[0].text).toBe("hi");
    expect(st.lrcPath).toBe("/p.lrc");
    expect(st.audioPath).toBe("/a.mp3");
    expect(st.isDirty).toBe(true);
    // IDs are reassigned using session-based generator (format: "sessionId:localCounter")
    expect(st.doc.lines[0].id).not.toBe("x");
    expect(st.doc.lines[0].id).toMatch(/^\d+:\d+$/);
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

  it("newLrc/loadFromRawText/restoreDoc reset loopLineId", () => {
    useLrcStore.getState().setLoopLine("1");
    useLrcStore.getState().newLrc();
    expect(useLrcStore.getState().loopLineId).toBeNull();
  });
});

describe("useLrcStore — runAiSync blank-line timestamp placement", () => {
  beforeEach(() => {
    reset([]);
    vi.mocked(invoke).mockReset();
  });

  it("places blank lines via prevEnd+offset/nextStart clamp, including a run of consecutive blanks and a trailing unbounded blank", async () => {
    reset([
      { id: "b0", timestamp: null, text: "" }, // 정렬 결과 이전 → prevEnd 기본값 0
      { id: "l1", timestamp: null, text: "hello" },
      { id: "b1", timestamp: null, text: "" }, // 연속 빈 줄 구간 시작
      { id: "b2", timestamp: null, text: "" }, // 연속 빈 줄 구간 — 앞뒤 스캔이 더 멀리 가야 하는 경우
      { id: "l2", timestamp: null, text: "world" },
      { id: "b3", timestamp: null, text: "" }, // 정렬 결과 이후 → nextStart 없음(클램프 안 됨)
    ]);
    useLrcStore.setState({ audioPath: "/song.mp3" });

    const results = [
      { index: 1, start: 1.0, end: 1.5, confidence: 0.9 },
      { index: 4, start: 3.0, end: 3.5, confidence: 0.9 },
    ];
    vi.mocked(invoke).mockImplementation((cmd: unknown) => {
      if (cmd === "run_alignment") {
        return Promise.resolve(JSON.stringify({ lines: results, vocal_segments: [], separated: false }));
      }
      return Promise.resolve(undefined);
    });

    await useLrcStore.getState().runAiSync("ko", 0.5, false, false);

    expect(lines().map((l) => l.timestamp)).toEqual([0.5, 1.0, 2.0, 2.0, 3.0, 4.0]);
    expect(useLrcStore.getState().aiSyncStatus).toBe("done");
  });

  it("does not report a successful alignment when the document contains only blank lines", async () => {
    reset([
      { id: "blank-1", timestamp: null, text: "   " },
      { id: "blank-2", timestamp: null, text: "" },
    ]);
    useLrcStore.setState({ audioPath: "/song.mp3" });
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({
      lines: [],
      vocal_segments: [],
      separated: false,
    }));

    await useLrcStore.getState().runAiSync("ko", 0.5, false, false);

    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "run_alignment")).toBe(false);
    expect(lines().map((line) => line.timestamp)).toEqual([null, null]);
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().aiSyncStatus).toBe("error");
  });

  it("does not apply a completed result after the user starts a new document", async () => {
    reset([{ id: "old", timestamp: null, text: "old lyric" }]);
    useLrcStore.setState({ audioPath: "/song.mp3" });
    let resolveAlignment!: (value: string) => void;
    vi.mocked(invoke).mockImplementation((cmd: unknown) => {
      if (cmd === "run_alignment") return new Promise<string>((resolve) => { resolveAlignment = resolve; });
      return Promise.resolve(undefined);
    });

    const running = useLrcStore.getState().runAiSync("ko", 0.5, false, false);
    await Promise.resolve();
    useLrcStore.getState().newLrc();
    resolveAlignment(JSON.stringify({ lines: [{ index: 0, start: 12, end: 13, confidence: 1 }], vocal_segments: [], separated: false }));
    await running;

    expect(lines()).toEqual([]);
    expect(useLrcStore.getState().aiSyncStatus).toBe("idle");
    expect(useLrcStore.getState().aiDraftConfidence).toBeNull();
  });

  it("rejects non-finite AI alignment timestamps before changing the document", async () => {
    reset([{ id: "line", timestamp: null, text: "hello" }]);
    useLrcStore.setState({ audioPath: "/song.mp3" });
    vi.mocked(invoke).mockResolvedValueOnce(
      '{"lines":[{"index":0,"start":1e400,"end":2,"confidence":0.9}],"vocal_segments":[],"separated":false}',
    );

    await useLrcStore.getState().runAiSync("ko", 0.5, false, false);

    expect(lines()[0].timestamp).toBeNull();
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().aiSyncStatus).toBe("error");
  });

  it("does not leak a rejected progress-listener cleanup", async () => {
    reset([{ id: "line", timestamp: null, text: "hello" }]);
    useLrcStore.setState({ audioPath: "/song.mp3" });
    const cleanupError = new Error("listener cleanup failed");
    const onUnhandled = vi.fn();
    const cleanup = () => Promise.reject(cleanupError);
    vi.mocked(listen).mockResolvedValueOnce(cleanup as never);
    vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({
      lines: [{ index: 0, start: 1, end: 2, confidence: 0.9 }],
      vocal_segments: [],
      separated: false,
    }));
    const nodeProcess = (globalThis as unknown as {
      process: {
        on: (event: "unhandledRejection", handler: (reason: unknown, promise: Promise<unknown>) => void) => void;
        off: (event: "unhandledRejection", handler: (reason: unknown, promise: Promise<unknown>) => void) => void;
      };
    }).process;
    nodeProcess.on("unhandledRejection", onUnhandled);

    try {
      await useLrcStore.getState().runAiSync("ko", 0.5, false, false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandled);
    }

    expect(useLrcStore.getState().aiSyncStatus).toBe("done");
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it("does not cancel AI alignment for an untimed range shift", async () => {
    reset([{ id: "untimed", timestamp: null, text: "hello" }]);
    useLrcStore.setState({ audioPath: "/song.mp3" });
    let resolveAlignment!: (value: string) => void;
    vi.mocked(invoke).mockImplementation((command: unknown) => {
      if (command === "run_alignment") return new Promise<string>((resolve) => { resolveAlignment = resolve; });
      return Promise.resolve(undefined);
    });
    const running = useLrcStore.getState().runAiSync("ko", 0.5, false, false);
    await vi.waitFor(() => expect(resolveAlignment).toBeTypeOf("function"));

    useLrcStore.getState().shiftTimeRange(0, 0, 1);
    resolveAlignment(JSON.stringify({ lines: [{ index: 0, start: 4, end: 5, confidence: 0.9 }], vocal_segments: [], separated: false }));
    await running;

    expect(useLrcStore.getState().aiSyncStatus).toBe("done");
    expect(lines()[0].timestamp).toBe(4);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("cancel_alignment", expect.anything());
  });

  it("keeps audio-tag metadata from invalidating an in-flight alignment", async () => {
    reset([{ id: "line", timestamp: null, text: "hello" }]);
    useLrcStore.setState({ audioPath: "/song.mp3" });
    let resolveAlignment!: (value: string) => void;
    vi.mocked(invoke).mockImplementation((command: unknown) => {
      if (command === "run_alignment") return new Promise<string>((resolve) => { resolveAlignment = resolve; });
      return Promise.resolve(undefined);
    });

    const running = useLrcStore.getState().runAiSync("ko", 0.5, false, false);
    await vi.waitFor(() => expect(resolveAlignment).toBeTypeOf("function"));
    useLrcStore.getState().setAudioMetadata({ title: "Tag title", artist: "Tag artist" });
    resolveAlignment(JSON.stringify({
      lines: [{ index: 0, start: 4, end: 5, confidence: 0.9 }],
      vocal_segments: [],
      separated: false,
    }));
    await running;

    expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "Tag title", artist: "Tag artist" });
    expect(lines()[0].timestamp).toBe(4);
    expect(useLrcStore.getState().aiSyncStatus).toBe("done");
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("cancel_alignment", expect.anything());
  });
});

describe("useLrcStore — save completion races", () => {
  beforeEach(() => {
    reset([{ id: "1", timestamp: 1, text: "before save" }]);
    vi.mocked(invoke).mockReset();
    useLrcStore.setState({ lrcPath: "/tmp/song.lrc", isDirty: true });
  });

  it("keeps the document dirty when the source file changed outside the app", async () => {
    vi.mocked(invoke).mockRejectedValue("LYRICS_FILE_CHANGED");

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("LYRICS_FILE_CHANGED");

    expect(invoke).toHaveBeenCalledWith("write_lrc_file_if_unchanged", expect.objectContaining({
      path: "/tmp/song.lrc",
      expectedSha256: "a".repeat(64),
    }));
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.lrc");
    expect(useLrcStore.getState()._lrcFileHash).toBe("a".repeat(64));
  });

  it("saves an SRT working file after its translation has been cleared", async () => {
    useLrcStore.setState({
      doc: {
        metadata: { title: "", artist: "", album: "", by: "", offset: 0 },
        lines: [{ id: "1", timestamp: 1, text: "lyric", translation: "" }],
        extraTags: {},
      },
      lrcPath: "/tmp/song.srt",
      _lrcFileHash: "a".repeat(64),
      isDirty: true,
    });
    vi.mocked(invoke).mockResolvedValue("b".repeat(64));

    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("write_lrc_file_if_unchanged", expect.objectContaining({
      path: "/tmp/song.srt",
      content: expect.stringContaining("\nlyric\n"),
    }));
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("refuses an in-place recovery save when no original file revision is available", async () => {
    useLrcStore.setState({ _lrcFileHash: null });

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("LYRICS_FILE_CHANGED");
    expect(invoke).not.toHaveBeenCalled();
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("keeps edits made during a pending save dirty", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const saving = useLrcStore.getState().saveLrc();
    await Promise.resolve();
    useLrcStore.getState().updateLine("1", { text: "edited while saving" });
    // Save is aborted due to revision change
    const result = await saving;
    expect(result).toBe(false);

    expect(lines()[0].text).toBe("edited while saving");
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
  });

  it("keeps a silent metadata update dirty after an older in-flight save and allows the latest snapshot to save", async () => {
    let finishFirstWrite!: () => void;
    const dispatched: string[] = [];
    vi.mocked(invoke).mockImplementation((command: unknown, args?: unknown) => {
      if (command !== "write_lrc_file_if_unchanged") return Promise.resolve(undefined);
      dispatched.push((args as { content: string }).content);
      if (dispatched.length === 1) {
        return new Promise<void>((resolve) => { finishFirstWrite = resolve; });
      }
      return Promise.resolve(undefined);
    });

    const revision = useLrcStore.getState()._editRevision;
    const pending = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));

    // Device/Spotify metadata sync does not create an undo entry or a user edit revision.
    useLrcStore.getState().setMetadata({ artist: "Automatic artist" }, true);
    expect(useLrcStore.getState()._editRevision).toBe(revision);
    expect(useLrcStore.getState().doc.metadata.artist).toBe("Automatic artist");

    finishFirstWrite();
    await expect(pending).resolves.toBe(true);
    expect(dispatched[0]).not.toContain("Automatic artist");
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(useLrcStore.getState()._editRevision).toBeGreaterThan(revision);

    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toContain("Automatic artist");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("leaves a changed document dirty if a stale save fails, while a normal save still clears dirty", async () => {
    let rejectFirstWrite!: (error: Error) => void;
    const dispatched: string[] = [];
    vi.mocked(invoke).mockImplementation((command: unknown, args?: unknown) => {
      if (command !== "write_lrc_file_if_unchanged") return Promise.resolve(undefined);
      dispatched.push((args as { content: string }).content);
      if (dispatched.length === 1) {
        return new Promise<void>((_resolve, reject) => { rejectFirstWrite = reject; });
      }
      return Promise.resolve(undefined);
    });

    const revision = useLrcStore.getState()._editRevision;
    const pending = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    useLrcStore.getState().setMetadata({ album: "New album" }, true);
    rejectFirstWrite(new Error("temporary unavailable drive"));
    await expect(pending).resolves.toBe(false);
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(useLrcStore.getState()._editRevision).toBeGreaterThan(revision);

    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
    expect(dispatched[1]).toContain("New album");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("skips a queued write of a snapshot invalidated by silent metadata sync", async () => {
    let finishFirstWrite!: () => void;
    const dispatched: string[] = [];
    vi.mocked(invoke).mockImplementation((command: unknown, args?: unknown) => {
      if (command !== "write_lrc_file_if_unchanged") return Promise.resolve(undefined);
      dispatched.push((args as { content: string }).content);
      if (dispatched.length === 1) {
        return new Promise<void>((resolve) => { finishFirstWrite = resolve; });
      }
      return Promise.resolve(undefined);
    });

    const originalSave = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    useLrcStore.getState().setMetadata({ artist: "Latest artist" }, true);
    const queuedSave = useLrcStore.getState().saveLrc();
    finishFirstWrite();

    await expect(originalSave).resolves.toBe(true);
    await expect(queuedSave).resolves.toBe(false);
    expect(dispatched).toHaveLength(1);
    expect(useLrcStore.getState().isDirty).toBe(true);

    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toContain("Latest artist");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("starts a new undo group after a successful save of the same edit revision", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useLrcStore.getState().updateLine("1", { text: "saved revision" });
    await useLrcStore.getState().saveLrc();
    useLrcStore.getState().updateLine("1", { text: "later revision" });

    useLrcStore.getState().undo();

    expect(lines()[0].text).toBe("saved revision");
    expect(useLrcStore.getState().isDirty).toBe(false);
    useLrcStore.getState().redo();
    expect(lines()[0].text).toBe("later revision");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not close the undo group after a failed save", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("write failed"));
    useLrcStore.getState().updateLine("1", { text: "first edit" });
    // saveLrc returns false on failure instead of throwing
    const result = await useLrcStore.getState().saveLrc();
    expect(result).toBe(false);
    useLrcStore.getState().updateLine("1", { text: "second edit" });

    useLrcStore.getState().undo();

    expect(lines()[0].text).toBe("before save");
  });

  it("does not close a newer undo group when an older save finishes after an edit", async () => {
    let resolveWrite!: () => void;
    vi.mocked(invoke).mockImplementation(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    useLrcStore.getState().updateLine("1", { text: "saving" });
    const saving = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(resolveWrite).toBeTypeOf("function"));
    useLrcStore.getState().updateLine("1", { text: "edited during save" });
    // Save completes because write was already started before edit
    resolveWrite();
    const result = await saving;
    expect(result).toBe(true);
    useLrcStore.getState().updateLine("1", { text: "continued edit" });

    useLrcStore.getState().undo();

    expect(lines()[0].text).toBe("before save");
  });

  it("serializes overlapping saves to the same document so older content cannot finish last", async () => {
    const writes: { content: string; resolve: () => void }[] = [];
    let persistedContent = "";
    vi.mocked(invoke).mockImplementation((_command: unknown, args?: unknown) =>
      new Promise<undefined>((resolve) => {
        const content = (args as { content: string }).content;
        writes.push({
          content,
          resolve: () => {
            persistedContent = content;
            resolve(undefined);
          },
        });
      }),
    );

    const firstSave = useLrcStore.getState().saveLrc();
    await Promise.resolve();
    useLrcStore.getState().updateLine("1", { text: "latest text" });
    const secondSave = useLrcStore.getState().saveLrc();
    await Promise.resolve();

    // First save is stale (revision changed), returns false without writing
    // Second save writes latest text
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0].resolve();
    await Promise.all([firstSave, secondSave]);

    // First save returns false, second returns true
    expect(await firstSave).toBe(false);
    expect(await secondSave).toBe(true);
    expect(persistedContent).toContain("latest text");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("skips a queued regular save after another document takes ownership of the path", async () => {
    let releaseFirst!: () => void;
    const firstWritePending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writtenContents: string[] = [];
    vi.mocked(invoke).mockImplementation(async (command: unknown, args?: unknown) => {
      if (command === "write_lrc_file_if_unchanged") {
        writtenContents.push((args as { content: string }).content);
        if (writtenContents.length === 1) await firstWritePending;
        return undefined;
      }
      if (command === "read_lrc_file_with_hash") return { content: "[ti:next song]\n[00:03.00]next document", sha256: "b".repeat(64) };
      return undefined;
    });

    const firstSave = useLrcStore.getState().saveLrc();
    await vi.waitFor(() => expect(writtenContents).toHaveLength(1));
    useLrcStore.getState().updateLine("1", { text: "queued old document" });
    const queuedSave = useLrcStore.getState().saveLrc();

    await useLrcStore.getState().loadLyricsPath("/tmp/song.lrc");
    const newLineId = useLrcStore.getState().doc.lines[0]?.id;
    if (newLineId) useLrcStore.getState().updateLine(newLineId, { text: "edited next document" });
    releaseFirst();

    await expect(firstSave).resolves.toBe(true);
    await expect(queuedSave).resolves.toBe(false);
    expect(writtenContents).toHaveLength(1);
    expect(lines()[0].text).toBe("edited next document");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("returns to clean when undo restores the last saved document", () => {
    const savedDoc = { ...useLrcStore.getState().doc, lines: [{ id: "1", timestamp: 1, text: "saved" }] };
    useLrcStore.setState({ doc: savedDoc, _savedDocument: savedDoc, isDirty: false, lrcPath: "/tmp/song.lrc" });

    useLrcStore.getState().updateLine("1", { text: "edited" });
    expect(useLrcStore.getState().isDirty).toBe(true);
    useLrcStore.getState().undo();

    expect(useLrcStore.getState().doc).toBe(savedDoc);
    expect(useLrcStore.getState().isDirty).toBe(false);
    useLrcStore.getState().redo();
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not let an old save clear the dirty state of a newly loaded document", async () => {
    let resolveWrite!: (value: undefined) => void;
    vi.mocked(invoke).mockImplementation((command: unknown) => {
      if (command === "write_lrc_file_if_unchanged") {
        return new Promise<undefined>((resolve) => { resolveWrite = resolve; });
      }
      if (command === "read_lrc_file_with_hash") return Promise.resolve({ content: "[ti:new song]\n[00:03.00]new text", sha256: "b".repeat(64) });
      return Promise.resolve(undefined);
    });

    const saving = useLrcStore.getState().saveLrc();
    await Promise.resolve();
    await useLrcStore.getState().loadLyricsPath("/tmp/new-song.lrc");
    const newLineId2 = useLrcStore.getState().doc.lines[0]?.id;
    if (newLineId2) useLrcStore.getState().updateLine(newLineId2, { text: "new text edited" });
    await vi.waitFor(() => expect(resolveWrite).toBeTypeOf("function"));
    resolveWrite(undefined);
    await saving;

    expect(useLrcStore.getState().lrcPath).toBe("/tmp/new-song.lrc");
    expect(lines()[0].text).toBe("new text edited");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not assign Save As path to a different document opened while the dialog is pending", async () => {
    let resolveDialog!: (path: string | null) => void;
    vi.mocked(save).mockImplementation(() => new Promise((resolve) => { resolveDialog = resolve; }));
    vi.mocked(invoke).mockResolvedValue(undefined);

    const saving = useLrcStore.getState().saveLrcAs("lrc");
    await Promise.resolve();
    useLrcStore.getState().newLrc(); // New session, revision reset
    useLrcStore.getState().addLine("new document");
    resolveDialog("/tmp/old-document.lrc");
    await saving;

    // Save As is stale (different session), returns false
    expect(await saving).toBe(false);
    expect(useLrcStore.getState().lrcPath).toBeNull();
    expect(lines()[0].text).toBe("new document");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not write an old Save As snapshot to a path selected by a different document", async () => {
    let resolveDialog!: (path: string | null) => void;
    vi.mocked(save).mockImplementation(() => new Promise((resolve) => { resolveDialog = resolve; }));
    vi.mocked(invoke).mockImplementation((command: unknown) => {
      if (command === "read_lrc_file_with_hash") return Promise.resolve({ content: "[00:03.00]new document", sha256: "b".repeat(64) });
      return Promise.resolve(undefined);
    });

    const saving = useLrcStore.getState().saveLrcAs("lrc");
    await Promise.resolve();
    await useLrcStore.getState().loadLyricsPath("/tmp/new-song.lrc");
    const newLineId3 = useLrcStore.getState().doc.lines[0]?.id;
    if (newLineId3) useLrcStore.getState().updateLine(newLineId3, { text: "new document" });
    resolveDialog("/tmp/new-song.lrc");

    expect(await saving).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/new-song.lrc");
    expect(lines()[0].text).toBe("new document");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("keeps same-document edits dirty after Save As while adopting the selected path", async () => {
    vi.mocked(save).mockResolvedValue("/tmp/saved.lrc");
    vi.mocked(invoke).mockResolvedValue(undefined);

    const saving = useLrcStore.getState().saveLrcAs("lrc");
    await Promise.resolve();
    useLrcStore.getState().updateLine("1", { text: "edited during Save As" });
    await saving;

    // With revision tracking, save is aborted if document changes during Save As
    // Path is not adopted, dirty remains
    expect(await saving).toBe(false);
    expect(useLrcStore.getState().lrcPath).not.toBe("/tmp/saved.lrc");
    expect(lines()[0].text).toBe("edited during Save As");
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
  });

  it("uses the loaded-file revision when Save As selects the current working path", async () => {
    vi.mocked(save).mockResolvedValue("/tmp/song.lrc");
    vi.mocked(invoke).mockRejectedValue("LYRICS_FILE_CHANGED");

    await expect(useLrcStore.getState().saveLrcAs("lrc")).rejects.toThrow("LYRICS_FILE_CHANGED");

    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({
      path: "/tmp/song.lrc",
      sourcePath: "/tmp/song.lrc",
      expectedSha256: "a".repeat(64),
    }));
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("does not let a pending Save As overwrite a newer same-path save", async () => {
    let resolveDialog!: (path: string | null) => void;
    vi.mocked(save).mockImplementation(() => new Promise((resolve) => { resolveDialog = resolve; }));
    vi.mocked(invoke).mockResolvedValue("c".repeat(64));

    const saveAs = useLrcStore.getState().saveLrcAs("lrc");
    useLrcStore.getState().updateLine("1", { text: "newer saved revision" });
    await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
    expect(useLrcStore.getState().isDirty).toBe(false);

    resolveDialog("/tmp/song.lrc");
    await expect(saveAs).resolves.toBe(false);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("write_lrc_file_if_unchanged", expect.objectContaining({
      path: "/tmp/song.lrc",
      content: expect.stringContaining("newer saved revision"),
    }));
    expect(lines()[0].text).toBe("newer saved revision");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("keeps SRT Save As as an export and preserves the active LRC state", async () => {
    useLrcStore.setState({ doc: { ...useLrcStore.getState().doc, metadata: { ...useLrcStore.getState().doc.metadata, title: "Rich title" }, lines: [{ id: "1", timestamp: 1, text: "lyrics", syllables: [{ text: "lyrics", time: 1 }] }] }, lrcPath: "/tmp/source.lrc", isDirty: true });
    vi.mocked(save).mockResolvedValue("/tmp/export.srt");
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(useLrcStore.getState().saveLrcAs("srt")).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/tmp/export.srt" }));
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/source.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects a Save As path whose extension does not match the selected format", async () => {
    vi.mocked(save).mockResolvedValue("/tmp/song.srt");
    vi.mocked(invoke).mockResolvedValue(undefined);
    useLrcStore.setState({ lrcPath: null, isDirty: true });

    await expect(useLrcStore.getState().saveLrcAs("lrc")).rejects.toThrow("SAVE_FORMAT_EXTENSION_MISMATCH");

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBeNull();
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("adds a new LRC Save As destination to recent files", async () => {
    useSettingsStore.setState({ recentFiles: [] });
    vi.mocked(save).mockResolvedValue("/tmp/new-song.lrc");
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(useLrcStore.getState().saveLrcAs("lrc")).resolves.toBe(true);

    expect(useSettingsStore.getState().recentFiles[0]).toMatchObject({ lrcPath: "/tmp/new-song.lrc" });
  });

  it("refuses to overwrite an SRT source when the document has LRC-only content", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, metadata: { ...state.doc.metadata, title: "LRC title" }, lines: [{ id: "1", timestamp: 1, text: "lyrics", syllables: [{ text: "lyrics", time: 1 }] }] },
      lrcPath: "/tmp/song.srt", isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "SRT_LOSSY_DOCUMENT" });
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.srt");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects an unrepresentable SRT save before file I/O and keeps the document dirty", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "first\n\nsecond" }] },
      lrcPath: "/tmp/song.srt",
      isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("SRT cannot preserve blank paragraph rows");

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.srt");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects an SRT cue with a terminal line break before writing", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "first\n" }] },
      lrcPath: "/tmp/song.srt",
      isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "SRT_UNREPRESENTABLE_CONTENT" });

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.srt");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects an unrepresentable SRT Save As without changing the working path", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "first\n\nsecond" }] },
      lrcPath: "/tmp/original.lrc",
      isDirty: true,
    });
    vi.mocked(save).mockResolvedValue("/tmp/export.srt");

    await expect(useLrcStore.getState().saveLrcAs("srt")).rejects.toThrow("SRT cannot preserve blank paragraph rows");

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/original.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects a VTT Save As that cannot represent blank paragraph rows before writing", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "first\n\nsecond" }] },
      lrcPath: "/tmp/original.lrc",
      isDirty: true,
    });
    vi.mocked(save).mockResolvedValue("/tmp/export.vtt");

    await expect(useLrcStore.getState().saveLrcAs("vtt")).rejects.toMatchObject({ code: "VTT_UNREPRESENTABLE_CONTENT" });

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/original.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects unrepresentable ASS text before writing and keeps the document dirty", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "literal {override}" }] },
      lrcPath: "/tmp/song.ass",
      isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toMatchObject({ code: "ASS_UNREPRESENTABLE_CONTENT" });

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.ass");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects unrepresentable ASS Save As before writing and keeps the original path", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "literal \\N" }] },
      lrcPath: "/tmp/original.lrc",
      isDirty: true,
    });
    vi.mocked(save).mockResolvedValue("/tmp/export.ass");

    await expect(useLrcStore.getState().saveLrcAs("ass")).rejects.toMatchObject({ code: "ASS_UNREPRESENTABLE_CONTENT" });

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/original.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("rejects a reserved LRC extension tag collision without dispatching a write", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: {
        ...state.doc,
        lines: [{ id: "1", timestamp: 1, text: "literal <00:02.00>" }],
        extraTags: { "x-lyrical-inline-escape": "existing value" },
      },
      lrcPath: "/tmp/song.lrc",
      isDirty: true,
    });

    await expect(useLrcStore.getState().saveLrc()).rejects.toThrow("x-lyrical-inline-escape tag is reserved");

    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("escapes VTT text on Save As without changing the active LRC document", async () => {
    const state = useLrcStore.getState();
    useLrcStore.setState({
      doc: { ...state.doc, lines: [{ id: "1", timestamp: 1, text: "A <b>bold</b> &amp; B" }] },
      lrcPath: "/tmp/song.lrc",
      isDirty: true,
    });
    vi.mocked(save).mockResolvedValue("/tmp/song.vtt");
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(useLrcStore.getState().saveLrcAs("vtt")).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({
      path: "/tmp/song.vtt",
      content: expect.stringContaining("A &lt;b&gt;bold&lt;/b&gt; &amp;amp; B"),
    }));
    expect(useLrcStore.getState().lrcPath).toBe("/tmp/song.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });
});

describe("useLrcStore — concurrent lyric loads", () => {
  beforeEach(() => {
    reset([{ id: "existing", timestamp: 1, text: "existing" }]);
    useLrcStore.setState({ lrcPath: null });
    vi.mocked(invoke).mockReset();
  });

  it("keeps the latest selected file when reads resolve out of order", async () => {
    let resolveOld!: (value: ReturnType<typeof lrcSnapshot>) => void;
    let resolveNew!: (value: ReturnType<typeof lrcSnapshot>) => void;
    vi.mocked(invoke).mockImplementation((_command: unknown, args?: unknown) => {
      const path = (args as { path: string }).path;
      return new Promise<ReturnType<typeof lrcSnapshot>>((resolve) => {
        if (path === "/tmp/old.lrc") resolveOld = resolve;
        else resolveNew = resolve;
      });
    });

    const oldLoad = useLrcStore.getState().loadLyricsPath("/tmp/old.lrc");
    const newLoad = useLrcStore.getState().loadLyricsPath("/tmp/new.lrc");
    resolveNew(lrcSnapshot("[00:02.00]new selection"));
    await newLoad;
    resolveOld(lrcSnapshot("[00:01.00]old selection"));
    await oldLoad;

    expect(useLrcStore.getState().lrcPath).toBe("/tmp/new.lrc");
    expect(lines().map((line) => line.text)).toEqual(["new selection"]);
  });

  it("does not apply an older pending file after the newest selected file fails", async () => {
    let resolveOld!: (value: ReturnType<typeof lrcSnapshot>) => void;
    vi.mocked(invoke).mockImplementation((_command: unknown, args?: unknown) => {
      const path = (args as { path: string }).path;
      if (path === "/tmp/old.lrc") return new Promise<ReturnType<typeof lrcSnapshot>>((resolve) => { resolveOld = resolve; });
      return Promise.reject(new Error("read failed"));
    });

    const oldLoad = useLrcStore.getState().loadLyricsPath("/tmp/old.lrc");
    await expect(useLrcStore.getState().loadLyricsPath("/tmp/newest.lrc")).rejects.toThrow("read failed");
    resolveOld(lrcSnapshot("[00:01.00]stale selection"));
    await oldLoad;

    expect(useLrcStore.getState().lrcPath).toBeNull();
    expect(lines().map((line) => line.text)).toEqual(["existing"]);
  });
});

describe("useLrcStore — audio changes during alignment", () => {
  beforeEach(() => {
    reset([{ id: "1", timestamp: null, text: "lyrics" }]);
    vi.mocked(invoke).mockReset();
    useLrcStore.setState({ audioPath: "/tmp/first.mp3" });
  });

  it("discards alignment results started for the previously selected audio", async () => {
    let resolveAlignment!: (value: string) => void;
    vi.mocked(invoke).mockImplementation((command: unknown) => {
      if (command === "run_alignment") return new Promise<string>((resolve) => { resolveAlignment = resolve; });
      return Promise.resolve(undefined);
    });

    const running = useLrcStore.getState().runAiSync("ko", 1, false, false);
    await Promise.resolve();
    await Promise.resolve();
    useLrcStore.getState().setAudioPath("/tmp/second.mp3");
    resolveAlignment(JSON.stringify({
      lines: [{ index: 0, start: 10, end: 11, confidence: 0.99 }],
      vocal_segments: [],
      separated: false,
    }));
    await running;

    expect(useLrcStore.getState().audioPath).toBe("/tmp/second.mp3");
    expect(lines()[0].timestamp).toBeNull();
    expect(useLrcStore.getState().aiSyncStatus).toBe("idle");
    expect(useLrcStore.getState().aiDraftConfidence).toBeNull();
    expect(useLrcStore.getState()._history).toHaveLength(0);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });
});


describe("useLrcStore — document load transactions", () => {
  beforeEach(() => {
    reset([{ id: "1", text: "original", timestamp: 1 }]);
    useLrcStore.setState({ lrcPath: "/old.lrc", audioPath: "/old.mp3" });
    vi.mocked(invoke).mockReset();
  });
  it("preserves loaded metadata during silent track sync while filling blank fields", async () => {
    vi.mocked(invoke).mockResolvedValue(lrcSnapshot("[ti:Saved title]\n[00:01.00]text"));
    await useLrcStore.getState().loadLyricsPath("/tmp/saved.lrc");
    useLrcStore.getState().setMetadata({ title: "Different track", artist: "Track artist" }, true);

    expect(useLrcStore.getState().doc.metadata.title).toBe("Saved title");
    expect(useLrcStore.getState().doc.metadata.artist).toBe("Track artist");
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });
  it("preserves edits and undo history made while the read is pending", async () => {
    let finish!: (value: ReturnType<typeof lrcSnapshot>) => void;
    vi.mocked(invoke).mockImplementation(() => new Promise<ReturnType<typeof lrcSnapshot>>(resolve => { finish = resolve; }));
    const loading = useLrcStore.getState().loadLyricsPath("/new.lrc");
    useLrcStore.getState().updateLine("1", { text: "new edit" });
    const history = useLrcStore.getState()._history;
    finish(lrcSnapshot("[00:02.00]incoming"));
    await expect(loading).rejects.toThrow("document_changed_during_load");
    expect(lines()[0].text).toBe("new edit");
    expect(useLrcStore.getState()._history).toBe(history);
    expect(useLrcStore.getState().isDirty).toBe(true);
    useLrcStore.getState().undo();
    expect(lines()[0].text).toBe("original");
  });
  it.each(["audio tags", "silent service"] as const)("does not cancel a pending lyric load for %s metadata from the old document", async (source) => {
    let finish!: (value: ReturnType<typeof lrcSnapshot>) => void;
    vi.mocked(invoke).mockImplementation(() => new Promise<ReturnType<typeof lrcSnapshot>>(resolve => { finish = resolve; }));
    const loading = useLrcStore.getState().loadLyricsPath("/new.lrc");
    if (source === "audio tags") {
      useLrcStore.getState().setAudioMetadata({ title: "Old track metadata" });
    } else {
      useLrcStore.getState().setMetadata({ title: "Old track metadata" }, true);
    }
    finish(lrcSnapshot("[ti:Incoming title]\n[00:02.00]incoming lyrics"));

    await expect(loading).resolves.toBeUndefined();
    expect(useLrcStore.getState().lrcPath).toBe("/new.lrc");
    expect(useLrcStore.getState().doc.metadata.title).toBe("Incoming title");
    expect(lines().map((line) => line.text)).toEqual(["incoming lyrics"]);
  });
  it("does not replace either member of a pair when lyrics cannot be read", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("unreadable"));
    await expect(useLrcStore.getState().loadLyricsPath("/new.lrc", { audioPath: "/new.mp3" })).rejects.toThrow("unreadable");
    expect(useLrcStore.getState().audioPath).toBe("/old.mp3");
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
  });
  it("publishes the new lyrics and audio in one store transition", async () => {
    vi.mocked(invoke).mockResolvedValue(lrcSnapshot("[00:02.00]incoming"));
    const observed: string[] = [];
    const unsubscribe = useLrcStore.subscribe(s => {
      if (s.audioPath === "/new.mp3") observed.push(s.doc.lines[0]?.text);
    });
    await useLrcStore.getState().loadLyricsPath("/new.lrc", { audioPath: "/new.mp3" });
    unsubscribe();
    expect(useLrcStore.getState().audioPath).toBe("/new.mp3");
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(text => text === "incoming")).toBe(true);
  });
  it("does not overwrite an audio selection made after a paired load starts", async () => {
    let finish!: (value: { content: string; sha256: string }) => void;
    vi.mocked(invoke).mockImplementation(command => command === "read_lrc_file_with_hash"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(undefined));
    const loading = useLrcStore.getState().loadLyricsPath("/new.lrc", { audioPath: "/new.mp3" });
    useLrcStore.getState().setAudioPath("/chosen.mp3");
    finish({ content: "[00:02.00]incoming", sha256: "b".repeat(64) });
    await expect(loading).rejects.toThrow("document_changed_during_load");
    expect(useLrcStore.getState().audioPath).toBe("/chosen.mp3");
    expect(lines()[0].text).toBe("original");
  });
});


it("does not launch a cancelled AI request after delayed listener registration", async () => {
  reset([{ id: "1", text: "lyrics", timestamp: null }]);
  useLrcStore.setState({ audioPath: "/song.mp3" });
  vi.mocked(invoke).mockReset(); vi.mocked(invoke).mockResolvedValue(undefined);
  let register!: (fn: () => void) => void;
  vi.mocked(listen).mockImplementationOnce(() => new Promise(resolve => { register = resolve; }));
  const running = useLrcStore.getState().runAiSync("ko", 0.5, false, false);
  useLrcStore.getState().cancelAiSync();
  register(() => {});
  await running;
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "run_alignment")).toBe(false);
  expect(useLrcStore.getState().aiSyncStatus).toBe("idle");
});

it.each(['$&', '$$', '$`', "$'", '$1'])('replaces all occurrences with literal dollar text: %s', replacement => {
 reset([{id:'a',timestamp:1,text:'original original'}]);
 useLrcStore.getState().replaceInLines('original',replacement,true);
 expect(lines()[0].text).toBe(`${replacement} ${replacement}`);
 useLrcStore.getState().undo();
 expect(lines()[0].text).toBe('original original');
});
