import { describe, it, expect, beforeEach } from "vitest";

// zustand persist용 최소 localStorage 폴리필 (node 환경)
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

import { useSettingsStore } from "./useSettingsStore";

describe("useSettingsStore — recent files (App Sandbox bookmarks)", () => {
  beforeEach(() => useSettingsStore.setState({ recentFiles: [] }));

  it("ignores an entry with neither path set", () => {
    useSettingsStore.getState().addRecentFile({ lrcPath: null, audioPath: null, lrcBookmark: null, audioBookmark: null });
    expect(useSettingsStore.getState().recentFiles).toEqual([]);
  });

  it("adds an entry to the front, including its bookmarks", () => {
    useSettingsStore.getState().addRecentFile({
      lrcPath: "/a.lrc", audioPath: "/a.mp3", lrcBookmark: "bm-lrc", audioBookmark: "bm-audio",
    });
    const files = useSettingsStore.getState().recentFiles;
    expect(files.length).toBe(1);
    expect(files[0].lrcPath).toBe("/a.lrc");
    expect(files[0].lrcBookmark).toBe("bm-lrc");
    expect(files[0].audioBookmark).toBe("bm-audio");
    expect(typeof files[0].openedAt).toBe("number");
  });

  it("moves a re-opened entry back to the front instead of duplicating it, using the newer bookmark", () => {
    const s = useSettingsStore.getState();
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3", lrcBookmark: "bm-old", audioBookmark: null });
    s.addRecentFile({ lrcPath: "/b.lrc", audioPath: "/b.mp3", lrcBookmark: null, audioBookmark: null });
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3", lrcBookmark: "bm-new", audioBookmark: null });
    const files = useSettingsStore.getState().recentFiles;
    expect(files.length).toBe(2);
    expect(files[0].lrcPath).toBe("/a.lrc");
    expect(files[0].lrcBookmark).toBe("bm-new");
    expect(files[1].lrcPath).toBe("/b.lrc");
  });

  it("treats a different path combination as a distinct entry", () => {
    const s = useSettingsStore.getState();
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: null, lrcBookmark: null, audioBookmark: null });
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3", lrcBookmark: null, audioBookmark: null });
    expect(useSettingsStore.getState().recentFiles.length).toBe(2);
  });

  it("caps the list at 8 entries", () => {
    const s = useSettingsStore.getState();
    for (let i = 0; i < 10; i++) {
      s.addRecentFile({ lrcPath: `/${i}.lrc`, audioPath: null, lrcBookmark: null, audioBookmark: null });
    }
    const files = useSettingsStore.getState().recentFiles;
    expect(files.length).toBe(8);
    expect(files[0].lrcPath).toBe("/9.lrc");
  });

  it("clearRecentFiles empties the list", () => {
    useSettingsStore.getState().addRecentFile({ lrcPath: "/a.lrc", audioPath: null, lrcBookmark: null, audioBookmark: null });
    useSettingsStore.getState().clearRecentFiles();
    expect(useSettingsStore.getState().recentFiles).toEqual([]);
  });
});
