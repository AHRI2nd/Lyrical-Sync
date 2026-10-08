// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Native APIs and audio rendering are outside this shell-level DOM test.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("./components/AudioPlayer/AudioPlayer", () => ({ AudioPlayer: () => null }));

import { invoke } from "@tauri-apps/api/core";
import { saveRecoverySnapshot } from "./utils/recovery";
import App from "./App";
import { useLrcStore } from "./stores/useLrcStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useI18nStore } from "./stores/useI18nStore";
import { defaultDocument } from "./types/lrc";

describe("App document confirmation and keyboard boundaries", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useSettingsStore.setState({ autoSave: false, recentFiles: [] });
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
    cleanup();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    localStorage.clear();
  });

  // IconBtn currently renders its label in a separate tooltip, not on the button.
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
    await user.click(screen.getByRole("button", { name: t.confirmNewOk }));

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

});
