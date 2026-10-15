// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ClearGlyphTimings } from "./ClearGlyphTimings";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";
const labels = () => useI18nStore.getState().t.charSync;
beforeEach(() => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{id:"line",text:"ab",translation:"translation",timestamp:10,syllables:[{text:"a",time:10},{text:"b",time:11}]}]},activeLineId:"line",_history:[],_future:[] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function open() { fireEvent.click(screen.getByRole("button",{name:labels().clearTimingButton})); }
function confirm() { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:labels().clearTimingConfirm})); }
it("confirms the count, preserves lyrics and line time, and undoes as one edit", () => {
  const before = useLrcStore.getState().doc;
  render(<ClearGlyphTimings lineId="line" />); open();
  expect(screen.getByRole("dialog").textContent).toContain(labels().clearTimingMessage.replace("{count}","2"));
  confirm();
  expect(document.activeElement).toBe(screen.getByRole("button",{name:labels().undoClear}));
  expect(useLrcStore.getState().doc.lines[0]).toEqual({...before.lines[0],syllables:undefined});
  expect(useLrcStore.getState()._history).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:labels().undoClear}));
  expect(useLrcStore.getState().doc).toEqual(before);
  expect(document.activeElement).toBe(screen.getByRole("button",{name:labels().clearTimingButton}));
});
it("disables clearing when no timestamps exist", () => {
  useLrcStore.setState({doc:{...defaultDocument(),lines:[{id:"line",text:"ab",timestamp:10}]}});
  render(<ClearGlyphTimings lineId="line" />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
it("invalidates a pending confirmation when the document is replaced using the same line id", () => {
  render(<ClearGlyphTimings lineId="line" />); open();
  act(() => useLrcStore.setState({doc:{...useLrcStore.getState().doc}}));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useLrcStore.getState().doc.lines[0].syllables).toHaveLength(2);
});
it("removes Undo after another edit so that it cannot revert unrelated work", () => {
  render(<ClearGlyphTimings lineId="line" />); open(); confirm();
  act(() => useLrcStore.getState().updateLine("line", {text:"changed"}));
  expect(screen.queryByRole("status")).toBeNull();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("changed");
});
it("keeps Undo during playback but expires it after seven seconds", () => {
  vi.useFakeTimers(); render(<ClearGlyphTimings lineId="line" />); open(); confirm();
  act(() => useLrcStore.setState({currentTime:20}));
  expect(screen.getByRole("status")).toBeTruthy();
  act(() => vi.advanceTimersByTime(7000));
  expect(screen.queryByRole("status")).toBeNull();
});
it("cancels safely and ignores an IME Escape", () => {
  render(<ClearGlyphTimings lineId="line" />); open();
  fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape",isComposing:true});
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useLrcStore.getState()._history).toHaveLength(0);
});

it.each(["_documentSession", "_audioSelection"] as const)("invalidates confirmation and Undo when %s changes", field => {
  render(<ClearGlyphTimings lineId="line" />); open();
  act(() => useLrcStore.setState({[field]: useLrcStore.getState()[field]+1}));
  expect(screen.queryByRole("dialog")).toBeNull();
  open(); confirm();
  act(() => useLrcStore.setState({[field]: useLrcStore.getState()[field]+1}));
  expect(screen.queryByRole("status")).toBeNull();
});
