// @vitest-environment jsdom
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../utils/audioControls", () => ({ audioControls: {
  togglePlay: vi.fn(), pause: vi.fn(), skip: vi.fn(), stopAndReset: vi.fn(), seekTo: vi.fn(), getPeaks: () => null,
} }));
import { PreviewModal } from "./PreviewModal";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";
import { audioControls } from "../../utils/audioControls";
beforeEach(() => {
  vi.clearAllMocks();
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

it("uses an explicit SRT cue end for karaoke progress", () => {
  useLrcStore.setState({ currentTime: 8, duration: 30, doc: { ...defaultDocument(), lines: [
    { id: "srt", text: "AB", timestamp: 1, srtEndTime: 10, syllables: [{ text: "A", time: 1 }, { text: "B", time: 6 }] },
  ] } });
  const { getByText } = render(<PreviewModal onClose={() => {}} />);
  expect(getByText("B").style.background).toContain("50%");
});

it("selects the latest timestamp and chronological karaoke end in out-of-order rows", () => {
  useLrcStore.setState({ currentTime: 4, duration: 10, doc: { ...defaultDocument(), lines: [
    { id: "later", text: "later", timestamp: 3, syllables: [{ text: "later", time: 3 }] },
    { id: "earlier", text: "earlier", timestamp: 1 },
  ] } });
  const { getByText } = render(<PreviewModal onClose={() => {}} />);
  expect(getByText("later").closest(".relative")?.querySelector(".absolute")).not.toBeNull();
  expect(getByText("later").style.background).toContain("14.285714285714285%");
});

it("keeps the last document-order row active for equal timestamps", () => {
  useLrcStore.setState({ currentTime: 2, duration: 10, doc: { ...defaultDocument(), lines: [
    { id: "first", text: "first duplicate", timestamp: 2 },
    { id: "last", text: "last duplicate", timestamp: 2 },
  ] } });
  const { getByText } = render(<PreviewModal onClose={() => {}} />);
  expect(getByText("first duplicate").className).not.toContain("relative");
  expect(getByText("last duplicate").className).toContain("relative");
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
  expect(underline.style.backgroundColor).toBe("rgb(0, 255, 0)");
  expect(underline.style.backgroundImage).toBe("");
  expect(underline.style.boxShadow).toBe("");
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
  const { getByRole, queryByRole } = render(<PreviewModal onClose={close} />);
  fireEvent.click(getByRole("button", { name: "0:00:01.000" }));
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
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  fireEvent.keyDown(document.activeElement!, { key: "Escape", keyCode: 229 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});


it("renders translations and multiline originals without guessing or joining text", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", translation: "translated\ncontinued", timestamp: 1 }] } });
  const { container, getByText } = render(<PreviewModal onClose={() => {}} />);
  expect(container.textContent).toContain("translated\ncontinued");
  expect(getByText(/translated/).style.whiteSpace).toBe("pre-wrap");
  expect(getByText(/first/).closest("div")!.style.whiteSpace).toBe("pre-wrap");
});

it("preserves millisecond and submillisecond timestamps on an unchanged preview edit", () => {
  const timestamp = 3602.36912345;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "precise", timestamp }] }, _history: [], _future: [] });
  const original = useLrcStore.getState().doc;
  const { getByRole } = render(<PreviewModal onClose={() => {}} />);
  fireEvent.click(getByRole("button", { name: "1:00:02.369" }));
  fireEvent.blur(getByRole("textbox"));
  expect(useLrcStore.getState().doc).toBe(original);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});

