import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { useLrcStore } from "./useLrcStore";
import { defaultDocument } from "../types/lrc";
beforeEach(() => useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
  { id: "a", timestamp: 1, text: "hello world", translation: "first" },
  { id: "b", timestamp: 2, text: "next", translation: "second" },
] }, _history: [], _future: [], _historyInfo: [], _futureInfo: [], _lastEditKey: null }));
it("groups translation typing independently from primary text", () => {
  const s = useLrcStore.getState(); s.updateLine("a", { translation: "one" }); s.updateLine("a", { translation: "two" });
  s.updateLine("a", { text: "edited" }); s.undo(); expect(useLrcStore.getState().doc.lines[0].translation).toBe("two");
  s.undo(); expect(useLrcStore.getState().doc.lines[0].translation).toBe("first");
});
it("preserves translations through duplicate, split, merge and undo", () => {
  const s = useLrcStore.getState(); const copy = s.duplicateLine("a");
  expect(useLrcStore.getState().doc.lines.find(l => l.id === copy)).toMatchObject({ translation: "first", timestamp: null }); s.undo();
  const second = s.splitLine("a", 5);
  expect(useLrcStore.getState().doc.lines[0].translation).toBe("first");
  expect(useLrcStore.getState().doc.lines.find(l => l.id === second)?.translation).toBeUndefined(); s.undo();
  s.mergeLineUp("b"); expect(useLrcStore.getState().doc.lines[0].translation).toBe("first\nsecond");
  s.undo(); expect(useLrcStore.getState().doc.lines.map(l => l.translation)).toEqual(["first", "second"]);
});
it("uses explicit translation parts in one undoable split", () => {
  const s = useLrcStore.getState(); const id = s.splitLine("a", 5, { first: "part one", second: "part two" });
  expect(useLrcStore.getState().doc.lines.find(l => l.id === id)?.translation).toBe("part two");
  expect(useLrcStore.getState().doc.lines[0].translation).toBe("part one");
  expect(useLrcStore.getState()._history).toHaveLength(1); s.undo();
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({text:"hello world",translation:"first"});
});
