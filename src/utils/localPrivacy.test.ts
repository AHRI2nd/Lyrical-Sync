// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useLrcStore } from "../stores/useLrcStore";
import { configureRecovery, clearLocalData } from "./localPrivacy";
import { useSettingsStore } from "../stores/useSettingsStore";
import { loadRecoverySnapshot, saveRecoverySnapshot } from "./recovery";
import { defaultDocument } from "../types/lrc";
beforeEach(() => { localStorage.clear(); useSettingsStore.setState({ recoveryEnabled: true }); });
afterEach(() => vi.restoreAllMocks());
it("disables recovery durably and deletes existing app-owned snapshots", async () => {
  saveRecoverySnapshot(defaultDocument(), "/original.lrc", "/original.wav");
  expect(configureRecovery(false)).toBe(true);
  expect(loadRecoverySnapshot()).toBeNull();
  expect(useSettingsStore.getState().recoveryEnabled).toBe(false);
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().recoveryEnabled).toBe(false);
});
it("does not erase the backup or report success when persisting the opt-out fails", () => {
  saveRecoverySnapshot(defaultDocument(), null, null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
  expect(configureRecovery(false)).toBe(false);
  expect(useSettingsStore.getState().recoveryEnabled).toBe(true);
  expect(loadRecoverySnapshot()).not.toBeNull();
});
it("keeps recovery off and reports failed snapshot deletion for an explicit retry", () => {
  saveRecoverySnapshot(defaultDocument(), null, null);
  const failure = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw Error("blocked"); });
  expect(configureRecovery(false)).toBe(false);
  expect(useSettingsStore.getState().recoveryEnabled).toBe(false);
  expect(loadRecoverySnapshot()).not.toBeNull();
  failure.mockRestore();
  expect(configureRecovery(false)).toBe(true);
  expect(loadRecoverySnapshot()).toBeNull();
});

it("clears settings, history and recovery but retains original references and current unsaved editor data", () => {
  useSettingsStore.getState().setUiScale(1.2);
  useSettingsStore.getState().setAutoSave(false);
  useSettingsStore.getState().addRecentFile({ lrcPath: "/original.lrc", audioPath: null, lrcBookmark: "grant", audioBookmark: null });
  saveRecoverySnapshot(defaultDocument(), "/original.lrc", "/original.wav");
  localStorage.setItem("unrelated", "keep");
  const document = useLrcStore.getState().doc;
  expect(clearLocalData()).toBe(true);
  expect(useSettingsStore.getState().recentFiles).toEqual([]);
  expect(useSettingsStore.getState().uiScale).toBe(1);
  expect(useSettingsStore.getState().recoveryEnabled).toBe(false);
  expect(loadRecoverySnapshot()).toBeNull();
  expect(localStorage.getItem("unrelated")).toBe("keep");
  expect(JSON.parse(localStorage.getItem("lyrical-sync-settings")!).state).toEqual({ recoveryEnabled: false, autoSave: false });
  expect(useLrcStore.getState().doc).toBe(document);
});
it("reports a partial deletion failure without claiming all local data was cleared", () => {
  saveRecoverySnapshot(defaultDocument(), null, null);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw Error("blocked"); });
  expect(clearLocalData()).toBe(false);
  expect(loadRecoverySnapshot()).not.toBeNull();
  expect(useSettingsStore.getState().recoveryEnabled).toBe(false);
});
