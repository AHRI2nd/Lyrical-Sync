// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { LrcEditor } from "./LrcEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { defaultDocument } from "../../types/lrc";
beforeEach(() => {
  useSettingsStore.setState({ showTranslationLines: false, showSpellCheck: false });
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
it.each([
  { isComposing: true }, { keyCode: 229 },
])("does not insert or split a line while the IME owns Enter (%j)", (composition) => {
  const { container } = pointerSetup();
  const input = container.querySelector('input[placeholder="가사를 입력하세요..."]') ??
    Array.from(container.querySelectorAll("input")).find((node) => node.value === "a")!;
  const original = structuredClone(useLrcStore.getState().doc.lines);
  fireEvent.keyDown(input, { key: "Enter", ...composition });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true, ...composition });
  expect(useLrcStore.getState().doc.lines).toEqual(original);
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


it("edits translation text without altering enhanced original timing and obeys spellcheck", () => {
  useSettingsStore.setState({ showTranslationLines: true, showSpellCheck: true });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", timestamp: 1,
    translation: "translated", syllables: [{ text: "original", time: 1 }] }] } });
  const { getByDisplayValue } = render(<LrcEditor onPreview={() => {}} />);
  const translation = getByDisplayValue("translated");
  expect(translation.getAttribute("spellcheck")).toBe("true");
  expect(getByDisplayValue("original").getAttribute("spellcheck")).toBe("true");
  fireEvent.change(translation, { target: { value: "new\ntranslation" } });
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "original", translation: "new\ntranslation", syllables: [{ text: "original", time: 1 }] });
  act(() => useSettingsStore.setState({ showTranslationLines: false }));
  expect(useLrcStore.getState().doc.lines[0].translation).toBe("new\ntranslation");
});
it("keeps imported multiline subtitle bodies intact while editing", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", timestamp: 1 }] } });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const lyric = getByRole("textbox");
  expect(lyric.tagName).toBe("TEXTAREA");
  expect((lyric as HTMLTextAreaElement).value).toBe("first\nsecond");
  fireEvent.change(lyric, { target: { value: "first\nchanged" } });
  expect(useLrcStore.getState().doc.lines[0].text).toBe("first\nchanged");
});


it("asks for explicit translation parts when splitting and cancellation leaves the cue untouched", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "complete translation", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole, getByText } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("original") as HTMLInputElement;
  input.setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(getByText(t.translationSplitTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect((getByRole("textbox", { name: t.translationFirstPart }) as HTMLTextAreaElement).value).toBe("complete translation");
  fireEvent.click(getByRole("button", { name: t.confirmNewCancel }));
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "original", translation: "complete translation" });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.change(getByRole("textbox", { name: t.translationFirstPart }), { target: { value: "first part" } });
  fireEvent.change(getByRole("textbox", { name: t.translationSecondPart }), { target: { value: "second part" } });
  fireEvent.click(getByRole("button", { name: t.translationSplitAction }));
  expect(useLrcStore.getState().doc.lines.map(l => [l.text, l.translation])).toEqual([["ori", "first part"], ["ginal", "second part"]]);
});


it("cancels a pending translation split when its document is replaced", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "translated", timestamp: 1 }] } });
  const { getByDisplayValue, queryByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.keyDown(getByDisplayValue("original"), { key: "Enter", shiftKey: true });
  act(() => useLrcStore.setState({ doc: defaultDocument(), _documentSession: useLrcStore.getState()._documentSession + 1 }));
  expect(queryByRole("dialog", { name: t.translationSplitTitle })).toBeNull();
  expect(useLrcStore.getState().doc.lines).toEqual([]);
});
it("keeps ordinary Enter available for multiline cue editing instead of inserting a lyric row", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", timestamp: 1 }] } });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  expect(fireEvent.keyDown(getByRole("textbox"), { key: "Enter" })).toBe(true);
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
});

it("does not apply a pending retokenize confirmation to a replacement document with the same row ID", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }] }] }, activeLineId: "a" });
  const { getByDisplayValue, getByRole, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.change(getByDisplayValue("old lyric"), { target: { value: "pending old edit" } });
  const staleConfirmation = getByRole("button", { name: t.charSync.retokenizeOk });
  act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "new document", timestamp: 2,
      syllables: [{ text: "new document", time: 2 }] }] },
    _documentSession: useLrcStore.getState()._documentSession + 1,
    activeLineId: "a",
  }));
  fireEvent.click(staleConfirmation);
  expect(queryByText(t.charSync.retokenizeTitle)).toBeNull();
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
    text: "new document", syllables: [{ text: "new document", time: 2 }],
  });
});

