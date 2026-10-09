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
  const handles = Array.from(result.container.querySelectorAll('[draggable="true"]'));
  const rows = handles.map((handle) => handle.parentElement!);
  rows.forEach((row, index) => vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: index * 20, height: 20 } as DOMRect));
  return { ...result, handles, rows };
};
it.each([
  [0, 1, false, "abcd"], [0, 3, true, "bcda"], [3, 0, false, "dabc"], [3, 0, true, "adbc"],
] as const)("inserts row %i at row %i's after=%s gap", (from, target, after, order) => {
  const { handles, rows } = setup();
  fireEvent.dragStart(handles[from]);
  fireEvent.dragOver(rows[target], { clientY: target * 20 + (after ? 16 : 4) });
  fireEvent.drop(rows[target], { clientY: target * 20 + (after ? 16 : 4) });
  expect(useLrcStore.getState().doc.lines.map((line) => line.id).join("")).toBe(order);
  expect(useLrcStore.getState()._history).toHaveLength(order === "abcd" ? 0 : 1);
});
it("preserves multi-selection while dragging one selected row", () => {
  const { handles, rows } = setup();
  fireEvent.click(rows[0], { ctrlKey: true }); fireEvent.click(rows[1], { ctrlKey: true });
  fireEvent.dragStart(handles[0]); fireEvent.dragOver(rows[3], { clientY: 76 }); fireEvent.drop(rows[3], { clientY: 76 });
  expect(useLrcStore.getState().doc.lines.map((line) => line.id).join("")).toBe("bcda");
  expect(rows[0].className).toContain("bg-sky-900"); expect(rows[1].className).toContain("bg-sky-900");
});
it("cancels reorder after replacement or a changed line order", () => {
  const { handles, rows } = setup();
  fireEvent.dragStart(handles[0]);
  act(() => useLrcStore.setState({ _documentSession: useLrcStore.getState()._documentSession + 1 }));
  fireEvent.drop(rows[3], { clientY: 76 });
  expect(useLrcStore.getState().doc.lines.map((line) => line.id).join("")).toBe("abcd");
  fireEvent.dragStart(handles[0]);
  act(() => useLrcStore.getState().moveLine(2, 1));
  fireEvent.drop(rows[3], { clientY: 76 });
  expect(useLrcStore.getState().doc.lines.map((line) => line.id).join("")).toBe("acbd");
});
it("ignores external drops and a drag ended outside the list", () => {
  const { handles, rows } = setup();
  fireEvent.drop(rows[3], { clientY: 76 });
  fireEvent.dragStart(handles[0]); fireEvent.dragEnd(handles[0]); fireEvent.drop(rows[3], { clientY: 76 });
  expect(useLrcStore.getState().doc.lines.map((line) => line.id).join("")).toBe("abcd");
});
