// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Keep the actual editor and global key handlers connected; only native APIs and audio rendering are stubbed.
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("./hooks/useMacMenu", () => ({ useMacMenu: () => {} }));
vi.mock("./components/AudioPlayer/AudioPlayer", () => ({ AudioPlayer: () => null }));

import App from "./App";
import { useLrcStore } from "./stores/useLrcStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useI18nStore } from "./stores/useI18nStore";
import { translations } from "./i18n/translations";
import { DEFAULT_KEYBINDINGS } from "./utils/keybindings";
import { audioControls } from "./utils/audioControls";
import { defaultDocument } from "./types/lrc";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  localStorage.clear();
  useI18nStore.setState({ lang: "en", t: translations.en });
  useSettingsStore.setState({
    autoSave: false, recentFiles: [], keybindings: { ...DEFAULT_KEYBINDINGS },
    showGlyphTimeMarkers: false,
  });
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [
      { id: "a", text: "abc xyz", timestamp: 0 },
      { id: "b", text: "def uvw", timestamp: 10 },
    ] },
    audioPath: "/synthetic.mp3", lrcPath: null,
    activeLineId: "a", activeSyllableIndex: 0, syncMode: "char", syncUnit: "char",
    currentTime: 2, duration: 60, isPlaying: false, isDirty: false, loopLineId: null,
    _history: [], _future: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  localStorage.clear();
});

async function mountEditor(unit: "char" | "word") {
  useLrcStore.setState({ syncUnit: unit });
  const view = render(<App />);
  const dot = await screen.findByRole("button", { name: "2. def uvw" }, { timeout: 5000 });
  const editor = () => view.container.querySelector("[data-glyph='0']")?.parentElement;
  expect(editor()).toBeTruthy();
  return { ...view, dot, editor };
}

async function seekLane(user: ReturnType<typeof userEvent.setup>) {
  const lane = screen.getByTestId("glyph-seek-lane");
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100, top: 0, height: 100 } as DOMRect);
  await user.pointer([
    { target: lane, keys: "[MouseLeft>]", coords: { clientX: 60, clientY: 20 } },
    { keys: "[/MouseLeft]" },
  ]);
}

