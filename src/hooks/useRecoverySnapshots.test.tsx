// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { useSettingsStore } from "../stores/useSettingsStore";
import { invoke } from "@tauri-apps/api/core";
import { useRecoverySnapshots } from "./useRecoverySnapshots";
import { useLrcStore } from "../stores/useLrcStore";
import { defaultDocument } from "../types/lrc";
import { loadRecoverySnapshot, saveRecoverySnapshot } from "../utils/recovery";
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  useSettingsStore.setState({ recoveryEnabled: true });
  useLrcStore.setState({ doc: defaultDocument(), isDirty: true, lrcPath: "/song.lrc", lrcBookmark: null, audioPath: null, audioBookmark: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("continuous edits flush the latest snapshot within five seconds", () => {
  renderHook(() => useRecoverySnapshots(false));
  for (let i = 0; i < 5; i++) act(() => { useLrcStore.getState().setMetadata({ title: String(i) }); vi.advanceTimersByTime(1000); });
  expect(loadRecoverySnapshot()?.doc.metadata.title).toBe("4");
});
it("preserves an unresolved startup snapshot even when the current document is clean", () => {
  saveRecoverySnapshot({ ...defaultDocument(), lines: [{ id: "1", text: "startup", timestamp: null }] }, null, null);
  useLrcStore.setState({ isDirty: false });
  renderHook(() => useRecoverySnapshots(true));
  act(() => vi.advanceTimersByTime(10000));
  expect(loadRecoverySnapshot()?.doc.lines[0].text).toBe("startup");
});
it("stale save cannot clear recovery for edits made during its write", async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  renderHook(() => useRecoverySnapshots(false));
  const saving = useLrcStore.getState().saveLrc();
  await act(async () => { await Promise.resolve(); });
  act(() => { useLrcStore.getState().addLine("later"); vi.advanceTimersByTime(5000); });
  await act(async () => { finish(); await saving; });
  expect(loadRecoverySnapshot()?.doc.lines[0].text).toBe("later");
});
it("reports failed backup while edits continue and clears the warning after retry", () => {
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const { result } = renderHook(() => useRecoverySnapshots(false));
  act(() => { useLrcStore.getState().addLine("editable"); vi.advanceTimersByTime(5000); });
  expect(result.current).toBe(true);
  expect(useLrcStore.getState().doc.lines[0].text).toBe("editable");
  failure.mockRestore();
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current).toBe(false);
  expect(loadRecoverySnapshot()?.doc.lines[0].text).toBe("editable");
});
it("current successful save clears only the snapshot written by this hook", async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  renderHook(() => useRecoverySnapshots(false));
  act(() => vi.advanceTimersByTime(5000));
  expect(loadRecoverySnapshot()).not.toBeNull();
  await act(async () => { await useLrcStore.getState().saveLrc(); });
  expect(loadRecoverySnapshot()).toBeNull();
});
it("successful manual save ends the backup warning even when no backup was written", async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const { result } = renderHook(() => useRecoverySnapshots(false));
  expect(result.current).toBe(true);
  await act(async () => { await useLrcStore.getState().saveLrc(); });
  expect(result.current).toBe(false);
});
it("retries failed cleanup without removing a newer snapshot", async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  const { result } = renderHook(() => useRecoverySnapshots(false));
  const failure = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
  await act(async () => { await useLrcStore.getState().saveLrc(); });
  expect(result.current).toBe(true);
  failure.mockRestore();
  saveRecoverySnapshot({ ...defaultDocument(), lines: [{ id: "new", text: "newer session", timestamp: null }] }, null, null, null, null, "newer");
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current).toBe(false);
  expect(loadRecoverySnapshot()?.sessionId).toBe("newer");
});

it("stops all backup writes while disabled and resumes the latest edited document when enabled", () => {
  const { unmount } = renderHook(() => useRecoverySnapshots(false));
  act(() => useSettingsStore.setState({ recoveryEnabled: false }));
  localStorage.removeItem("lyrical-sync-recovery");
  act(() => { useLrcStore.getState().addLine("unsaved working text"); vi.advanceTimersByTime(15000); });
  expect(loadRecoverySnapshot()).toBeNull();
  expect(useLrcStore.getState().isDirty).toBe(true);
  act(() => useSettingsStore.setState({ recoveryEnabled: true }));
  expect(loadRecoverySnapshot()?.doc.lines[0].text).toBe("unsaved working text");
  unmount();
});
