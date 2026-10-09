// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => { localStorage.clear(); vi.resetModules(); });
it("persists settings and bookmarks immediately and restores a recreated module", async () => {
  const { useSettingsStore } = await import("./useSettingsStore");
  useSettingsStore.getState().setAutoSave(false);
  useSettingsStore.getState().setUiScale(1.2);
  useSettingsStore.getState().addRecentFile({ lrcPath: "/a.lrc", audioPath: null, lrcBookmark: "grant", audioBookmark: null });
  expect(JSON.parse(localStorage.getItem("lyrical-sync-settings")!).state.recentFiles[0].lrcBookmark).toBe("grant");
  vi.resetModules();
  const restored = (await import("./useSettingsStore")).useSettingsStore.getState();
  expect(restored.autoSave).toBe(false); expect(restored.uiScale).toBe(1.2);
  expect(restored.recentFiles[0].lrcBookmark).toBe("grant");
});
it("rejects corrupt types, ranges, shortcuts and recent entries without overriding actions", async () => {
  localStorage.setItem("lyrical-sync-settings", JSON.stringify({ state: { autoSave: "yes", uiScale: 50,
    lyricsFontScale: -1, showSpectrogram: "false", keybindings: { stamp: 4, playPause: "Escape" },
    recentFiles: [{ lrcPath: 4, audioPath: null, openedAt: "yesterday" }], setAutoSave: "broken" }, version: 0 }));
  const state = (await import("./useSettingsStore")).useSettingsStore.getState();
  expect(state.autoSave).toBe(true); expect(state.uiScale).toBe(1);
  expect(state.lyricsFontScale).toBe(1); expect(state.showSpectrogram).toBe(false);
  expect(state.keybindings.stamp).toBe("Space"); expect(state.keybindings.playPause).toBe("Digit3");
  expect(state.recentFiles).toEqual([]); expect(typeof state.setAutoSave).toBe("function");
});
it("recovers from malformed JSON and quota errors without blocking in-memory settings", async () => {
  localStorage.setItem("lyrical-sync-settings", "{broken");
  const { useSettingsStore } = await import("./useSettingsStore");
  expect(useSettingsStore.persist.hasHydrated()).toBe(true);
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try { expect(() => useSettingsStore.getState().setAutoSave(false)).not.toThrow(); expect(useSettingsStore.getState().autoSave).toBe(false); }
  finally { failure.mockRestore(); }
});
it("keeps legacy bookmarks and international-layout keyboard codes", async () => {
  localStorage.setItem("lyrical-sync-settings", JSON.stringify({ state: { keybindings: { stamp: "IntlYen" },
    recentFiles: [{ lrcPath: "/legacy.lrc", audioPath: null, openedAt: 1 }] }, version: 0 }));
  const state = (await import("./useSettingsStore")).useSettingsStore.getState();
  expect(state.keybindings.stamp).toBe("IntlYen");
  expect(state.recentFiles[0].lrcBookmark).toBeNull();
});
