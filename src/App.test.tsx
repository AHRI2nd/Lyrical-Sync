// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Native APIs and audio rendering are outside this shell-level DOM test.
type NativeDropEvent = { payload: { type: "drop"; paths: string[] } };
let nativeDrop: ((event: NativeDropEvent) => void) | null = null;
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (event: NativeDropEvent) => void) => {
      nativeDrop = handler;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("./components/AudioPlayer/AudioPlayer", () => ({ AudioPlayer: () => null }));

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { saveRecoverySnapshot } from "./utils/recovery";
import App from "./App";
import { useLrcStore } from "./stores/useLrcStore";
import { useSettingsPersistenceStore, useSettingsStore } from "./stores/useSettingsStore";
import { useI18nStore } from "./stores/useI18nStore";
import { DEFAULT_KEYBINDINGS } from "./utils/keybindings";
import { audioControls } from "./utils/audioControls";
import { defaultDocument } from "./types/lrc";
import { parseSrt } from "./utils/srtConverter";

describe("App document confirmation and keyboard boundaries", () => {
  beforeEach(() => {
    nativeDrop = null;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useSettingsStore.setState({ autoSave: false, recentFiles: [], keybindings: { ...DEFAULT_KEYBINDINGS } });
    useLrcStore.setState({
      doc: {
        ...defaultDocument(),
        lines: [{ id: "draft", text: "Keep this draft", timestamp: null }],
      },
      audioPath: null,
      lrcPath: null,
      audioBookmark: null,
      lrcBookmark: null,
      isDirty: true,
      activeLineId: null,
      currentTime: 12,
      syncMode: "line",
      _history: [],
      _future: [],
    });
  });

  afterEach(() => {
    cleanup(); document.querySelectorAll("[data-test-control]").forEach((node) => node.remove()); vi.restoreAllMocks();
    nativeDrop = null;
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    localStorage.clear();
  });

  const existingPair = (dirty: boolean) => {
    useLrcStore.setState({
      doc: { ...defaultDocument(), lines: [{ id: "original", timestamp: 1, text: "Original lyric" }] },
      lrcPath: "/old.lrc", audioPath: "/old.mp3", isDirty: dirty,
      lrcBookmark: null, audioBookmark: null, _history: [], _future: [],
    });
    vi.mocked(invoke).mockImplementation((command) => command === "read_lrc_file"
      ? Promise.resolve("[00:03.00]Incoming lyric") : Promise.resolve(null));
  };
  const drop = (paths: string[]) => {
    expect(nativeDrop).not.toBeNull();
    act(() => nativeDrop?.({ payload: { type: "drop", paths } }));
  };
  const incoming = {
    audio: ["/new.mp3"], lyrics: ["/new.lrc"], both: ["/new.mp3", "/new.lrc"],
  } as const;

  it.each(["audio", "lyrics", "both"] as const)("confirms a clean existing %s replacement and keeps both resources on Cancel", async (kind) => {
    existingPair(false);
    render(<App />);
    drop([...incoming[kind]]);
    const t = useI18nStore.getState().t;
    const modal = await screen.findByRole("dialog", { name: t.drop.replaceTitle });
    const expectedMessage = kind === "both" ? t.drop.replaceBoth : kind === "audio" ? t.drop.replaceAudio : t.drop.replaceLyrics;
    expect(within(modal).getByText(expectedMessage)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: t.replaceDocumentTitle })).toBeNull();
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
    expect(useLrcStore.getState().audioPath).toBe("/old.mp3");
    fireEvent.click(within(modal).getByRole("button", { name: t.drop.replaceCancel }));
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Original lyric");
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
    expect(useLrcStore.getState().audioPath).toBe("/old.mp3");
  });

  it.each(["audio", "lyrics", "both"] as const)("applies a confirmed clean %s replacement without a second prompt", async (kind) => {
    existingPair(false);
    render(<App />);
    drop([...incoming[kind]]);
    const t = useI18nStore.getState().t;
    const modal = await screen.findByRole("dialog", { name: t.drop.replaceTitle });
    fireEvent.click(within(modal).getByRole("button", { name: t.drop.replaceOk }));
    await waitFor(() => {
      expect(useLrcStore.getState().audioPath).toBe(kind === "lyrics" ? "/old.mp3" : "/new.mp3");
      expect(useLrcStore.getState().lrcPath).toBe(kind === "audio" ? "/old.lrc" : "/new.lrc");
    });
    expect(useLrcStore.getState().doc.lines[0].text).toBe(kind === "audio" ? "Original lyric" : "Incoming lyric");
    expect(screen.queryByRole("dialog", { name: t.replaceDocumentTitle })).toBeNull();
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("reports malformed SRT timing without replacing the current document", async () => {
    existingPair(false);
    const originalDoc = useLrcStore.getState().doc;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "prepare_file_ref") return Promise.resolve({ path: "/incoming.srt", bookmark: null });
      if (command === "read_lrc_file") return Promise.resolve("1\n00:00:01,000 --> 00:00:02,000\nValid cue\n\n2\ninvalid --> 00:00:04,000\nBroken cue");
      return Promise.resolve(null);
    });
    render(<App />);
    drop(["/incoming.srt"]);

    const t = useI18nStore.getState().t;
    const confirmation = await screen.findByRole("dialog", { name: t.drop.replaceTitle });
    fireEvent.click(within(confirmation).getByRole("button", { name: t.drop.replaceOk }));
    await waitFor(() => expect(screen.getByText(t.toast.srtMalformedCue)).toBeTruthy());
    expect(useLrcStore.getState().doc).toBe(originalDoc);
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
    expect(useLrcStore.getState().audioPath).toBe("/old.mp3");
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("requires explicit confirmation before Save As strips SRT formatting and does not write on Cancel", async () => {
    vi.mocked(save).mockResolvedValue("/exports/styled.lrc");
    vi.mocked(invoke).mockResolvedValue(undefined);
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:03,000\n<b>styled</b>\n");
    useLrcStore.setState({ doc, lrcPath: "/source.srt", isDirty: true, _history: [], _future: [] });
    render(<App />);
    const t = useI18nStore.getState().t;

    fireEvent.click(screen.getByRole("button", { name: t.saveAs }));
    fireEvent.click(await screen.findByRole("button", { name: /LRC/ }));
    let confirmation = await screen.findByRole("dialog", { name: t.srtOnlyDataLossTitle });
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("write_lrc_file", expect.anything());
    fireEvent.click(within(confirmation).getByRole("button", { name: t.cancelLabel }));
    expect(useLrcStore.getState().doc).toBe(doc);

    fireEvent.click(screen.getByRole("button", { name: t.saveAs }));
    fireEvent.click(await screen.findByRole("button", { name: /LRC/ }));
    confirmation = await screen.findByRole("dialog", { name: t.srtOnlyDataLossTitle });
    fireEvent.click(within(confirmation).getByRole("button", { name: t.srtOnlyDataLossConfirm }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({
      path: "/exports/styled.lrc",
      content: expect.stringContaining("styled"),
    })));
    const write = vi.mocked(invoke).mock.calls.find(([command]) => command === "write_lrc_file");
    expect((write?.[1] as { content: string }).content).not.toContain("<b>");
    expect(useLrcStore.getState().doc.lines[0].srtInlineFormatting).toBeUndefined();
  });

  it.each([
    ["Unsupported lyric encoding: UTF-16 is not supported", "unsupportedLyricEncoding"],
    ["LYRIC_RESOURCE_LIMIT", "lyricFileTooLarge"],
  ] as const)("shows actionable lyric-read feedback for %s", async (error, messageKey) => {
    existingPair(false);
    const originalDoc = useLrcStore.getState().doc;
    vi.mocked(invoke).mockImplementation((command) => command === "read_lrc_file"
      ? Promise.reject(error) : Promise.resolve(null));
    render(<App />);
    drop(["/incoming.lrc"]);

    const t = useI18nStore.getState().t;
    const confirmation = await screen.findByRole("dialog", { name: t.drop.replaceTitle });
    fireEvent.click(within(confirmation).getByRole("button", { name: t.drop.replaceOk }));
    await screen.findByText(t.toast[messageKey]);
    expect(useLrcStore.getState().doc).toBe(originalDoc);
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
  });

  it("reports a failed save separately and preserves the dirty document during replacement", async () => {
    existingPair(true);
    const originalDoc = useLrcStore.getState().doc;
    vi.mocked(invoke).mockImplementation((command) => command === "write_lrc_file"
      ? Promise.reject("simulated disk write failure")
      : command === "read_lrc_file" ? Promise.resolve("[00:03.00]Incoming lyric") : Promise.resolve(null));
    render(<App />);
    drop(["/incoming.lrc"]);

    const t = useI18nStore.getState().t;
    const confirmation = await screen.findByRole("dialog", { name: t.replaceDocumentTitle });
    fireEvent.click(within(confirmation).getByRole("button", { name: t.save }));

    await screen.findByText(t.toast.saveFailed);
    expect(useLrcStore.getState().doc).toBe(originalDoc);
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("keeps serialization errors distinct from replacement read failures", async () => {
    existingPair(true);
    const originalDoc = useLrcStore.getState().doc;
    useLrcStore.setState({
      lrcPath: "/old.srt",
      doc: { ...originalDoc, metadata: { ...originalDoc.metadata, title: "Song metadata" } },
    });
    const docWithMetadata = useLrcStore.getState().doc;
    render(<App />);
    drop(["/incoming.lrc"]);

    const t = useI18nStore.getState().t;
    const confirmation = await screen.findByRole("dialog", { name: t.replaceDocumentTitle });
    fireEvent.click(within(confirmation).getByRole("button", { name: t.save }));

    await screen.findByText(t.toast.srtLossyDocument);
    expect(useLrcStore.getState().doc).toBe(docWithMetadata);
    expect(useLrcStore.getState().lrcPath).toBe("/old.srt");
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "write_lrc_file")).toBe(false);
  });

  it("explains when a bookmarked lyric file changes format and leaves it unsaved", async () => {
    useLrcStore.setState({ lrcPath: "/old/song.lrc", lrcBookmark: "old", isDirty: true });
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "prepare_file_ref") return Promise.resolve({ path: "/moved/song.srt", bookmark: "fresh" });
      return Promise.resolve(null);
    });
    const t = useI18nStore.getState().t;
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: t.save }));

    await waitFor(() => expect(screen.getByText(t.toast.saveFormatChanged)).toBeTruthy());
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(useLrcStore.getState().lrcPath).toBe("/old/song.lrc");
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "write_lrc_file")).toBe(false);
  });

  it.each(["lyrics", "both"] as const)("uses only the unsaved-document guard for dirty %s drop and preserves Cancel", async (kind) => {
    existingPair(true);
    render(<App />);
    drop([...incoming[kind]]);
    const t = useI18nStore.getState().t;
    const modal = await screen.findByRole("dialog", { name: t.replaceDocumentTitle });
    expect(screen.queryByRole("dialog", { name: t.drop.replaceTitle })).toBeNull();
    fireEvent.click(within(modal).getByRole("button", { name: t.confirmNewCancel }));
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Original lyric");
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
    expect(useLrcStore.getState().audioPath).toBe("/old.mp3");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it.each(["lyrics", "both"] as const)("applies a dirty %s drop only after explicitly discarding unsaved lyrics", async (kind) => {
    existingPair(true);
    render(<App />);
    drop([...incoming[kind]]);
    const t = useI18nStore.getState().t;
    const modal = await screen.findByRole("dialog", { name: t.replaceDocumentTitle });
    fireEvent.click(within(modal).getByRole("button", { name: t.discardChanges }));
    await waitFor(() => expect(useLrcStore.getState().lrcPath).toBe("/new.lrc"));
    expect(useLrcStore.getState().audioPath).toBe(kind === "both" ? "/new.mp3" : "/old.mp3");
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Incoming lyric");
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(screen.queryByRole("dialog", { name: t.drop.replaceTitle })).toBeNull();
  });

  it("audio-only replacement preserves a dirty lyric draft after confirmation", async () => {
    existingPair(true);
    const originalDoc = useLrcStore.getState().doc;
    render(<App />);
    drop([...incoming.audio]);
    const t = useI18nStore.getState().t;
    const modal = await screen.findByRole("dialog", { name: t.drop.replaceTitle });
    fireEvent.click(within(modal).getByRole("button", { name: t.drop.replaceOk }));
    await waitFor(() => expect(useLrcStore.getState().audioPath).toBe("/new.mp3"));
    expect(useLrcStore.getState().doc).toBe(originalDoc);
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(screen.queryByRole("dialog", { name: t.replaceDocumentTitle })).toBeNull();
  });

  it("audio-only replacement cancellation keeps the dirty lyric and original audio", async () => {
    existingPair(true);
    const originalDoc = useLrcStore.getState().doc;
    render(<App />);
    drop([...incoming.audio]);
    const t = useI18nStore.getState().t;
    const modal = await screen.findByRole("dialog", { name: t.drop.replaceTitle });
    fireEvent.click(within(modal).getByRole("button", { name: t.drop.replaceCancel }));
    expect(useLrcStore.getState().doc).toBe(originalDoc);
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(useLrcStore.getState().audioPath).toBe("/old.mp3");
    expect(useLrcStore.getState().lrcPath).toBe("/old.lrc");
  });

  // Scope confirmation actions to the modal when toolbar labels overlap.
  it("keeps unsaved lyrics when new-document confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const t = useI18nStore.getState().t;
    render(<App />);

    await user.click(screen.getByText(t.newFileBtn).parentElement!.parentElement!.querySelector("button")!);
    expect(screen.getByText(t.confirmNewMessage)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.confirmNewCancel }));

    expect(screen.queryByText(t.confirmNewMessage)).toBeNull();
    expect(useLrcStore.getState().doc.lines).toEqual([
      { id: "draft", text: "Keep this draft", timestamp: null },
    ]);
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("clears the draft only after new-document confirmation is accepted", async () => {
    const user = userEvent.setup();
    const t = useI18nStore.getState().t;
    render(<App />);

    await user.click(screen.getByText(t.newFileBtn).parentElement!.parentElement!.querySelector("button")!);
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Keep this draft");
    await user.click(screen.getByRole("button", { name: t.discardChanges }));

    expect(useLrcStore.getState().doc.lines).toEqual([]);
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("leaves Space in a text input available for text editing without stamping", () => {
    render(<App />);
    const input = screen.getAllByRole("textbox")[0];
    input.focus();
    const event = new KeyboardEvent("keydown", {
      code: "Space", key: " ", bubbles: true, cancelable: true,
    });
    fireEvent(input, event);

    expect(event.defaultPrevented).toBe(false);
    expect(useLrcStore.getState().activeLineId).toBeNull();
    expect(useLrcStore.getState().doc.lines[0].timestamp).toBeNull();
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });
  it("preserves recovered lyrics but requires reselection after an invalid grant", async () => {
    const user = userEvent.setup();
    const doc = { ...defaultDocument(), lines: [{ id: "recovered", text: "Recovered draft", timestamp: null }] };
    useLrcStore.setState({ isDirty: false });
    saveRecoverySnapshot(doc, "/old/song.lrc", null, "invalid", null);
    vi.mocked(invoke).mockRejectedValue(new Error("Select the file again"));
    render(<App />);
    await user.click(await screen.findByRole("button", { name: useI18nStore.getState().t.recovery.restore }));
    expect(useLrcStore.getState().doc.lines.map(({ text, timestamp }) => ({ text, timestamp })))
      .toEqual(doc.lines.map(({ text, timestamp }) => ({ text, timestamp })));
    expect(useLrcStore.getState().lrcPath).toBeNull();
    expect(useLrcStore.getState().lrcBookmark).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("prepare_file_ref", { path: "/old/song.lrc", bookmark: "invalid" });
  });

  it("keeps the draft when Save before replacement is cancelled", async () => {
    const user = userEvent.setup();
    const t = useI18nStore.getState().t;
    vi.mocked(save).mockResolvedValue(null);
    render(<App />);
    await user.click(screen.getByText(t.newFileBtn).parentElement!.parentElement!.querySelector("button")!);
    await user.click(within(screen.getByText(t.replaceDocumentTitle).parentElement!.parentElement!).getByRole("button", { name: t.save }));
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Keep this draft");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });

  it("asks again when edits occur during replacement confirmation", async () => {
    const user = userEvent.setup();
    const t = useI18nStore.getState().t;
    render(<App />);
    await user.click(screen.getByText(t.newFileBtn).parentElement!.parentElement!.querySelector("button")!);
    useLrcStore.getState().setMetadata({ title: "New edit" });
    await user.click(screen.getByRole("button", { name: t.discardChanges }));
    await waitFor(() => expect(screen.getByRole("button", { name: t.discardChanges })).toBeTruthy());
    expect(useLrcStore.getState().doc.metadata.title).toBe("New edit");
    await user.click(screen.getByRole("button", { name: t.confirmNewCancel }));
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Keep this draft");
  });

  it("closes an old save-format choice when another document is applied", async () => {
    const user = userEvent.setup();
    const t = useI18nStore.getState().t;
    useLrcStore.setState({ isDirty: false });
    render(<App />);
    await user.click(screen.getByText(t.save).parentElement!.parentElement!.querySelector("button")!);
    expect(screen.getByText(t.saveFormatTitle)).toBeTruthy();
    await act(async () => { await useLrcStore.getState().newLrc(); });
    expect(screen.queryByText(t.saveFormatTitle)).toBeNull();
  });

  it.each(["button", "slider", "link", "select", "editable"])("protects Space, transport and undo on a focused %s", (kind) => {
    const before = useLrcStore.getState().doc;
    useLrcStore.setState({ activeLineId: "draft", _history: [defaultDocument()] });
    const toggle = vi.spyOn(audioControls, "togglePlay");
    render(<App />);
    const node = document.createElement(kind === "button" ? "button" : kind === "link" ? "a" : kind === "select" ? "select" : "div");
    node.tabIndex = 0;
    if (kind === "link") node.setAttribute("href", "#");
    if (kind === "slider") node.setAttribute("role", "slider");
    if (kind === "editable") node.setAttribute("contenteditable", "true");
    const child = document.createElement("span"); node.append(child);
    node.setAttribute("data-test-control", "");
    document.body.append(node); node.focus();
    for (const target of [child, window]) for (const code of ["Space", "Digit3", "KeyZ"]) {
      const event = new KeyboardEvent("keydown", { code, ctrlKey: code === "KeyZ", bubbles: true, cancelable: true });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(useLrcStore.getState().doc).toBe(before);
    expect(useLrcStore.getState()._history).toHaveLength(1);
    expect(toggle).not.toHaveBeenCalled();
    node.remove();
  });

  it("continues stamping successive lines from the noninteractive editor area", () => {
    useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
      { id: "a", text: "a", timestamp: null }, { id: "b", text: "b", timestamp: null }, { id: "c", text: "c", timestamp: null },
    ] }, activeLineId: "a" });
    render(<App />);
    fireEvent.keyDown(window, { code: "Space" });
    act(() => useLrcStore.setState({ currentTime: 13 }));
    fireEvent.keyDown(window, { code: "Space" });
    expect(useLrcStore.getState().doc.lines.map((line) => line.timestamp)).toEqual([12, 13, null]);
    expect(useLrcStore.getState().activeLineId).toBe("c");
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])("does not stamp while IME composition owns the key (%j)", (composition) => {
    useLrcStore.setState({ activeLineId: "draft" });
    render(<App />);
    const original = structuredClone(useLrcStore.getState().doc.lines);
    fireEvent.keyDown(window, { code: "Space", ...composition });
    expect(useLrcStore.getState().doc.lines).toEqual(original);
  });

  it("ignores shifted custom bindings while preserving Ctrl+Shift+Z redo", () => {
    useLrcStore.setState({ activeLineId: "draft" });
    render(<App />);
    fireEvent.keyDown(window, { code: "Space", shiftKey: true });
    expect(useLrcStore.getState().doc.lines[0].timestamp).toBeNull();
    useSettingsStore.getState().setKeybinding("stamp", "KeyT");
    fireEvent.keyDown(window, { code: "KeyT", shiftKey: true });
    expect(useLrcStore.getState().doc.lines[0].timestamp).toBeNull();

    useLrcStore.getState().updateLine("draft", { text: "edited" });
    fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true });
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Keep this draft");
    fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true, shiftKey: true });
    expect(useLrcStore.getState().doc.lines[0].text).toBe("edited");
  });

});


