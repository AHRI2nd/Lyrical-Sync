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
    key: (index: number) => Array.from(m.keys())[index] ?? null,
    get length() { return m.size; },
  } as Storage;
}

const KEY = "lyrical-sync-recovery";

const doc = (): LrcDocument => ({
  metadata: { title: "Song", artist: "Artist", album: "", by: "", offset: 0 },
  lines: [{ id: "1", timestamp: 1.5, text: "hello" }],
  extraTags: {},
});

beforeEach(() => localStorage.clear());

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

  it("persists repeated metadata order in a recovery snapshot", () => {
    const repeated = { ...doc(), metadataTagSequence: [
      { key: "ar", value: "Earlier" }, { key: "ar", value: "Artist" },
    ] };
    expect(saveRecoverySnapshot(repeated, "/tmp/song.lrc", null)).toBe(true);
    expect(loadRecoverySnapshot()?.doc.metadataTagSequence).toEqual(repeated.metadataTagSequence);
  });

  it("rejects malformed repeated-metadata recovery data", () => {
    const malformed = { ...doc(), metadataTagSequence: [{ key: "ar", value: 4 }] };
    expect(saveRecoverySnapshot(malformed as unknown as LrcDocument, "/tmp/song.lrc", null)).toBe(false);
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
it.each([
  { timestamp: 1, srtEndTime: 0.5 },
  { timestamp: 1, srtEndTime: Number.NaN },
  { timestamp: 1, srtEndTime: "2" },
  { timestamp: 1, srtEndTime: 1 },
  { timestamp: null, srtEndTime: 2 },
])("rejects an invalid recovered SRT end without deleting the snapshot: %j", (timing) => {
  const invalid = doc();
  Object.assign(invalid.lines[0], timing);
  const raw = JSON.stringify({ doc: invalid, lrcPath: "/song.srt", audioPath: null, savedAt: 1 });
  localStorage.setItem(KEY, raw);

  expect(loadRecoverySnapshot()).toBeNull();
  expect(localStorage.getItem(KEY)).toBe(raw);
});
it("rejects an SRT end when its cue start is missing without deleting the snapshot", () => {
  const invalid = doc();
  invalid.lines[0].srtEndTime = 2;
  delete (invalid.lines[0] as Partial<typeof invalid.lines[number]>).timestamp;
  const raw = JSON.stringify({ doc: invalid, lrcPath: "/song.srt", audioPath: null, savedAt: 1 });
  localStorage.setItem(KEY, raw);

  expect(loadRecoverySnapshot()).toBeNull();
  expect(localStorage.getItem(KEY)).toBe(raw);
});
it("accepts a valid recovered SRT end and legacy lines without one", () => {
  const valid = doc();
  valid.lines[0].srtEndTime = 2;
  localStorage.setItem(KEY, JSON.stringify({ doc: valid, lrcPath: "/song.srt", audioPath: null, savedAt: 1 }));

  expect(loadRecoverySnapshot()?.doc.lines[0].srtEndTime).toBe(2);
});
it("does not replace an existing snapshot with an invalid SRT end", () => {
  expect(saveRecoverySnapshot(doc(), "/old.srt", null)).toBe(true);
  const existing = localStorage.getItem(KEY);
  const invalid = doc();
  invalid.lines[0].srtEndTime = Number.POSITIVE_INFINITY;

  expect(saveRecoverySnapshot(invalid, "/new.srt", null)).toBe(false);
  expect(localStorage.getItem(KEY)).toBe(existing);
});
it("rejects recovered timed text that differs from the visible lyric and retains the snapshot", () => {
  const invalid = doc();
  invalid.lines[0].syllables = [{ text: "other", time: 1.5 }];
  const raw = JSON.stringify({ doc: invalid, lrcPath: "/song.lrc", audioPath: null, savedAt: 1 });
  localStorage.setItem(KEY, raw);

  expect(loadRecoverySnapshot()).toBeNull();
  expect(localStorage.getItem(KEY)).toBe(raw);
});
it("does not replace an existing snapshot with mismatched timed text", () => {
  expect(saveRecoverySnapshot(doc(), "/old.lrc", null)).toBe(true);
  const existing = localStorage.getItem(KEY);
  const invalid = doc();
  invalid.lines[0].syllables = [{ text: "other", time: 1.5 }];

  expect(saveRecoverySnapshot(invalid, "/new.lrc", null)).toBe(false);
  expect(localStorage.getItem(KEY)).toBe(existing);
});
it.each([
  { text: "hello", syllables: [{ text: "hel", time: 1 }, { text: "lo", time: null }] },
  { text: "", syllables: [] },
  { text: "ordinary", syllables: undefined },
])("accepts a recovery line when timed token text matches or is absent: %j", ({ text, syllables }) => {
  const valid = doc();
  valid.lines[0].text = text;
  if (syllables !== undefined) valid.lines[0].syllables = syllables;
  const raw = JSON.stringify({ doc: valid, lrcPath: "/song.lrc", audioPath: null, savedAt: 1 });
  localStorage.setItem(KEY, raw);

  expect(loadRecoverySnapshot()?.doc.lines[0]).toMatchObject({ text });
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
  rich.lines[0].text = "hello ";
  rich.lines[0].syllables = [{ text: "hello", time: 1.5 }, { text: " ", time: null }];
  expect(saveRecoverySnapshot(rich, "/a.lrc", null, "grant", null, "restart")).toBe(true);
  expect(JSON.parse(localStorage.getItem(`${KEY}:session:restart`)!).doc).toEqual(rich);
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


it.each([[null], [12], [{}], [[]]])("rejects malformed translation values %s", (translation) => {
  const invalid = doc();
  (invalid.lines[0] as any).translation = translation;
  expect(saveRecoverySnapshot(invalid, null, null)).toBe(false);
  localStorage.setItem(KEY, JSON.stringify({ doc: invalid, lrcPath: null, audioPath: null, savedAt: 1 }));
  expect(loadRecoverySnapshot()).toBeNull();
});
it.each(["translated", ""])("retains optional translation strings %s in recovery", (translation) => {
  const rich = doc();
  (rich.lines[0] as any).translation = translation;
  expect(saveRecoverySnapshot(rich, null, null)).toBe(true);
  expect(loadRecoverySnapshot()?.doc.lines[0]).toHaveProperty("translation", translation);
});

it("does not delete another session's newer recovery snapshot during cleanup", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  const first = { ...doc(), lines: [{ id: "first", timestamp: null, text: "first session" }] };
  saveRecoverySnapshot(first, null, null, null, null, "session-a");
  const stale = loadRecoverySnapshot()!;

  vi.setSystemTime(new Date("2026-11-12T10:00:05Z"));
  const originalRemove = localStorage.removeItem.bind(localStorage);
  let interposed = false;
  localStorage.removeItem = (key: string) => {
    if (!interposed) {
      interposed = true;
      const second = { ...doc(), lines: [{ id: "second", timestamp: null, text: "second session" }] };
      saveRecoverySnapshot(second, null, null, null, null, "session-b");
    }
    originalRemove(key);
  };
  try {
    expect(clearRecoverySnapshot(stale)).toBe(true);
  } finally {
    localStorage.removeItem = originalRemove;
    vi.useRealTimers();
  }

  expect(interposed).toBe(true);
  expect(loadRecoverySnapshot()?.doc.lines[0].text).toBe("second session");
});

it("clears recovery snapshots from every session after privacy opt-out", () => {
  saveRecoverySnapshot(doc(), null, null, null, null, "session-a");
  saveRecoverySnapshot(doc(), null, null, null, null, "session-b");

  expect(clearRecoverySnapshot()).toBe(true);
  expect(loadRecoverySnapshot()).toBeNull();
});
