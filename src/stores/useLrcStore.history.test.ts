import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { useLrcStore } from "./useLrcStore";
import { defaultDocument } from "../types/lrc";
import { setDocumentConfirmation } from "../utils/documentTransition";
beforeEach(() => {
  setDocumentConfirmation(async () => "discard");
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "1", text: "original", timestamp: null },
    { id: "2", text: "other", timestamp: null }] }, _history: [], _future: [], isDirty: false, lrcPath: "/song.lrc", lrcBookmark: null });
});
it("typing same field is one undo and redo restores its final text", () => {
  const s = useLrcStore.getState();
  s.updateLine("1", { text: "a" }); s.updateLine("1", { text: "ab" }); s.updateLine("1", { text: "abc" });
  expect(useLrcStore.getState()._history).toHaveLength(1);
  s.undo(); expect(useLrcStore.getState().doc.lines[0].text).toBe("original");
  s.redo(); expect(useLrcStore.getState().doc.lines[0].text).toBe("abc");
});
it("metadata editing is undoable and switching field breaks coalescing", () => {
  const s = useLrcStore.getState();
  s.setMetadata({ title: "a" }); s.setMetadata({ title: "ab" }); s.setMetadata({ artist: "artist" });
  expect(useLrcStore.getState()._history).toHaveLength(2);
  s.undo(); expect(useLrcStore.getState().doc.metadata).toMatchObject({ title: "ab", artist: "" });
  s.undo(); expect(useLrcStore.getState().doc.metadata.title).toBe("");
});
it("undo then edit clears redo", () => {
  const s = useLrcStore.getState();
  s.updateLine("1", { text: "first" }); s.undo();
  expect(useLrcStore.getState()._future).toHaveLength(1);
  s.updateLine("1", { text: "replacement" });
  expect(useLrcStore.getState()._future).toEqual([]);
  s.redo(); expect(useLrcStore.getState().doc.lines[0].text).toBe("replacement");
});
it("switching lines and structural edits break the typing group", () => {
  const s = useLrcStore.getState();
  s.updateLine("1", { text: "first" }); s.updateLine("2", { text: "second" }); s.addLine("added"); s.updateLine("2", { text: "later" });
  expect(useLrcStore.getState()._history).toHaveLength(4);
  s.undo(); expect(useLrcStore.getState().doc.lines[1].text).toBe("second");
});
it("silent fill and no-op updates do not create user history", () => {
  const s = useLrcStore.getState(); const revision = s._editRevision;
  s.setMetadata({ title: "auto" }, true);
  expect(useLrcStore.getState()._history).toEqual([]); expect(useLrcStore.getState().isDirty).toBe(false);
  s.setMetadata({ title: "auto" }); s.updateLine("missing", { text: "ignored" }); s.updateLine("1", { text: "original" });
  expect(useLrcStore.getState()._history).toEqual([]);
  expect(useLrcStore.getState()._editRevision).toBe(revision + 1);
  s.setMetadata({ title: "user" }); s.undo(); expect(useLrcStore.getState().doc.metadata.title).toBe("auto");
});
it("save ends a typing group and history retains at most fifty snapshots", async () => {
  const s = useLrcStore.getState(); s.updateLine("1", { text: "saved" });
  await s.saveLrc(); s.updateLine("1", { text: "after save" }); s.undo();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("saved");
  for (let i = 0; i < 60; i++) s.addLine(String(i));
  expect(useLrcStore.getState()._history).toHaveLength(50);
});
it("document replacement resets coalescing and keeps edit revisions monotonic within a session", async () => {
  const s = useLrcStore.getState(); s.updateLine("1", { text: "old" });
  await s.loadFromRawText("new");
  const revision = useLrcStore.getState()._editRevision;
  const id = useLrcStore.getState().doc.lines[0].id;
  s.updateLine(id, { text: "edited" }); s.undo();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("new");
  expect(useLrcStore.getState()._editRevision).toBe(revision + 2);
});

