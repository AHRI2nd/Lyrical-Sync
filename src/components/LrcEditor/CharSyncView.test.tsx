// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePointerScrub } from "../../hooks/usePointerScrub";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { CharSyncView } from "./CharSyncView";
import { useLrcStore } from "../../stores/useLrcStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { translations } from "../../i18n/translations";
import { DEFAULT_KEYBINDINGS } from "../../utils/keybindings";
import { audioControls } from "../../utils/audioControls";
import { defaultDocument } from "../../types/lrc";

const originalLanguage = useI18nStore.getState();
if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; isPrimary = true;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
  localStorage.clear();
  useSettingsStore.setState({ keybindings: { ...DEFAULT_KEYBINDINGS }, showGlyphTimeMarkers: false, glyphWaveformHeight: 144, glyphWaveformStyle: "continuous" });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "abc", timestamp: 0 }] },
    activeLineId: "a", activeSyllableIndex: 0, syncMode: "char", syncUnit: "char", currentTime: 12,
    isPlaying: false, isDirty: false, audioPath: null, duration: 0, _history: [], _future: [] });
  useLrcStore.setState({ loopLineId: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll("[data-test-control]").forEach((node) => node.remove()); localStorage.clear(); useI18nStore.setState(originalLanguage); });

it("keeps unrelated line buttons memoized during playback updates", () => {
  const otherLine = { id: "b", timestamp: 20, get text() { return "next"; } };
  const readOtherText = vi.spyOn(otherLine, "text", "get");
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", timestamp: 0, text: "hello" }, otherLine,
  ] } });
  render(<CharSyncView />);
  readOtherText.mockClear();
  act(() => useLrcStore.setState({ currentTime: 13 }));
  expect(readOtherText).not.toHaveBeenCalled();
});

it("notifies scrub start only once per accepted pointer and never on cancellation", () => {
  const onStart = vi.fn();
  const onCommit = vi.fn();
  const lane = document.createElement("div");
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  const { result, rerender, unmount } = renderHook(({ contextKey, enabled }) => usePointerScrub({
    contextKey, enabled, start: 0, end: 10, onStart, onCommit,
  }), { initialProps: { contextKey: "a", enabled: true } });
  const start = () => act(() => result.current.begin({
    button: 0, pointerId: 1, isPrimary: true, defaultPrevented: false, clientX: 20,
    target: lane, currentTarget: lane, preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>));
  start(); start();
  expect(onStart).toHaveBeenCalledTimes(1);
  fireEvent.pointerCancel(window, { pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onCommit).not.toHaveBeenCalled();
  start();
  rerender({ contextKey: "b", enabled: false });
  start();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onStart).toHaveBeenCalledTimes(2);
  expect(onCommit).not.toHaveBeenCalled();
  unmount();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onStart).toHaveBeenCalledTimes(2);
});

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

it.each(["ko", "en", "ja"] as const)("uses the configured stamp key in the %s typing button and glyph stamping", (lang) => {
  useI18nStore.setState({ lang, t: translations[lang] });
  useSettingsStore.setState({ keybindings: { ...DEFAULT_KEYBINDINGS, stamp: "KeyS" } });
  const { container } = render(<CharSyncView />);
  expect(container.querySelector("kbd")?.textContent).toBe("S");
  expect(container.querySelector("details")).toBeNull();
  fireEvent.keyDown(window, { code: "KeyS" });
  expect(useLrcStore.getState().doc.lines[0].syllables?.[0].time).toBe(12);
});


it("freezes the lane viewport while previewing and seeks only on release", () => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3", currentTime: 2 });
  const seek = vi.spyOn(audioControls, "seekTo");
  const { container, getByText } = render(<CharSyncView />);
  fireEvent.click(getByText("+"));
  const lane = container.querySelector('[data-testid="glyph-seek-lane"]')!;
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  fireEvent.pointerDown(lane, { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 50 });
  act(() => useLrcStore.setState({ currentTime: 60 }));
  expect(seek).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 75 });
  expect(seek.mock.calls).toEqual([[3]]);
});
it("cancels lane scrubbing on audio selection and zoom changes", () => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3" });
  const seek = vi.spyOn(audioControls, "seekTo");
  const { container, getByText } = render(<CharSyncView />);
  const lane = container.querySelector('[data-testid="glyph-seek-lane"]')!;
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  fireEvent.pointerDown(lane, { pointerId: 1, button: 0, clientX: 20 });
  act(() => useLrcStore.setState({ _audioSelection: useLrcStore.getState()._audioSelection + 1 }));
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 75 });
  fireEvent.pointerDown(lane, { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.click(getByText("+"));
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 75 });
  expect(seek).not.toHaveBeenCalled();
});
it.each([{ isComposing: true }, { keyCode: 229 }])("does not stamp or advance during IME composition (%j)", (composition) => {
  render(<CharSyncView />);
  fireEvent.keyDown(window, { code: "Space", ...composition });
  fireEvent.keyDown(window, { code: "ArrowRight", ...composition });
  expect(useLrcStore.getState().doc.lines[0].syllables).toBeUndefined();
  expect(useLrcStore.getState().activeSyllableIndex).toBe(0);
});

