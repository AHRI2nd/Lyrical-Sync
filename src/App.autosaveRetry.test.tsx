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
vi.mock("./components/Service/ModeSelectButton", () => ({ ModeSelectButton: () => null }));
vi.mock("./components/AppShell/RecentFilesMenu", () => ({ RecentFilesMenu: () => null }));
vi.mock("./components/AppShell/LangDropdown", () => ({ LangDropdown: () => null }));
vi.mock("./components/AppShell/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("./components/Update/UpdateModal", () => ({ UpdateModal: () => null }));
vi.mock("./hooks/useMacMenu", () => ({ useMacMenu: () => {} }));

import App from "./App";
import { useI18nStore } from "./stores/useI18nStore";
import { useLrcStore } from "./stores/useLrcStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useToastStore } from "./stores/useToastStore";
import { defaultDocument } from "./types/lrc";
import { clearRecoverySnapshot, loadRecoverySnapshot } from "./utils/recovery";
import { needsInlineTimestampEscape } from "./utils/lrcParser";

const path = "/tmp/autosave-retry.lrc";
const writes = () => invokeMock.mock.calls.filter(([command]) => command === "write_lrc_file_if_unchanged");
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  clearRecoverySnapshot();
  useLrcStore.getState().newLrc();
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "retry-line", timestamp: 1, text: "Persist this edit" }] },
    lrcPath: path,
    _lrcFileHash: "a".repeat(64),
    audioPath: null,
    isDirty: true,
    _history: [],
    _future: [],
  });
  useSettingsStore.setState({ autoCheckUpdate: false, autoSave: true, spotifyMode: false, deviceMode: false, youtubeMode: false });
  useToastStore.setState({ toasts: [] });
  invokeMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearRecoverySnapshot();
  vi.restoreAllMocks();
});

it("retries unchanged dirty lyrics after one transient native write failure, then stops after success", async () => {
  invokeMock.mockImplementation((command: string) =>
    command === "write_lrc_file_if_unchanged" && writes().length === 1
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

it("does not overwrite an externally changed file or retry the conflict", async () => {
  invokeMock.mockRejectedValue("LYRICS_FILE_CHANGED");
  render(<App />);

  await advance(1_500);
  expect(writes()).toHaveLength(1);
  expect(useLrcStore.getState().isDirty).toBe(true);
  expect(useToastStore.getState().toasts.some(toast => toast.message === useI18nStore.getState().t.toast.fileChanged)).toBe(true);
  await advance(60_000);
  expect(writes()).toHaveLength(1);
});

it("accepts a published autosave after directory durability failure without misreporting a file conflict", async () => {
  let publishedContent = "";
  invokeMock.mockImplementation((command: string, args?: { content?: string }) => {
    if (command === "write_lrc_file_if_unchanged") {
      publishedContent = args?.content ?? "";
      return Promise.reject(new Error("SAVE_PUBLISHED_DURABILITY_UNCONFIRMED: directory sync failed"));
    }
    if (command === "read_lrc_file_with_hash") {
      return Promise.resolve({ content: publishedContent, sha256: "b".repeat(64) });
    }
    return Promise.resolve(undefined);
  });
  render(<App />);

  await advance(1_500);

  expect(writes()).toHaveLength(1);
  expect(useLrcStore.getState().isDirty).toBe(false);
  expect(useLrcStore.getState()._lrcFileHash).toBe("b".repeat(64));
  expect(useToastStore.getState().toasts.some(({ message }) =>
    message === useI18nStore.getState().t.toast.saveDurabilityUnconfirmed,
  )).toBe(true);
  expect(useToastStore.getState().toasts.some(({ message }) =>
    message === useI18nStore.getState().t.toast.fileChanged,
  )).toBe(false);
});

it("never retries a successful first autosave", async () => {
  render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);
  expect(useLrcStore.getState().isDirty).toBe(false);
  await advance(40_000);
  expect(writes()).toHaveLength(1);
});

it("caps permanent native failures and keeps dirty data available for later manual saving", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file_if_unchanged"
    ? Promise.reject(new Error("drive remains unavailable")) : Promise.resolve(undefined));
  const noticeSpy = vi.spyOn(useToastStore.getState(), "push");
  render(<App />);
  await advance(60_000);
  expect(writes()).toHaveLength(4); // initial attempt + at most three retries
  expect(useLrcStore.getState().isDirty).toBe(true);
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Persist this edit");
  expect(loadRecoverySnapshot()?.doc.lines[0].text).toBe("Persist this edit");
  expect(noticeSpy.mock.calls.filter(([type]) => type === "error")).toHaveLength(1);
  await advance(60_000);
  expect(writes()).toHaveLength(4);
});