it("glyph painting remains one undo while every mutation advances revision", () => {
  const s = useLrcStore.getState(); const revision = s._editRevision;
  s.commitSyllables("1", [{ text: "a", time: 1 }]);
  s.commitSyllables("1", [{ text: "a", time: 2 }], false);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  expect(useLrcStore.getState()._editRevision).toBe(revision + 2);
  s.undo(); expect(useLrcStore.getState().doc.lines[0].syllables).toBeUndefined();
  s.redo(); expect(useLrcStore.getState().doc.lines[0].syllables?.[0].time).toBe(2);
  s.undo(); s.commitSyllables("1", [{ text: "a", time: 3 }], false);
  expect(useLrcStore.getState()._future).toEqual([]);
});
it.each(["stamp", "split", "merge", "delete"])("%s separates consecutive typing groups", (operation) => {
  const s = useLrcStore.getState(); s.updateLine("1", { text: "before" });
  if (operation === "stamp") s.stampCurrentLine("1");
  if (operation === "split") s.splitLine("1", 3);
  if (operation === "merge") s.mergeLineUp("2");
  if (operation === "delete") s.deleteLine("2");
  const beforeTyping = useLrcStore.getState().doc;
  s.updateLine("1", { text: "after" }); s.undo();
  expect(useLrcStore.getState().doc).toBe(beforeTyping);
});
it("undo restores enhanced tokens after a confirmed text change removes them", () => {
  const s = useLrcStore.getState();
  const tokens = [{ text: "original", time: 1 }];
  useLrcStore.setState({ doc: { ...s.doc, lines: [{ ...s.doc.lines[0], syllables: tokens }] } });
  s.updateLine("1", { text: "confirmed", syllables: undefined });
  s.updateLine("1", { text: "continued" });
  s.undo(); expect(useLrcStore.getState().doc.lines[0].text).toBe("confirmed");
  s.undo(); expect(useLrcStore.getState().doc.lines[0].syllables).toEqual(tokens);
});

it('keeps labeled history metadata aligned across grouped edits, undo and redo', () => {
  const s=useLrcStore.getState(); s.updateLine('1',{text:'one'}); s.updateLine('1',{text:'two'});
  expect(useLrcStore.getState()._historyInfo).toHaveLength(1);
  expect(useLrcStore.getState()._historyInfo[0]).toMatchObject({label:'editText'});
  expect(useLrcStore.getState()._historyInfo[0].timestamp).toBeGreaterThan(0);
  s.undo(); expect(useLrcStore.getState()._historyInfo).toHaveLength(0);
  expect(useLrcStore.getState()._futureInfo).toHaveLength(1);
  s.redo(); expect(useLrcStore.getState()._historyInfo).toHaveLength(1);
  expect(useLrcStore.getState()._futureInfo).toHaveLength(0);
});
it('jumps both directions without changing file access ownership', () => {
  const s=useLrcStore.getState(); s.updateLine('1',{text:'one'}); s.updateLine('2',{text:'other edited'}); s.setMetadata({title:'title'});
  const latest=useLrcStore.getState().doc;
  const path=useLrcStore.getState().lrcPath,session=useLrcStore.getState()._documentSession;
  s.jumpToHistory(1);
  expect(useLrcStore.getState().doc.lines.map(l=>l.text)).toEqual(['one','other']);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  expect(useLrcStore.getState()._future).toHaveLength(2);
  s.jumpToHistory(3); expect(useLrcStore.getState().doc).toBe(latest);
  expect(useLrcStore.getState()).toMatchObject({lrcPath:path,_documentSession:session,isDirty:true});
  expect(useLrcStore.getState()._historyInfo).toHaveLength(3);
});
it('ignores invalid timeline indices and preserves raw-import undo metadata and clears it on a new document', async () => {
  const s=useLrcStore.getState(); s.updateLine('1',{text:'one'}); const doc=useLrcStore.getState().doc;
  for(const index of [-1,NaN,Infinity,0.5,20]) s.jumpToHistory(index);
  expect(useLrcStore.getState().doc).toBe(doc);
  await s.loadFromRawText('[00:01.00]new');
  expect(useLrcStore.getState()._historyInfo).toHaveLength(useLrcStore.getState()._history.length);
  await s.newLrc();
  expect(useLrcStore.getState()._historyInfo).toHaveLength(0);
  expect(useLrcStore.getState()._futureInfo).toHaveLength(0);
});
