import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LrcDocument } from "../types/lrc";
import { saveRecoverySnapshot, loadRecoverySnapshot, clearRecoverySnapshot } from "./recovery";

// localStorage 최소 폴리필 (node 환경)
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

const KEY = "lyrical-sync-recovery";

const doc = (): LrcDocument => ({
  metadata: { title: "Song", artist: "Artist", album: "", by: "", offset: 0 },
  lines: [{ id: "1", timestamp: 1.5, text: "hello" }],
  extraTags: {},
});

describe("recovery snapshot round-trip", () => {
  beforeEach(() => localStorage.clear());

  it("saves and loads back an equivalent snapshot", () => {
    saveRecoverySnapshot(doc(), "/tmp/song.lrc", "/tmp/song.mp3");
    const loaded = loadRecoverySnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded!.doc).toEqual(doc());
    expect(loaded!.lrcPath).toBe("/tmp/song.lrc");
    expect(loaded!.audioPath).toBe("/tmp/song.mp3");
    expect(typeof loaded!.savedAt).toBe("number");
  });

  it("supports null paths (unsaved new document)", () => {
    saveRecoverySnapshot(doc(), null, null);
    const loaded = loadRecoverySnapshot();
    expect(loaded!.lrcPath).toBeNull();
    expect(loaded!.audioPath).toBeNull();
  });

  it("defaults bookmarks to null when not passed (back-compat with older snapshots)", () => {
    saveRecoverySnapshot(doc(), "/tmp/song.lrc", "/tmp/song.mp3");
    const loaded = loadRecoverySnapshot();
    expect(loaded!.lrcBookmark).toBeNull();
    expect(loaded!.audioBookmark).toBeNull();
  });

  it("persists App Sandbox security-scoped bookmarks when provided", () => {
    saveRecoverySnapshot(doc(), "/tmp/song.lrc", "/tmp/song.mp3", "bm-lrc-base64", "bm-audio-base64");
    const loaded = loadRecoverySnapshot();
    expect(loaded!.lrcBookmark).toBe("bm-lrc-base64");
    expect(loaded!.audioBookmark).toBe("bm-audio-base64");
  });

  it("returns null when nothing has been saved", () => {
    expect(loadRecoverySnapshot()).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(loadRecoverySnapshot()).toBeNull();
  });

  it("returns null when the snapshot shape is structurally invalid", () => {
    localStorage.setItem(KEY, JSON.stringify({ doc: { lines: "not-an-array" } }));
    expect(loadRecoverySnapshot()).toBeNull();
  });

  it("clearRecoverySnapshot removes the snapshot", () => {
    saveRecoverySnapshot(doc(), "/tmp/song.lrc", "/tmp/song.mp3", "bm-lrc", "bm-audio");
    clearRecoverySnapshot();
    expect(loadRecoverySnapshot()).toBeNull();
  });

  it("saveRecoverySnapshot swallows storage errors instead of throwing", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    try {
      expect(() => saveRecoverySnapshot(doc(), null, null)).not.toThrow();
    } finally {
      localStorage.setItem = original;
    }
  });

  it("clearRecoverySnapshot swallows storage errors instead of throwing", () => {
    const original = localStorage.removeItem;
    localStorage.removeItem = () => { throw new Error("boom"); };
    try {
      expect(() => clearRecoverySnapshot()).not.toThrow();
    } finally {
      localStorage.removeItem = original;
    }
  });
});

it.each(["metadata", "timestamp", "syllable", "extraTags", "bookmark", "savedAt"])("rejects malformed %s values", (field) => {
  const snapshot: any = { doc: doc(), lrcPath: null, audioPath: null, savedAt: 1 };
  if (field === "metadata") snapshot.doc.metadata.offset = "bad";
  if (field === "timestamp") snapshot.doc.lines[0].timestamp = "bad";
  if (field === "syllable") snapshot.doc.lines[0].syllables = [{ text: "x", time: "bad" }];
  if (field === "extraTags") snapshot.doc.extraTags = { invalid: 3 };
  if (field === "bookmark") snapshot.lrcBookmark = 3;
  if (field === "savedAt") snapshot.savedAt = "bad";
  localStorage.setItem(KEY, JSON.stringify(snapshot));
  expect(loadRecoverySnapshot()).toBeNull();
});
it("loads a legacy snapshot without bookmark fields", () => {
  localStorage.setItem(KEY, JSON.stringify({ doc: doc(), lrcPath: null, audioPath: null, savedAt: 1 }));
  expect(loadRecoverySnapshot()?.lrcBookmark).toBeNull();
});
it("cannot discard a newer session with an old snapshot", () => {
  saveRecoverySnapshot(doc(), null, null, null, null, "old");
  const old = loadRecoverySnapshot()!;
  saveRecoverySnapshot(doc(), null, null, null, null, "new");
  clearRecoverySnapshot(old);
  expect(loadRecoverySnapshot()?.sessionId).toBe("new");
});

it("restores rich document data from stored bytes after recreating the module", async () => {
  const rich = doc();
  rich.extraTags = { language: "ko" };
  rich.lines[0].syllables = [{ text: "hello", time: 1.5 }, { text: " ", time: null }];
  expect(saveRecoverySnapshot(rich, "/a.lrc", null, "grant", null, "restart")).toBe(true);
  expect(JSON.parse(localStorage.getItem(KEY)!).doc).toEqual(rich);
  vi.resetModules();
  const recreated = await import("./recovery");
  expect(recreated.loadRecoverySnapshot()?.doc).toEqual(rich);
  expect(recreated.loadRecoverySnapshot()?.lrcBookmark).toBe("grant");
});
it("rejects non-finite values before JSON can silently convert them to null", () => {
  const invalid = doc(); invalid.lines[0].timestamp = Infinity;
  expect(saveRecoverySnapshot(invalid, null, null)).toBe(false);
  localStorage.setItem(KEY, '{"doc":{"metadata":{"title":"","artist":"","album":"","by":"","offset":1e999},"lines":[],"extraTags":{}},"lrcPath":null,"audioPath":null,"savedAt":1}');
  expect(loadRecoverySnapshot()).toBeNull();
});