it("retries dirty lyrics after silent metadata changes once the retry budget was exhausted", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file_if_unchanged"
    ? Promise.reject(new Error("drive remains unavailable")) : Promise.resolve(undefined));
  render(<App />);

  await advance(60_000);
  expect(writes()).toHaveLength(4);
  act(() => { useLrcStore.getState().setMetadata({ artist: "Automatic artist" }, true); });
  await advance(1_500);

  expect(writes()).toHaveLength(5);
  expect(writes()[4][1].content).toContain("Automatic artist");
  expect(useLrcStore.getState().isDirty).toBe(true);
});

it("does not retry a deterministic SRT format loss error", async () => {
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
  const formatError = useI18nStore.getState().t.toast.srtLossyDocument;
  expect(noticeSpy.mock.calls.filter(([type, message]) => type === "error" && message === formatError)).toHaveLength(1);
});

it("does not retry timestamps that cannot be serialized into SRT milliseconds", async () => {
  const original = useLrcStore.getState().doc;
  useLrcStore.setState({
    doc: { ...original, lines: [{ id: "huge", timestamp: 1e306, text: "Cannot encode" }] },
    lrcPath: "/tmp/autosave-retry.srt",
  });
  const noticeSpy = vi.spyOn(useToastStore.getState(), "push");
  render(<App />);
  await advance(50_000);
  expect(writes()).toHaveLength(0);
  expect(useLrcStore.getState().isDirty).toBe(true);
  expect(noticeSpy.mock.calls.filter(([type, message]) =>
    type === "error" && message === useI18nStore.getState().t.toast.invalidTimestamp)).toHaveLength(1);
});

it("does not let an old request retry after the same path is owned by another document session", async () => {
  let rejectOld!: (error: Error) => void;
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file_if_unchanged" && writes().length === 1
    ? new Promise<undefined>((_resolve, reject) => { rejectOld = reject; })
    : Promise.resolve(undefined));
  render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);

  const nextDoc = { ...defaultDocument(), lines: [{ id: "next", timestamp: 2, text: "Next document" }] };
  act(() => { useLrcStore.getState().restoreDoc(nextDoc, path, null, "a".repeat(64)); });
  rejectOld(new Error("old session write failed"));
  await advance(1500);
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1].content).toContain("Next document");
  expect(useLrcStore.getState().isDirty).toBe(false);
  await advance(40_000);
  expect(writes()).toHaveLength(2);
});

it("does not let an old successful autosave consume the next document's LRC escape notice", async () => {
  let resolveOld!: (value: undefined) => void;
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file_if_unchanged" && writes().length === 1
    ? new Promise<undefined>((resolve) => { resolveOld = resolve; })
    : Promise.resolve(undefined));
  const original = useLrcStore.getState().doc;
  useLrcStore.setState({
    doc: { ...original, lines: [{ id: "old", timestamp: 1, text: "literal <00:01.000>" }] },
  });
  const notice = useI18nStore.getState().t.toast.lrcInlineEscapeNotice;
  render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);

  const nextDoc = { ...defaultDocument(), lines: [{ id: "next", timestamp: 2, text: "literal <00:02.000>" }] };
  expect(needsInlineTimestampEscape(nextDoc)).toBe(true);
  act(() => { useLrcStore.getState().restoreDoc(nextDoc, path, null, "a".repeat(64)); });
  resolveOld(undefined);
  await act(async () => {});
  expect(useToastStore.getState().toasts.some((toast) => toast.message === notice)).toBe(false);

  await advance(1500);
  expect(writes()).toHaveLength(2);
  expect(useToastStore.getState().toasts.filter((toast) => toast.message === notice)).toHaveLength(1);
});

it("cancels old-document retry timers when the document session changes", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file_if_unchanged"
    ? Promise.reject(new Error("drive unavailable")) : Promise.resolve(undefined));
  render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);
  act(() => { useLrcStore.getState().newLrc(); });
  await advance(40_000);
  expect(writes()).toHaveLength(1);
  expect(useLrcStore.getState().lrcPath).toBeNull();
});

it("cancels pending retries on unmount and when autosave is disabled", async () => {
  invokeMock.mockImplementation((command: string) => command === "write_lrc_file_if_unchanged"
    ? Promise.reject(new Error("drive unavailable")) : Promise.resolve(undefined));
  const view = render(<App />);
  await advance(1500);
  expect(writes()).toHaveLength(1);
  act(() => { useSettingsStore.setState({ autoSave: false }); });
  await advance(30_000);
  expect(writes()).toHaveLength(1);
  act(() => { useSettingsStore.setState({ autoSave: true }); });
  await advance(1500);
  expect(writes()).toHaveLength(2);
  view.unmount();
  await advance(40_000);
  expect(writes()).toHaveLength(2);
});
