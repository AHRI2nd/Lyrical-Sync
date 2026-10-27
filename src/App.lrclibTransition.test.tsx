// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

if (typeof globalThis.localStorage === "undefined") {
  const data = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
}

const { saveDialog, invokeMock } = vi.hoisted(() => ({
  saveDialog: vi.fn(),
  invokeMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: saveDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./components/AudioPlayer/AudioPlayer", () => ({ AudioPlayer: () => null }));
vi.mock("./components/LrcEditor/LrcEditor", () => ({ LrcEditor: () => null }));
vi.mock("./components/Service/ModeSelectButton", () => ({ ModeSelectButton: () => null }));
vi.mock("./components/AppShell/RecentFilesMenu", () => ({ RecentFilesMenu: () => null }));
vi.mock("./components/AppShell/LangDropdown", () => ({ LangDropdown: () => null }));
vi.mock("./components/AppShell/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("./components/Update/UpdateModal", () => ({ UpdateModal: () => null }));
vi.mock("./hooks/useMacMenu", () => ({ useMacMenu: () => {} }));

import App from "./App";
import { useLrcStore } from "./stores/useLrcStore";
import { useI18nStore } from "./stores/useI18nStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { defaultDocument } from "./types/lrc";
import { clearRecoverySnapshot } from "./utils/recovery";

const result = {
  id: 7,
  trackName: "Fetched Song",
  artistName: "Fetched Artist",
  albumName: "Fetched Album",
  duration: 180,
  instrumental: false,
  plainLyrics: "Fetched lyric",
  syncedLyrics: "[00:02.00]Fetched lyric",
};

function resetDocument(overrides: Partial<ReturnType<typeof useLrcStore.getState>> = {}) {
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "old", timestamp: 1, text: "Original unsaved lyric" }] },
    activeLineId: "old",
    lrcPath: null,
    isDirty: true,
    _history: [],
    _future: [],
    ...overrides,
  });
}

function openLrcLib() {
  const { getByRole } = render(<App />);
  fireEvent.click(getByRole("button", { name: "LRCLIB" }));
  return { getByRole };
}

async function searchAndSelect(getByRole: ReturnType<typeof openLrcLib>["getByRole"]) {
  const t = useI18nStore.getState().t;
  await waitFor(() => expect(document.querySelector('.fixed.inset-0 input[type="text"]')).toBeTruthy());
  const searchField = document.querySelector('.fixed.inset-0 input[type="text"]') as HTMLInputElement;
  fireEvent.change(searchField, { target: { value: "Fetched Song" } });
  fireEvent.click(getByRole("button", { name: t.lrclib.search }));
  await waitFor(() => expect(document.body.textContent).toContain("Fetched Song"));
  fireEvent.click(getByRole("button", { name: t.lrclib.confirm }));
}

beforeEach(() => {
  clearRecoverySnapshot();
  resetDocument();
  useSettingsStore.setState({ autoCheckUpdate: false, autoSave: false, deviceMode: false });
  invokeMock.mockReset().mockResolvedValue(undefined);
  saveDialog.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [result] }));
});

afterEach(() => {
  cleanup();
  clearRecoverySnapshot();
  vi.unstubAllGlobals();
});

it("keeps the dirty document on Cancel and applies the chosen result only after Discard", async () => {
  const { getByRole } = openLrcLib();
  await searchAndSelect(getByRole);
  const t = useI18nStore.getState().t;
  const dialog = getByRole("dialog");
  expect(dialog).toBeTruthy();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Original unsaved lyric");

  fireEvent.click(getByRole("button", { name: t.confirmNewCancel }));
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Original unsaved lyric");
  expect(useLrcStore.getState()._history).toHaveLength(0);

  fireEvent.click(getByRole("button", { name: t.lrclib.confirm }));
  fireEvent.click(getByRole("button", { name: t.recovery.discard }));
  await waitFor(() => expect(useLrcStore.getState().doc.lines[0].text).toBe("Fetched lyric"));
  expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "Fetched Song", artist: "Fetched Artist", album: "Fetched Album" });
  expect(useLrcStore.getState().lrcPath).toBeNull();
});

it("saves an existing dirty file before replacing it and keeps the new file clean only until fetched lyrics apply", async () => {
  resetDocument({ lrcPath: "/tmp/current.lrc" });
  const { getByRole } = openLrcLib();
  await searchAndSelect(getByRole);
  const t = useI18nStore.getState().t;
  fireEvent.click(within(getByRole("dialog")).getByRole("button", { name: t.save }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/tmp/current.lrc" })));
  await waitFor(() => expect(useLrcStore.getState().doc.lines[0].text).toBe("Fetched lyric"));
  expect(useLrcStore.getState().isDirty).toBe(true);
});

it("asks again after a manual edit during confirmation and lets Escape cancel the top modal", async () => {
  const { getByRole } = openLrcLib();
  await searchAndSelect(getByRole);
  const t = useI18nStore.getState().t;
  act(() => useLrcStore.getState().setMetadata({ title: "Edited while waiting" }));
  fireEvent.click(within(getByRole("dialog")).getByRole("button", { name: t.recovery.discard }));
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Original unsaved lyric");

  fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Original unsaved lyric");
  expect(useLrcStore.getState().doc.metadata.title).toBe("Edited while waiting");
});

it("does not replace dirty content when writing the selected Save target fails", async () => {
  resetDocument({ lrcPath: "/tmp/current.lrc" });
  const { getByRole } = openLrcLib();
  await searchAndSelect(getByRole);
  invokeMock.mockRejectedValueOnce(new Error("disk write failed"));
  const t = useI18nStore.getState().t;
  fireEvent.click(within(getByRole("dialog")).getByRole("button", { name: t.save }));
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Original unsaved lyric");
  expect(useLrcStore.getState().isDirty).toBe(true);
});

it("rejects search results owned by a document session that has since changed", async () => {
  const { getByRole } = openLrcLib();
  await waitFor(() => expect(document.querySelector('.fixed.inset-0 input[type="text"]')).toBeTruthy());
  const searchField = document.querySelector('.fixed.inset-0 input[type="text"]') as HTMLInputElement;
  fireEvent.change(searchField, { target: { value: "Fetched Song" } });
  fireEvent.click(getByRole("button", { name: useI18nStore.getState().t.lrclib.search }));
  await waitFor(() => expect(document.body.textContent).toContain("Fetched Song"));
  await act(async () => { await useLrcStore.getState().newLrc(); });
  fireEvent.click(getByRole("button", { name: useI18nStore.getState().t.lrclib.confirm }));
  await waitFor(() => expect(useLrcStore.getState().doc.lines).toHaveLength(0));
  expect(useLrcStore.getState().doc.lines).toEqual([]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("does not replace an existing document when Save As is cancelled", async () => {
  const { getByRole } = openLrcLib();
  await searchAndSelect(getByRole);
  const t = useI18nStore.getState().t;
  fireEvent.click(within(getByRole("dialog")).getByRole("button", { name: t.save }));
  await waitFor(() => expect(saveDialog).toHaveBeenCalled());
  expect(useLrcStore.getState().doc.lines[0].text).toBe("Original unsaved lyric");
  expect(useLrcStore.getState().isDirty).toBe(true);
});