it("does not apply an unfinished preview timestamp edit to a replacement document with the same line id", () => {
  useLrcStore.setState({ _documentSession: 10, doc: { ...defaultDocument(), lines: [{ id: "same", text: "old", timestamp: 1 }] } });
  const { getByRole } = render(<PreviewModal onClose={() => {}} />);
  fireEvent.click(getByRole("button", { name: "0:00:01.000" }));
  const input = getByRole("textbox");
  fireEvent.change(input, { target: { value: "0:00:05.000" } });
  act(() => useLrcStore.setState({ _documentSession: 11, doc: { ...defaultDocument(), lines: [{ id: "same", text: "new", timestamp: 2 }] } }));
  fireEvent.blur(input);
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ id: "same", text: "new", timestamp: 2 });
  expect(useLrcStore.getState()._history).toHaveLength(0);
});

it("names the preview playback control and exposes playback state", async () => {
  const { useI18nStore } = await import("../../stores/useI18nStore");
  const { getByRole } = render(<PreviewModal onClose={() => {}} />);
  const play = getByRole("button", { name: useI18nStore.getState().t.keys.playPause });
  expect(play.getAttribute("aria-pressed")).toBe("false");
  act(() => useLrcStore.setState({ isPlaying: true }));
  expect(play.getAttribute("aria-pressed")).toBe("true");
});

it("exposes the preview timeline as a named slider and clamps keyboard seeking", () => {
  const { getByRole } = render(<PreviewModal onClose={() => {}} />);
  const slider = getByRole("slider", { name: useI18nStore.getState().t.tooltipViewSeekBar });

  expect(slider.getAttribute("aria-orientation")).toBe("horizontal");
  expect(slider.getAttribute("aria-valuemin")).toBe("0");
  expect(slider.getAttribute("aria-valuemax")).toBe("10");
  expect(slider.getAttribute("aria-valuenow")).toBe("1");

  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyDown(slider, { key: "End" });
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyDown(slider, { key: "Home" });
  fireEvent.keyDown(slider, { key: "ArrowLeft" });

  expect(audioControls.seekTo).toHaveBeenNthCalledWith(1, 2);
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(2, 10);
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(3, 10);
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(4, 0);
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(5, 0);
});

it("accumulates repeated arrow seeks while the playback position is unchanged", () => {
  const { getByRole } = render(<PreviewModal onClose={() => {}} />);
  const slider = getByRole("slider", { name: useI18nStore.getState().t.tooltipViewSeekBar });

  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyDown(slider, { key: "ArrowRight" });

  expect(audioControls.seekTo).toHaveBeenNthCalledWith(1, 2);
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(2, 3);
});

it("continues keyboard seeking from a pointer seek and resets the pending target on source change", () => {
  const { getByRole } = render(<PreviewModal onClose={() => {}} />);
  const slider = getByRole("slider", { name: useI18nStore.getState().t.tooltipViewSeekBar });
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 4, width: 100, height: 4, toJSON: () => ({}),
  } as DOMRect);

  fireEvent.click(slider, { clientX: 50 });
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(1, 5);
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(2, 6);

  act(() => useLrcStore.setState({ audioPath: "/replacement.mp3" }));
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(audioControls.seekTo).toHaveBeenNthCalledWith(3, 2);
});

it("makes timestamped lyric rows keyboard-seekable while keeping untimed rows out of the tab order", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "timed", text: "timed lyric", timestamp: 3 },
    { id: "untimed", text: "untimed lyric", timestamp: null },
  ] } });
  const { getByRole, queryByRole } = render(<PreviewModal onClose={() => {}} />);
  const timedRow = getByRole("button", { name: "timed lyric" });

  expect(timedRow.getAttribute("tabindex")).toBe("0");
  expect(queryByRole("button", { name: "untimed lyric" })).toBeNull();
  fireEvent.keyDown(timedRow, { key: "Enter" });

  expect(audioControls.seekTo).toHaveBeenCalledWith(3);
  expect(audioControls.togglePlay).toHaveBeenCalledOnce();
});

it("owns preview focus and leaves composing Escape to the text input method", () => {
  const onClose = vi.fn();
  const { getByRole } = render(<PreviewModal onClose={onClose} />);
  const dialog = getByRole("dialog", { name: "song" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
