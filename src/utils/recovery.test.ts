import { describe, it, expect, beforeEach } from "vitest";
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
    saveRecoverySnapshot(doc(), "/tmp/song.lrc", "/tmp/song.mp3");
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
