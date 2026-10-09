// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SeekBar } from "./SeekBar";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100, top: 0, height: 10 } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const props = { position: 10, duration: 100, accentClass: "bg-indigo-500", seekContextKey: "a" };
const track = (container: HTMLElement) => container.firstElementChild!.firstElementChild!;
it("previews during scrubbing and seeks exactly once on matching release", () => {
  const onSeek = vi.fn(); const { container, rerender } = render(<SeekBar {...props} onSeek={onSeek} />);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 60 });
  rerender(<SeekBar {...props} position={25} onSeek={onSeek} />);
  expect(container.textContent).toContain("0:01:00.000");
  expect(onSeek).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { pointerId: 2, clientX: 90 });
  expect(onSeek).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 70 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 70 });
  expect(onSeek.mock.calls).toEqual([[70]]);
});
it.each(["cancel", "context", "duration", "unmount", "blur", "resize", "capture"])("does not commit an interrupted %s scrub", (kind) => {
  const onSeek = vi.fn(); const { container, rerender, unmount } = render(<SeekBar {...props} onSeek={onSeek} />);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  if (kind === "cancel") fireEvent.pointerCancel(window, { pointerId: 1 });
  if (kind === "context") rerender(<SeekBar {...props} seekContextKey="b" onSeek={onSeek} />);
  if (kind === "duration") rerender(<SeekBar {...props} duration={50} onSeek={onSeek} />);
  if (kind === "unmount") unmount();
  if (kind === "blur") fireEvent.blur(window);
  if (kind === "resize") fireEvent.resize(window);
  if (kind === "capture") fireEvent(track(container), new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }));
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onSeek).not.toHaveBeenCalled();
});
it("ignores interactive marker gestures and invalid track geometry", () => {
  const onSeek = vi.fn(); const { container } = render(<SeekBar {...props} onSeek={onSeek} />);
  const marker = document.createElement("button"); track(container).append(marker);
  fireEvent.pointerDown(marker, { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onSeek).not.toHaveBeenCalled();
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ left: 0, width: 0 } as DOMRect);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onSeek).not.toHaveBeenCalled();
});

it("clamps the released position and uses the latest callback without restarting the gesture", () => {
  const oldSeek = vi.fn(), newSeek = vi.fn();
  const { container, rerender } = render(<SeekBar {...props} onSeek={oldSeek} />);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  rerender(<SeekBar {...props} onSeek={newSeek} />);
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 150 });
  expect(oldSeek).not.toHaveBeenCalled(); expect(newSeek.mock.calls).toEqual([[100]]);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: -50 });
  expect(newSeek.mock.calls).toEqual([[100], [0]]);
});
it("allows keyboard seeks and cancels the pending pointer commit", () => {
  const onSeek = vi.fn(); const { container } = render(<SeekBar {...props} onSeek={onSeek} />);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  fireEvent.keyDown(track(container), { key: "End" });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  fireEvent.keyDown(track(container), { key: "Home" });
  fireEvent.keyDown(track(container), { key: "ArrowRight" });
  fireEvent.keyDown(track(container), { key: "ArrowLeft" });
  expect(onSeek.mock.calls).toEqual([[100], [0], [11], [9]]);
});
it("ignores secondary buttons, nonprimary pointers and malformed geometry", () => {
  const onSeek = vi.fn(); const { container } = render(<SeekBar {...props} onSeek={onSeek} />);
  for (const init of [{ button: 2 }, { button: 0, isPrimary: false }]) {
    fireEvent.pointerDown(track(container), { pointerId: 1, clientX: 20, ...init });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  }
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ left: 0, width: NaN } as DOMRect);
  fireEvent.pointerDown(track(container), { pointerId: 1, button: 0, clientX: 20 });
  expect(track(container).getAttribute("aria-valuenow")).toBe("10");
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80 });
  expect(onSeek).not.toHaveBeenCalled();
});