describe("Store shared recovery and error regression coverage", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useSettingsStore.setState({ autoSave: false, recoveryEnabled: true });
    useSettingsPersistenceStore.setState({ failureCount: 0 });
    useLrcStore.setState({ doc: defaultDocument(), isDirty: false, lrcPath: null, audioPath: null, lrcBookmark: null, audioBookmark: null, _history: [], _future: [] });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
  it("offers metadata-only recovery and keeps it across remount before deciding", async () => {
    const doc = defaultDocument(); doc.metadata.title = "metadata-only draft";
    saveRecoverySnapshot(doc, null, null);
    const first = render(<App />);
    expect(await screen.findByRole("button", { name: useI18nStore.getState().t.recovery.restore })).toBeTruthy();
    first.unmount();
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: useI18nStore.getState().t.recovery.restore }));
    await waitFor(() => expect(useLrcStore.getState().doc.metadata.title).toBe("metadata-only draft"));
    expect(useLrcStore.getState().isDirty).toBe(true);
  });
  it("keeps recovery open and stored when discard cannot remove its snapshot", async () => {
    const draft = { ...defaultDocument(), metadata: { ...defaultDocument().metadata, title: "preserve this draft" } };
    saveRecoverySnapshot(draft, null, null);
    const storedSnapshot = localStorage.getItem("lyrical-sync-recovery");
    const originalRemove = localStorage.removeItem;
    localStorage.removeItem = () => { throw new Error("storage unavailable"); };
    render(<App />);
    const t = useI18nStore.getState().t;

    fireEvent.click(await screen.findByRole("button", { name: t.recovery.discard }));

    expect(await screen.findByText(t.recovery.storageFailed)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(localStorage.getItem("lyrical-sync-recovery")).toBe(storedSnapshot);

    localStorage.removeItem = originalRemove;
    fireEvent.click(screen.getByRole("button", { name: t.recovery.discard }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem("lyrical-sync-recovery")).toBeNull();
  });
  it("shows a localized error when saving settings to local storage fails", async () => {
    render(<App />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });

    act(() => useSettingsStore.getState().setUiScale(1.1));

    expect(useSettingsStore.getState().uiScale).toBe(1.1);
    expect(await screen.findByText(useI18nStore.getState().t.toast.settingsSaveFailed)).toBeTruthy();
    expect(useLrcStore.getState().isDirty).toBe(false);
  });

  it("keeps the current document editable after a background error", () => {
    render(<App />);
    act(() => useLrcStore.getState().addLine("saved from runtime error"));
    fireEvent(window, new CustomEvent("lyrical-runtime-error", { detail: "background failure" }));
    expect(screen.getByText(useI18nStore.getState().t.toast.runtimeFailed)).toBeTruthy();
    expect(useLrcStore.getState().doc.lines[0].text).toBe("saved from runtime error");
    expect(useLrcStore.getState().isDirty).toBe(true);
  });
});

describe("App save permission guidance", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ autoSave: false, recentFiles: [] });
    useLrcStore.setState({
      doc: { ...defaultDocument(), lines: [{ id: "line", timestamp: 1, text: "Keep these bytes" }] },
      lrcPath: "/restricted/song.lrc", lrcBookmark: null, isDirty: true,
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows localized folder-write guidance for an atomic-stage permission failure", async () => {
    vi.mocked(invoke).mockImplementation((command) => command === "write_lrc_file"
      ? Promise.reject(new Error("ATOMIC_STAGE_PERMISSION_DENIED: Permission denied"))
      : Promise.resolve(undefined));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.save }));

    expect(await screen.findByText("This folder does not allow the temporary file needed for a safe save. Grant write access to the folder or use Save As to choose a writable location.")).toBeTruthy();
    expect(useLrcStore.getState().isDirty).toBe(true);
    expect(useLrcStore.getState().doc.lines[0].text).toBe("Keep these bytes");
  });
});