it("stamps by clicking the real control and keeps the viewport span stable after a stamp", () => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3" });
  const { getByRole, getByTestId } = render(<CharSyncView />);
  const lane = getByTestId("glyph-seek-lane");
  const before = Number(lane.dataset.end) - Number(lane.dataset.start);
  const button = getByRole("button", { name: translations.en.charSync.stampHint });
  button.focus(); fireEvent.click(button);
  expect(useLrcStore.getState().doc.lines[0].syllables?.[0].time).toBe(12);
  expect(useLrcStore.getState().activeSyllableIndex).toBe(1);
  expect(Number(lane.dataset.end) - Number(lane.dataset.start)).toBe(before);
  act(() => useLrcStore.setState({ currentTime: 13 }));
  fireEvent.keyDown(window, { code: "Space" });
  expect(useLrcStore.getState().doc.lines[0].syllables?.[1].time).toBe(13);
});

it("keeps the following playhead centered and lets manual viewport navigation stay detached", () => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3", isPlaying: true, currentTime: 12 });
  const { getByRole, getByTestId } = render(<CharSyncView />);
  const lane = getByTestId("glyph-seek-lane");
  expect(Number(lane.dataset.start)).toBe(8);
  act(() => useLrcStore.setState({ currentTime: 13 }));
  expect(Number(lane.dataset.start)).toBe(9);
  expect(getByTestId("glyph-playhead").style.left).toBe("50%");
  fireEvent.click(getByRole("button", { name: /다음 시간 구간|Next time window/ }));
  const frozen = lane.dataset.start;
  act(() => useLrcStore.setState({ currentTime: 14 }));
  expect(lane.dataset.start).toBe(frozen);
  fireEvent.click(getByRole("button", { name: /재생 위치 따라가기|Follow playback/ }));
  expect(Number(lane.dataset.start)).toBe(10);
});

it.each([
  { input: "click", startX: 75, endX: 75 },
  { input: "drag", startX: 20, endX: 75 },
])("keeps playback following disabled after a waveform $input seek", ({ startX, endX }) => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3", isPlaying: true, currentTime: 12 });
  const seek = vi.spyOn(audioControls, "seekTo").mockImplementation(time => useLrcStore.setState({ currentTime: time }));
  const { getByRole, getByTestId } = render(<CharSyncView />);
  const lane = getByTestId("glyph-seek-lane");
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  const follow = getByRole("button", { name: /재생 위치 따라가기|Follow playback/ });

  fireEvent.click(follow);
  expect(follow.getAttribute("aria-pressed")).toBe("false");
  fireEvent.pointerDown(lane, { pointerId: 1, button: 0, clientX: startX });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: endX });
  expect(seek).toHaveBeenCalledWith(14);
  expect(follow.getAttribute("aria-pressed")).toBe("false");
  expect(Number(lane.dataset.start)).toBe(10);

  act(() => useLrcStore.setState({ currentTime: 14.5 }));
  expect(Number(lane.dataset.start)).toBe(10);
  fireEvent.click(follow);
  expect(follow.getAttribute("aria-pressed")).toBe("true");
  expect(Number(lane.dataset.start)).toBe(10.5);
  expect(getByTestId("glyph-playhead").style.left).toBe("50%");
});

it("updates the actual waveform height and style from the view menu and dismisses it with Escape", () => {
  const { getByRole, getByTestId } = render(<CharSyncView />);
  const menu = getByRole("button", { name: translations.en.charSync.waveformView });
  fireEvent.click(menu);
  fireEvent.change(getByRole("slider", { name: translations.en.charSync.waveformHeight }), { target: { value: "208" } });
  expect(getByTestId("glyph-seek-lane").style.height).toBe("208px");
  fireEvent.change(getByRole("combobox"), { target: { value: "bars" } });
  expect(useSettingsStore.getState().glyphWaveformStyle).toBe("bars");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
});

it("shows a valid line repeat beside replay without starting playback and clears it on selection changes", () => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3", doc: { ...defaultDocument(), lines: [
    { id: "a", text: "abc", timestamp: 10 }, { id: "b", text: "next", timestamp: 20 },
  ] } });
  const seek = vi.spyOn(audioControls, "seekTo");
  const { getByRole, getByTestId } = render(<CharSyncView />);
  const repeat = getByRole("button", { name: /줄 반복|Repeat line/ });
  fireEvent.click(repeat);
  expect(repeat.getAttribute("aria-pressed")).toBe("true");
  expect(seek).toHaveBeenCalledWith(10);
  expect(useLrcStore.getState().isPlaying).toBe(false);
  expect(getByTestId("glyph-line-region").getAttribute("data-repeating")).toBe("true");
  act(() => useLrcStore.setState({ activeLineId: "b" }));
  expect(useLrcStore.getState().loopLineId).toBeNull();
});

