// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { CharSyncView } from "./CharSyncView";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { translations } from "../../i18n/translations";
import { DEFAULT_KEYBINDINGS } from "../../utils/keybindings";
import { defaultDocument } from "../../types/lrc";

const originalLanguage = useI18nStore.getState();
beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ keybindings: { ...DEFAULT_KEYBINDINGS }, showGlyphTimeMarkers: false });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "abc", timestamp: 0 }] },
    activeLineId: "a", activeSyllableIndex: 0, syncMode: "char", syncUnit: "char", currentTime: 12,
    isPlaying: false, isDirty: false, audioPath: null, duration: 0, _history: [], _future: [] });
});
afterEach(() => { cleanup(); document.querySelectorAll("[data-test-control]").forEach((node) => node.remove()); localStorage.clear(); useI18nStore.setState(originalLanguage); });

it.each(["button", "slider", "link", "select", "editable"])("leaves glyph shortcuts with a focused %s", (kind) => {
  render(<CharSyncView />);
  const node = document.createElement(kind === "button" ? "button" : kind === "link" ? "a" : kind === "select" ? "select" : "div");
  node.tabIndex = 0;
  if (kind === "link") node.setAttribute("href", "#");
  if (kind === "slider") node.setAttribute("role", "slider");
  if (kind === "editable") node.setAttribute("contenteditable", "true");
  const child = document.createElement("span"); node.append(child);
  node.setAttribute("data-test-control", "");
  document.body.append(node); node.focus();
  for (const target of [child, window]) for (const code of ["Space", "ArrowRight", "Backspace"]) {
    const event = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
    fireEvent(target, event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(useLrcStore.getState().doc.lines[0].syllables).toBeUndefined();
  expect(useLrcStore.getState().activeSyllableIndex).toBe(0);
  node.remove();
});

it("resumes consecutive glyph stamps after returning from a button to the glyph text", () => {
  const { container } = render(<CharSyncView />);
  const button = container.querySelectorAll("button")[1]; button.focus();
  fireEvent.mouseDown(container.querySelector('[data-glyph="0"]')!, { button: 0 });
  fireEvent.mouseUp(window);
  fireEvent.keyDown(window, { code: "Space" });
  act(() => useLrcStore.setState({ currentTime: 13 }));
  fireEvent.keyDown(window, { code: "Space" });
  expect(useLrcStore.getState().doc.lines[0].syllables?.map((token) => token.time)).toEqual([12, 13, null]);
});

it.each(["ko", "en", "ja"] as const)("uses the configured stamp key in %s hints and glyph stamping", (lang) => {
  useI18nStore.setState({ lang, t: translations[lang] });
  useSettingsStore.setState({ keybindings: { ...DEFAULT_KEYBINDINGS, stamp: "KeyS" } });
  const { container } = render(<CharSyncView />);
  expect(container.querySelector("kbd")?.textContent).toBe("S");
  expect(container.querySelector("p")?.textContent).toContain("S=");
  fireEvent.keyDown(window, { code: "KeyS" });
  expect(useLrcStore.getState().doc.lines[0].syllables?.[0].time).toBe(12);
});
