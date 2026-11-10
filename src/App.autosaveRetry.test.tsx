// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./components/AudioPlayer/AudioPlayer", () => ({ AudioPlayer: () => null }));
vi.mock("./components/MetaEditor/MetaEditor", () => ({ MetaEditor: () => null }));
vi.mock("./components/LrcEditor/LrcEditor", () => ({ LrcEditor: () => null }));
vi.mock("./components/Update/UpdateModal", () => ({ UpdateModal: () => null }));
vi.mock("./hooks/useMacMenu", () => ({ useMacMenu: () => {} }));

import App from "./App";
import { useI18nStore } from "./stores/useI18nStore";
import { useLrcStore } from "./stores/useLrcStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useToastStore } from "./stores/useToastStore";
import { defaultDocument } from "./types/lrc";
import { clearRecoverySnapshot, loadRecoverySnapshot } from "./utils/recovery";

const path = "/tmp/autosave-retry.lrc";
const writes = () => invokeMock.mock.calls.filter(([command]) => command === "write_lrc_file");
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  clearRecoverySnapshot();
  const state = useLrcStore.getState();
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "retry-line", timestamp: 1, text: "Persist this edit" }] },
    lrcPath: path,
    lrcBookmark: null,
    audioPath: null,
    audioBookmark: null,
    isDirty: true,
    _documentSession: state._documentSession + 1,
    _editRevision: 0,
    _history: [],
    _future: [],
  });
  useSettingsStore.setState({ autoSave: true, recoveryEnabled: true });
  useToastStore.setState({ toasts: [] });
  invokeMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearRecoverySnapshot();
  vi.restoreAllMocks();
});

it("retries the unchanged dirty document after a transient native write failure", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file" && writes().length === 1
    ? Promise.reject(new Error("temporary destination unavailable"))
    : Promise.resolve(undefined));
  render(<App />);

  await advance(1500);
  expect(writes()).toHaveLength(1);
  expect(useLrcStore.getState().isDirty).toBe(true);
  await advance(2999);
  expect(writes()).toHaveLength(1);
  await advance(1);
  expect(writes()).toHaveLength(2);
  expect(writes()[0][1].content).toBe(writes()[1][1].content);
  expect(useLrcStore.getState().isDirty).toBe(false);
  await advance(60_000);
  expect(writes()).toHaveLength(2);
});

it.each([true, false])("caps permanent failures and preserves dirty data with recovery enabled=%s", async (recoveryEnabled) => {
  useSettingsStore.setState({ recoveryEnabled });
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file"
    ? Promise.reject(new Error("drive remains unavailable")) : Promise.resolve(undefined));
  render(<App />);

  await advance(5_000);
  expect(useToastStore.getState().toasts.filter(({ message }) => message === useI18nStore.getState().t.toast.saveFailed)).toHaveLength(1);
  await advance(55_000);

  expect(writes()).toHaveLength(4);
  expect(useLrcStore.getState().isDirty).toBe(true);
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Persist this edit");
  expect(loadRecoverySnapshot()?.doc.lines[0].text ?? null).toBe(recoveryEnabled ? "Persist this edit" : null);
  await advance(60_000);
  expect(writes()).toHaveLength(4);
});

it("does not retry a deterministic SRT format error", async () => {
  const original = useLrcStore.getState().doc;
  useLrcStore.setState({
    doc: { ...original, metadata: { ...original.metadata, title: "Not representable in SRT" } },
    lrcPath: "/tmp/autosave-retry.srt",
  });
  const noticeSpy = vi.spyOn(useToastStore.getState(), "push");
  render(<App />);

  await advance(50_000);

  expect(writes()).toHaveLength(0);
  expect(useLrcStore.getState().isDirty).toBe(true);
  expect(noticeSpy.mock.calls.some(([type, message]) => type === "error" && message === useI18nStore.getState().t.toast.srtLossyDocument)).toBe(true);
});

it("cancels an old retry when a newer document revision arrives", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file" && writes().length === 1
    ? Promise.reject(new Error("drive unavailable")) : Promise.resolve(undefined));
  render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);

  act(() => useLrcStore.getState().updateLine("retry-line", { text: "Newer edit" }));
  await advance(1500);
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1].content).toContain("Newer edit");
  await advance(60_000);
  expect(writes()).toHaveLength(2);
});

it("stops autosave retries when disabled while preserving manual save", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file" && writes().length === 1
    ? Promise.reject(new Error("drive unavailable")) : Promise.resolve(undefined));
  render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);

  act(() => useSettingsStore.setState({ autoSave: false }));
  await advance(30_000);
  expect(writes()).toHaveLength(1);
  expect(useLrcStore.getState().isDirty).toBe(true);

  await act(async () => { await useLrcStore.getState().saveLrc(); });
  expect(writes()).toHaveLength(2);
  expect(useLrcStore.getState().isDirty).toBe(false);
});