it("does not apply a pending sync-unit confirmation to a different active row", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "timed", timestamp: 1, syllables: [{ text: "timed", time: 1 }] },
    { id: "b", text: "other", timestamp: 2, syllables: [{ text: "other", time: 2 }] },
  ] }, activeLineId: "a", syncMode: "char", syncUnit: "char" });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.charSync.unitWord }));
  const staleConfirmation = getByRole("button", { name: t.charSync.retokenizeOk });
  act(() => useLrcStore.setState({ activeLineId: "b" }));
  fireEvent.click(staleConfirmation);
  expect(useLrcStore.getState().syncUnit).toBe("char");
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "timed", time: 1 }]);
});
it("opens the real lazy batch tool from the editor menu", async () => {
  const t = useI18nStore.getState().t;
  const { getByRole, findByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.batchTitle }));
  expect(await findByRole("dialog", { name: t.batchTitle })).toBeTruthy();
});
it("passes the selected lyric IDs into the lazy BPM tool", async () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ audioPath: null, doc: { ...defaultDocument(), lines: [{ id: "a", text: "a", timestamp: 1.14 }, { id: "b", text: "b", timestamp: 2.26 }] } });
  const { getByRole, getByDisplayValue, findByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByDisplayValue("a").closest(".group\\/row")!, { ctrlKey: true });
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.bpmTitle }));
  const bpm = await findByRole("textbox", { name: t.bpmLabel });
  fireEvent.change(bpm, { target: { value: "120" } });
  fireEvent.click(getByRole("button", { name: t.applyLabel }));
  expect(useLrcStore.getState().doc.lines.map(l => l.timestamp)).toEqual([1, 2.26]);
});

it.each([2.369, 3602.369, 2.36912345])("preserves timestamp %s and history when inline editing is left unchanged", (timestamp) => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "precise", timestamp }] }, _history: [], _future: [] });
  const original = useLrcStore.getState().doc;
  const { container, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const timestampButton = container.querySelector('[data-line-id="a"] .ls-line-time button')!;
  fireEvent.click(timestampButton);
  const input = container.querySelector('[data-line-id="a"] .ls-line-time input')!;
  fireEvent.blur(input);
  expect(useLrcStore.getState().doc).toBe(original);
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(timestamp);
  expect(useLrcStore.getState()._history).toHaveLength(0);
  expect(getByRole("textbox").getAttribute("value")).toBe("precise");
});

it("commits an hour-aware timestamp while composition and Escape preserve the original", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "precise", timestamp: 2.369 }] }, _history: [] });
  const { container, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: "0:00:02.369" }));
  let input = container.querySelector('.ls-line-time input')!;
  fireEvent.change(input, { target: { value: "1:00:02.369" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(2.369);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(2.369);
  fireEvent.click(getByRole("button", { name: "0:00:02.369" }));
  input = container.querySelector('.ls-line-time input')!;
  fireEvent.change(input, { target: { value: "1:00:02.369" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(3602.369);
  expect(useLrcStore.getState()._history).toHaveLength(1);
});

it.each([false,true])('keeps replacement dollar text literal in the editor (all=%s)', all => {
 const t=useI18nStore.getState().t;
 useLrcStore.setState({doc:{...defaultDocument(),lines:[{id:'a',text:'original original',timestamp:1}]}});
 const {getByPlaceholderText,getByRole}=render(<LrcEditor onPreview={()=>{}} />);
 fireEvent.keyDown(window,{code:'KeyF',ctrlKey:true});
 fireEvent.change(getByPlaceholderText(t.findPlaceholder),{target:{value:'original'}});
 fireEvent.change(getByPlaceholderText(t.replacePlaceholder),{target:{value:'$&'}});
 fireEvent.click(getByRole('button',{name:all?t.replaceAll:t.replaceBtn}));
 expect(useLrcStore.getState().doc.lines[0].text).toBe(all?'$& $&':'$& original');
});
