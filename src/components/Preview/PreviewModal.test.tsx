// @vitest-environment jsdom
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { PreviewModal } from "./PreviewModal";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useLrcStore.setState({ doc: { ...defaultDocument(), metadata: { ...defaultDocument().metadata, title: "song" },
    lines: [{ id: "a", text: "first", timestamp: 1 }, { id: "b", text: "second", timestamp: 3 }] },
    currentTime: 1, duration: 10, isPlaying: false, audioPath: "/song.mp3" });
});
afterEach(() => { cleanup(); delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView; vi.restoreAllMocks(); });
it("does not rerender for unrelated store changes but reflects document, time and playback", () => {
  const rendered = vi.fn();
  const { container, getByText } = render(<Profiler id="preview" onRender={rendered}><PreviewModal onClose={() => {}} /></Profiler>);
  const initial = rendered.mock.calls.length;
  act(() => useLrcStore.setState({ _audioSelection: useLrcStore.getState()._audioSelection + 1, isDirty: true }));
  expect(rendered.mock.calls.length).toBe(initial);
  act(() => useLrcStore.getState().setMetadata({ title: "changed" }));
  expect(getByText("changed")).toBeTruthy();
  act(() => useLrcStore.setState({ currentTime: 4, isPlaying: true }));
  expect(container.textContent).toContain("0:00:04.000");
  expect(getByText("second").className).toContain("relative");
  expect(container.querySelector('path[d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"]')).not.toBeNull();
});

it("shows empty-audio guidance and removes it when an audio file is selected", () => {
  act(() => useLrcStore.setState({ audioPath: null }));
  const { container } = render(<PreviewModal onClose={() => {}} />);
  expect(container.textContent).toContain(useI18nStore.getState().t.previewNoAudio);
  act(() => useLrcStore.setState({ audioPath: "/song.mp3" }));
  expect(container.textContent).not.toContain(useI18nStore.getState().t.previewNoAudio);
});

it("updates rendered lyric font, active color and accent glow when preview settings change", async () => {
  const { useSettingsStore } = await import("../../stores/useSettingsStore");
  useSettingsStore.setState({ previewFontScale: 1, previewActiveColor: "#ffffff", previewAccentColor: "#6366f1", previewGlowEnabled: true });
  const { getByText } = render(<PreviewModal onClose={() => {}} />);
  act(() => useSettingsStore.setState({ previewFontScale: 1.5, previewActiveColor: "#ff0000", previewAccentColor: "#00ff00" }));
  const lyric = getByText("first").parentElement!;
  expect(lyric.style.fontSize).toBe("2.25rem");
  expect(lyric.parentElement!.style.color).toBe("rgb(255, 0, 0)");
  expect(lyric.style.textShadow).toContain("0, 255, 0");
  const underline = getByText("first").querySelector("span")!;
  expect(underline.style.background).toContain("rgb(0, 255, 0)");
  expect(underline.style.boxShadow).not.toBe("");
  act(() => useSettingsStore.getState().setPreviewGlowEnabled(false));
  expect(lyric.style.textShadow).toBe("");
  expect(underline.style.boxShadow).toBe("");
});

it("uses the selected active color for timed glyph fill", async () => {
  const { useSettingsStore } = await import("../../stores/useSettingsStore");
  useSettingsStore.setState({ previewActiveColor: "#ff8800" });
  useLrcStore.setState({ currentTime: 2, doc: { ...useLrcStore.getState().doc,
    lines: [{ id: "a", text: "AB", timestamp: 1, syllables: [{ text: "A", time: 1 }, { text: "B", time: 3 }] }] } });
  const { getByText } = render(<PreviewModal onClose={() => {}} />);
  expect(getByText("A").style.background).toContain("rgb(255, 136, 0) 50%");
});

it("ignores composition Enter and Escape while editing timestamps", () => {
  const close = vi.fn();
  const { getByText, getByRole, queryByRole } = render(<PreviewModal onClose={close} />);
  fireEvent.click(getByText("00:01.00"));
  const input = getByRole("textbox");
  fireEvent.change(input, { target: { value: "00:02.00" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1);
  expect(queryByRole("textbox")).not.toBeNull();
  fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
  expect(queryByRole("textbox")).not.toBeNull();
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(queryByRole("textbox")).toBeNull();
  expect(close).not.toHaveBeenCalled();
});

it("does not close the preview on composition Escape", () => {
  const close = vi.fn();
  render(<PreviewModal onClose={close} />);
  fireEvent.keyDown(window, { key: "Escape", isComposing: true });
  fireEvent.keyDown(window, { key: "Escape", keyCode: 229 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});


it("renders translations and multiline originals without guessing or joining text", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", translation: "translated\ncontinued", timestamp: 1 }] } });
  const { container, getByText } = render(<PreviewModal onClose={() => {}} />);
  expect(container.textContent).toContain("translated\ncontinued");
  expect(getByText(/translated/).style.whiteSpace).toBe("pre-wrap");
  expect(getByText(/first/).closest("div")!.style.whiteSpace).toBe("pre-wrap");
});
