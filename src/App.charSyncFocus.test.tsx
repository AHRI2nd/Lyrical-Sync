// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    spotifyMode: false, deviceMode: false, showGlyphTimeMarkers: false,
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
  const dot = await screen.findByRole("button", { name: "2. def uvw" });
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
});