describe.each(["char", "word"] as const)("Character sync shortcut focus (%s)", unit => {
  it("resumes playback after pointer line selection", async () => {
    const user = userEvent.setup();
    const toggle = vi.spyOn(audioControls, "togglePlay");
    const { dot, editor } = await mountEditor(unit);
    await user.click(dot);
    expect(useLrcStore.getState().activeLineId).toBe("b");
    await user.keyboard("3");
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor());
  });

  it("resumes playback after waveform seeking from a focused control", async () => {
    const user = userEvent.setup();
    const toggle = vi.spyOn(audioControls, "togglePlay");
    const seek = vi.spyOn(audioControls, "seekTo");
    const { dot, editor } = await mountEditor(unit);
    dot.focus();
    await seekLane(user);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(Number.isFinite(seek.mock.calls[0][0])).toBe(true);
    await user.keyboard("3");
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor());
  });

  it("resumes playback after line selection and waveform seeking", async () => {
    const user = userEvent.setup();
    const toggle = vi.spyOn(audioControls, "togglePlay");
    const seek = vi.spyOn(audioControls, "seekTo");
    const { dot } = await mountEditor(unit);
    await user.click(dot);
    await seekLane(user);
    expect(useLrcStore.getState().activeLineId).toBe("b");
    expect(seek).toHaveBeenCalledTimes(1);
    await user.keyboard("3");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it.each(["1. abc xyz", "2. def uvw", "3. Untimed"])("selects %s without stamping or changing lyrics", async name => {
    useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
      ...useLrcStore.getState().doc.lines, { id: "c", text: "Untimed", timestamp: null },
    ] } });
    const user = userEvent.setup();
    const { editor } = await mountEditor(unit);
    const before = useLrcStore.getState().doc;
    await user.click(screen.getByRole("button", { name }));
    expect(document.activeElement).toBe(editor());
    expect(useLrcStore.getState().doc).toBe(before);
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it.each(["[Numpad3]", "p"])("supports playback key %s after pointer navigation", async key => {
    const user = userEvent.setup();
    const toggle = vi.spyOn(audioControls, "togglePlay");
    if (key === "p") useSettingsStore.setState({ keybindings: { ...DEFAULT_KEYBINDINGS, playPause: "KeyP" } });
    const { dot } = await mountEditor(unit);
    await user.click(dot);
    if (key === "p") {
      await user.keyboard("3");
      expect(toggle).not.toHaveBeenCalled();
    }
    await user.keyboard(key);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("stamps and moves glyph selection once after pointer line selection", async () => {
    const user = userEvent.setup();
    const { dot } = await mountEditor(unit);
    await user.click(dot);
    await user.keyboard(" ");
    expect(useLrcStore.getState().doc.lines[1].syllables?.[0].time).toBe(2);
    expect(useLrcStore.getState()._history).toHaveLength(1);
    const next = useLrcStore.getState().activeSyllableIndex;
    expect(next).toBeGreaterThan(0);
    await user.keyboard("{ArrowLeft}");
    expect(useLrcStore.getState().activeSyllableIndex).toBe(0);
    await user.keyboard("{ArrowRight}");
    expect(useLrcStore.getState().activeSyllableIndex).toBe(next);
    await user.keyboard("{Backspace}");
    expect(useLrcStore.getState().activeSyllableIndex).toBe(0);
    expect(useLrcStore.getState()._history).toHaveLength(1);
  });

  it.each(["{Enter}", " "])("keeps keyboard line navigation focused with %s", async key => {
    const user = userEvent.setup();
    const toggle = vi.spyOn(audioControls, "togglePlay");
    const { dot } = await mountEditor(unit);
    dot.focus();
    await user.keyboard(key);
    expect(useLrcStore.getState().activeLineId).toBe("b");
    expect(document.activeElement).toBe(dot);
    await user.keyboard("3");
    expect(toggle).not.toHaveBeenCalled();
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it("leaves text input and IME keys untouched after editing", async () => {
    const user = userEvent.setup();
    const toggle = vi.spyOn(audioControls, "togglePlay");
    const { dot, editor } = await mountEditor(unit);
    await user.click(dot);
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      fireEvent.keyDown(editor()!, { code: "Digit3", ...init });
      fireEvent.keyDown(editor()!, { code: "Space", ...init });
    }
    expect(toggle).not.toHaveBeenCalled();
    expect(useLrcStore.getState()._history).toHaveLength(0);
    const input = screen.getAllByRole("textbox")[0];
    await user.click(input);
    await user.keyboard("3 ");
    expect(toggle).not.toHaveBeenCalled();
    expect(useLrcStore.getState().doc.lines[1].syllables).toBeUndefined();
    expect(document.activeElement).toBe(input);
    act(() => useLrcStore.setState({ currentTime: 4, activeLineId: "a" }));
    expect(document.activeElement).toBe(input);
  });

  it("does not steal focus from settings during playback or line updates", async () => {
    const user = userEvent.setup();
    const { dot } = await mountEditor(unit);
    await user.click(dot);
    await user.click(screen.getByRole("button", { name: translations.en.settingsTitle }));
    const dialog = await screen.findByRole("dialog", { name: translations.en.settingsTitle });
    const focused = document.activeElement;
    expect(dialog.contains(focused)).toBe(true);
    act(() => useLrcStore.setState({ currentTime: 5, activeLineId: "a" }));
    expect(document.activeElement).toBe(focused);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("does not steal focus back on a cancelled scrub's pointerup", async () => {
    const user = userEvent.setup();
    const seek = vi.spyOn(audioControls, "seekTo");
    const { dot, editor } = await mountEditor(unit);
    dot.focus();
    const lane = screen.getByTestId("glyph-seek-lane");
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
    fireEvent.pointerDown(lane, { pointerId: 5, button: 0, clientX: 20 });
    expect(document.activeElement).toBe(editor());
    fireEvent.pointerCancel(window, { pointerId: 5 });
    const input = screen.getAllByRole("textbox")[0];
    await user.click(input);
    fireEvent.pointerUp(window, { pointerId: 5, clientX: 80 });
    expect(seek).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it.each(["audio", "document", "line", "zoom"])("cancels scrubbing without delayed focus after %s changes", async kind => {
    const seek = vi.spyOn(audioControls, "seekTo");
    await mountEditor(unit);
    const lane = screen.getByTestId("glyph-seek-lane");
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
    fireEvent.pointerDown(lane, { pointerId: 7, button: 0, clientX: 20 });
    act(() => {
      if (kind === "audio") useLrcStore.setState({ audioPath: "/other.mp3" });
      else if (kind === "document") useLrcStore.setState({
        doc: { ...defaultDocument(), lines: [{ id: "new", text: "Replacement", timestamp: 0 }] }, activeLineId: "new",
      });
      else if (kind === "line") useLrcStore.setState({ activeLineId: "b" });
      else fireEvent.click(screen.getByRole("button", { name: `${translations.en.zoom} +` }));
    });
    const input = screen.getAllByRole("textbox")[0];
    input.focus();
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 80 });
    expect(seek).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("keeps confirmation focus during editor updates", async () => {
    const user = userEvent.setup();
    await mountEditor(unit);
    act(() => useLrcStore.setState({ isDirty: true }));
    await user.click(screen.getByRole("button", { name: translations.en.newFileBtn }));
    const dialog = await screen.findByRole("dialog");
    const focused = document.activeElement;
    expect(dialog.contains(focused)).toBe(true);
    act(() => useLrcStore.setState({ currentTime: 5, activeLineId: "b" }));
    expect(document.activeElement).toBe(focused);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it.each(["right button", "secondary pointer", "prevented event", "zero width", "invalid geometry", "no audio"])(
    "leaves focus and playback untouched for %s scrubbing", async kind => {
      const seek = vi.spyOn(audioControls, "seekTo");
      const { dot } = await mountEditor(unit);
      dot.focus();
      if (kind === "no audio") act(() => useLrcStore.setState({ audioPath: null, duration: 0 }));
      const lane = screen.getByTestId("glyph-seek-lane");
      vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: kind === "invalid geometry" ? NaN : 0, width: kind === "zero width" ? 0 : 100 } as DOMRect);
      if (kind === "prevented event") lane.addEventListener("pointerdown", event => event.preventDefault(), { once: true });
      fireEvent.pointerDown(lane, {
        pointerId: 6, button: kind === "right button" ? 2 : 0,
        isPrimary: kind !== "secondary pointer", clientX: 20,
      });
      expect(document.activeElement).toBe(dot);
      fireEvent.pointerUp(window, { pointerId: 6, clientX: 80 });
      expect(seek).not.toHaveBeenCalled();
    },
  );
});
