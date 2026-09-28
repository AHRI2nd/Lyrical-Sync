import { describe, it, expect, beforeEach, vi } from "vitest";

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
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(globalThis.localStorage, "setItem");
    setItemSpy.mockClear();

    useSettingsStore.getState().setUiScale(1.1);
    useSettingsStore.getState().setUiScale(1.2);
    useSettingsStore.getState().setUiScale(1.3);

    // 인메모리 상태는 매 호출마다 즉시 반영 — UI 반응성엔 영향 없음
    expect(useSettingsStore.getState().uiScale).toBe(1.3);
    // 하지만 실제 디스크 쓰기는 디바운스 구간 동안 아직 발생하지 않아야 함
    expect(setItemSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    const written = setItemSpy.mock.calls[0][1];
    expect(JSON.parse(written).state.uiScale).toBe(1.3);

    setItemSpy.mockRestore();
    vi.useRealTimers();
  });
});
