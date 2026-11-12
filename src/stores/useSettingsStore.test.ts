import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMemoryLocalStorage } from "../test/memoryLocalStorage";

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

describe("playback mode ownership", () => {
  it("provides one atomic mode selector that clears competing modes", () => {
    const setPlaybackMode = (useSettingsStore.getState() as unknown as { setPlaybackMode?: (mode: string) => void }).setPlaybackMode;
    expect(setPlaybackMode).toBeTypeOf("function");
    setPlaybackMode!("youtube");
    expect(useSettingsStore.getState()).toMatchObject({ spotifyMode: false, youtubeMode: true, deviceMode: false });
  });

  it("keeps legacy mode setters mutually exclusive when enabling a mode", () => {
    useSettingsStore.getState().setSpotifyMode(true);
    useSettingsStore.getState().setDeviceMode(true);
    expect(useSettingsStore.getState()).toMatchObject({ spotifyMode: false, youtubeMode: false, deviceMode: true });
  });
});

describe("useSettingsStore — recent files", () => {
  beforeEach(() => useSettingsStore.setState({ recentFiles: [] }));

  it("ignores an entry with neither path set", () => {
    useSettingsStore.getState().addRecentFile({ lrcPath: null, audioPath: null });
    expect(useSettingsStore.getState().recentFiles).toEqual([]);
  });

  it("adds an entry to the front", () => {
    useSettingsStore.getState().addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3" });
    const files = useSettingsStore.getState().recentFiles;
    expect(files.length).toBe(1);
    expect(files[0].lrcPath).toBe("/a.lrc");
    expect(files[0].audioPath).toBe("/a.mp3");
    expect(typeof files[0].openedAt).toBe("number");
  });

  it("moves a re-opened entry back to the front instead of duplicating it", () => {
    const s = useSettingsStore.getState();
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3" });
    s.addRecentFile({ lrcPath: "/b.lrc", audioPath: "/b.mp3" });
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3" });
    const files = useSettingsStore.getState().recentFiles;
    expect(files.length).toBe(2);
    expect(files[0].lrcPath).toBe("/a.lrc");
    expect(files[1].lrcPath).toBe("/b.lrc");
  });

  it("treats a different path combination as a distinct entry", () => {
    const s = useSettingsStore.getState();
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: null });
    s.addRecentFile({ lrcPath: "/a.lrc", audioPath: "/a.mp3" });
    expect(useSettingsStore.getState().recentFiles.length).toBe(2);
  });

  it("caps the list at 8 entries", () => {
    const s = useSettingsStore.getState();
    for (let i = 0; i < 10; i++) s.addRecentFile({ lrcPath: `/${i}.lrc`, audioPath: null });
    const files = useSettingsStore.getState().recentFiles;
    expect(files.length).toBe(8);
    expect(files[0].lrcPath).toBe("/9.lrc");
  });

  it("clearRecentFiles empties the list", () => {
    useSettingsStore.getState().addRecentFile({ lrcPath: "/a.lrc", audioPath: null });
    useSettingsStore.getState().clearRecentFiles();
    expect(useSettingsStore.getState().recentFiles).toEqual([]);
  });
});

describe("useSettingsStore — persisted writes are debounced", () => {
  it("collapses rapid successive set() calls (e.g. a slider drag) into a single localStorage write", () => {
    const { storage, restore } = installMemoryLocalStorage();
    const originalSetItem = storage.setItem.bind(storage);
    const setItemSpy = vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      originalSetItem(key, value);
    });
    vi.useFakeTimers();
    try {
      useSettingsStore.getState().setUiScale(1.1);
      useSettingsStore.getState().setUiScale(1.2);
      useSettingsStore.getState().setUiScale(1.3);

      // Zustand state updates remain immediate while persistence waits for the debounce.
      expect(useSettingsStore.getState().uiScale).toBe(1.3);
      expect(setItemSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(299);
      expect(setItemSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      const written = setItemSpy.mock.calls[0][1];
      expect(JSON.parse(written).state.uiScale).toBe(1.3);
      expect(JSON.parse(storage.getItem("lyrical-sync-settings") ?? "{}").state.uiScale).toBe(1.3);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      restore();
    }
  });
});

describe("yt-dlp proxy credential policy", () => {
  it("does not retain an authenticated proxy when set directly", () => {
    useSettingsStore.getState().setYtdlpProxy("http://alice:secret@proxy.example:8080");

    expect(useSettingsStore.getState().ytdlpProxy).toBe("");
  });

  it.each([
    "http://alice@proxy.example:8080",
    "socks5://:secret@proxy.example:1080",
    "socks5h://alice%40work:secret@proxy.example:1080",
    "http://alice:secret@@proxy.example:8080",
  ])("rejects credential-bearing or malformed proxy authority %s", (proxy) => {
    useSettingsStore.getState().setYtdlpProxy(proxy);
    expect(useSettingsStore.getState().ytdlpProxy).toBe("");
  });

  it("keeps unauthenticated proxy URLs and at-signs outside the authority", () => {
    useSettingsStore.getState().setYtdlpProxy("socks5://proxy.example:1080");
    expect(useSettingsStore.getState().ytdlpProxy).toBe("socks5://proxy.example:1080");
    useSettingsStore.getState().setYtdlpProxy("http://proxy.example:8080/?target=a@b");
    expect(useSettingsStore.getState().ytdlpProxy).toBe("http://proxy.example:8080/?target=a@b");
  });

  it("removes an authenticated proxy from previously persisted settings", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("lyrical-sync-settings", JSON.stringify({
        state: { ytdlpProxy: "http://alice:secret@proxy.example:8080" },
        version: 0,
      }));

      await useSettingsStore.persist.rehydrate();

      expect(useSettingsStore.getState().ytdlpProxy).toBe("");
      vi.advanceTimersByTime(300);
      const persisted = localStorage.getItem("lyrical-sync-settings") ?? "";
      expect(persisted).not.toContain("alice");
      expect(persisted).not.toContain("secret");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      localStorage.removeItem("lyrical-sync-settings");
      useSettingsStore.setState({ ytdlpProxy: "" });
    }
  });
});
