// @vitest-environment jsdom
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
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