it.each(["replay", "nudge"])("restores waveform following for explicit %s after manual navigation", action => {
  useLrcStore.setState({ duration: 100, audioPath: "/song.mp3", currentTime: 12, doc: { ...defaultDocument(), lines: [
    { id: "a", text: "ab", timestamp: 10, syllables: [{ text: "a", time: 10 }, { text: "b", time: 12 }] },
    { id: "b", text: "next", timestamp: 20 },
  ] } });
  vi.spyOn(audioControls, "seekTo").mockImplementation(time => useLrcStore.setState({ currentTime: time }));
  const { getByRole, getByTestId } = render(<CharSyncView />);
  const pan = getByRole("button", { name: /다음 시간 구간|Next time window/ });
  fireEvent.click(pan); fireEvent.click(pan); fireEvent.click(pan);
  if (action === "replay") fireEvent.click(getByRole("button", { name: /이 줄 재생|Play line/ }));
  else {
    act(() => useLrcStore.setState({ activeSyllableIndex: 1 }));
    fireEvent.keyDown(window, { code: "ArrowRight", shiftKey: true });
  }
  expect(getByRole("button", { name: /재생 위치 따라가기|Follow playback/ }).getAttribute("aria-pressed")).toBe("true");
  expect(getByTestId("glyph-playhead").style.left).toBe("50%");
});

it("starts painting vertically in wrapped lyrics without seeking", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "a".repeat(80), timestamp: 0 }] } });
  const seek = vi.spyOn(audioControls, "seekTo");
  const { container } = render(<CharSyncView />);
  fireEvent.mouseDown(container.querySelector('[data-glyph="0"]')!, { button: 0, clientX: 100, clientY: 10 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 100, clientY: 40 });
  fireEvent.mouseUp(window);
  expect(useLrcStore.getState().doc.lines[0].syllables?.[0].time).toBe(12);
  expect(useLrcStore.getState().activeSyllableIndex).toBe(1);
  expect(seek).not.toHaveBeenCalled();
});
it.each(["window blur", "buttons=0 movement", "document replacement", "active line change"])("cancels a glyph gesture after %s", (reason) => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "abc", timestamp: 0 }] } });
  const { container } = render(<CharSyncView />);
  const first = container.querySelector('[data-glyph="0"]')!;
  fireEvent.mouseDown(first, { button: 0, buttons: 1, clientX: 10, clientY: 10 });
  if (reason === "window blur") fireEvent.blur(window);
  else if (reason === "buttons=0 movement") fireEvent.mouseMove(window, { buttons: 0, clientX: 30, clientY: 30 });
  else if (reason === "document replacement") act(() => useLrcStore.setState({ _documentSession: useLrcStore.getState()._documentSession + 1 }));
  else act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [
      { id: "a", text: "abc", timestamp: 0 }, { id: "b", text: "new active row", timestamp: 1 },
    ] },
    activeLineId: "b",
  }));
  fireEvent.mouseMove(window, { buttons: 1, clientX: 40, clientY: 40 });
  expect(useLrcStore.getState().doc.lines.every((line) => line.syllables === undefined)).toBe(true);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});
it("starts a second seek in the still-visible pending viewport", () => {
  useLrcStore.setState({ duration:100, audioPath:'/song.mp3', currentTime:12 });
  const seek=vi.spyOn(audioControls,'seekTo');
  const {getByRole,getByTestId}=render(<CharSyncView />);
  fireEvent.click(getByRole('button',{name:/다음 시간 구간|Next time window/}));
  const lane=getByTestId('glyph-seek-lane');
  vi.spyOn(lane,'getBoundingClientRect').mockReturnValue({left:0,width:100} as DOMRect);
  const start=Number(lane.dataset.start),end=Number(lane.dataset.end);
  fireEvent.pointerDown(lane,{pointerId:1,button:0,clientX:20}); fireEvent.pointerUp(window,{pointerId:1,clientX:20});
  expect(Number(lane.dataset.start)).toBe(start);
  fireEvent.pointerDown(lane,{pointerId:2,button:0,clientX:75}); fireEvent.pointerUp(window,{pointerId:2,clientX:75});
  expect(seek.mock.calls[1][0]).toBeCloseTo(start+(end-start)*.75);
});

it("opens shortcut settings from the header", () => {
  const onOpenShortcuts = vi.fn();
  const view = render(<CharSyncView onOpenShortcuts={onOpenShortcuts} />);
  fireEvent.click(view.getByRole("button",{name:useI18nStore.getState().t.charSync.shortcuts}));
  expect(onOpenShortcuts).toHaveBeenCalledOnce();
  expect(view.container.querySelector("details")).toBeNull();
});
