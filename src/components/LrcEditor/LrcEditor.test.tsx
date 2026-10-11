// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { LrcEditor } from "./LrcEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { defaultDocument } from "../../types/lrc";
beforeEach(() => {
  vi.stubGlobal("DragEvent", class extends MouseEvent {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: ["a", "b", "c", "d"].map((id) => ({ id, text: id, timestamp: null })) },
    syncMode: "line", activeLineId: "a", isDirty: false, _history: [], _future: [] });
});
afterEach(() => { cleanup(); delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const setup = () => {
  const result = render(<LrcEditor onPreview={() => {}} />);
  const handles = Array.from(result.container.querySelectorAll('[data-reorder-handle], [draggable="true"]'));
  const rows = handles.map((handle) => handle.parentElement!);
  vi.spyOn(rows[0].parentElement!, "getBoundingClientRect").mockReturnValue({
    left: 0, right: 200, top: 0, bottom: 80, width: 200, height: 80,
  } as DOMRect);
  rows.forEach((row, index) => vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: index * 20, height: 20 } as DOMRect));
  return { ...result, handles, rows };
};
// Native file drop owns HTML drag events on Windows. Reorder must use pointers.
const pointerSetup = () => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true;
    }
  });
  const result = setup();
  result.rows.forEach((row, index) => vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    top: index * 20, bottom: index * 20 + 20, left: 0, right: 200, width: 200, height: 20,
  } as DOMRect));
  return result;
};
const pointerStart = (handle: Element) => fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 5, clientY: 5 });
const pointerMove = (y: number, pointerId = 7, x = 5) => fireEvent.pointerMove(window, { pointerId, clientX: x, clientY: y });
const pointerEnd = (y: number, pointerId = 7, x = 5) => fireEvent.pointerUp(window, { pointerId, clientX: x, clientY: y });
it("reorders through pointer events without HTML drag events and supports undo/redo", () => {
  const { handles } = pointerSetup();
  const original = structuredClone(useLrcStore.getState().doc.lines);
  pointerStart(handles[0]); pointerMove(76); pointerEnd(76);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["b", "c", "d", "a"]);
  expect(useLrcStore.getState().doc.lines[3]).toEqual(original[0]);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines).toEqual(original);
  act(() => useLrcStore.getState().redo());
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["b", "c", "d", "a"]);
});
it.each(["cancel", "blur", "escape", "document", "mode", "outside"])("cancels pointer reorder on %s", (reason) => {
  const { handles } = pointerSetup();
  pointerStart(handles[0]); pointerMove(76);
  if (reason === "cancel") fireEvent.pointerCancel(window, { pointerId: 7 });
  if (reason === "blur") fireEvent.blur(window);
  if (reason === "escape") fireEvent.keyDown(window, { key: "Escape" });
  if (reason === "document") act(() => useLrcStore.setState({ _documentSession: useLrcStore.getState()._documentSession + 1 }));
  if (reason === "mode") act(() => useLrcStore.getState().setSyncMode("char"));
  pointerEnd(76, 7, reason === "outside" ? 500 : 5);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["a", "b", "c", "d"]);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});
it("ignores a different pointer and a click without movement", () => {
  const { handles } = pointerSetup();
  pointerStart(handles[0]); pointerMove(76, 8); pointerEnd(76, 8);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["a", "b", "c", "d"]);
  pointerEnd(5);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});

it.each([
  [0, 1, 24, "abcd"], [0, 3, 76, "bcda"], [3, 0, 4, "dabc"], [3, 0, 16, "adbc"],
] as const)("moves pointer row %i to row %i at y=%i", (from, _target, y, order) => {
  const { handles } = pointerSetup();
  fireEvent.pointerDown(handles[from], { pointerId: 7, button: 0, clientX: 5, clientY: from * 20 + 5 });
  pointerMove(y); pointerEnd(y);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id).join("")).toBe(order);
  expect(useLrcStore.getState()._history).toHaveLength(order === "abcd" ? 0 : 1);
});
it("preserves selected rows and all line data when pointer reordering", () => {
  const { handles, rows } = pointerSetup();
  fireEvent.click(rows[0], { ctrlKey: true }); fireEvent.click(rows[1], { ctrlKey: true });
  pointerStart(handles[0]); pointerMove(76); pointerEnd(76);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["b", "c", "d", "a"]);
  expect(rows[0].className).toContain("bg-sky-900"); expect(rows[1].className).toContain("bg-sky-900");
});
it("cancels pointer reorder if the line order changes", () => {
  const { handles } = pointerSetup();
  pointerStart(handles[0]); pointerMove(76);
  act(() => useLrcStore.getState().moveLine(2, 1));
  pointerEnd(76);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["a", "c", "b", "d"]);
  expect(useLrcStore.getState()._history).toHaveLength(1);
});
it("ignores external HTML drops and releases window listeners on unmount", () => {
  const { handles, rows, unmount } = pointerSetup();
  fireEvent.drop(rows[3], { clientY: 76 });
  pointerStart(handles[0]); pointerMove(76); unmount(); pointerEnd(76);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["a", "b", "c", "d"]);
});
it("ignores secondary button and secondary pointer starts", () => {
  const { handles } = pointerSetup();
  fireEvent.pointerDown(handles[0], { pointerId: 7, button: 2 }); pointerMove(76); pointerEnd(76);
  fireEvent.pointerDown(handles[0], { pointerId: 7, button: 0, isPrimary: false }); pointerMove(76); pointerEnd(76);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});

it("cancels a drop over a clipped row outside the visible scroll area", () => {
  const { handles, rows } = pointerSetup();
  vi.spyOn(rows[0].parentElement!, "getBoundingClientRect").mockReturnValue({
    left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40,
  } as DOMRect);
  pointerStart(handles[0]); pointerMove(76); pointerEnd(76);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["a", "b", "c", "d"]);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});
