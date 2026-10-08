import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useLrcStore } from "./useLrcStore";
import { useSettingsStore } from "./useSettingsStore";
import { defaultDocument } from "../types/lrc";
import { setDocumentConfirmation } from "../utils/documentTransition";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  vi.mocked(save).mockReset();
  setDocumentConfirmation(async () => "discard");
  useLrcStore.setState({ doc: defaultDocument(), isDirty: false, lrcPath: "/song.lrc", lrcBookmark: null,
    audioPath: "/current.mp3", audioBookmark: null, _history: [], _future: [] });
  useSettingsStore.setState({ recentFiles: [] });
});

it("old save keeps newer edits dirty", async () => {
  const write = deferred<void>();
  vi.mocked(invoke).mockReturnValue(write.promise);
  const saving = useLrcStore.getState().saveLrc();
  useLrcStore.getState().addLine("new edit");
  write.resolve();
  await saving;
  expect(useLrcStore.getState().isDirty).toBe(true);
});

it("old Save As cannot retarget a replacement document", async () => {
  const dialog = deferred<string>();
  vi.mocked(save).mockReturnValue(dialog.promise);
  const saving = useLrcStore.getState().saveLrcAs("lrc");
  await useLrcStore.getState().newLrc();
  useLrcStore.getState().addLine("new draft");
  dialog.resolve("/old-save.lrc");
  await saving;
  expect(useLrcStore.getState().lrcPath).toBeNull();
  expect(useLrcStore.getState().isDirty).toBe(true);
});

it.each(["new", "recovery", "fetched", "raw"])("late file read cannot replace %s", async (kind) => {
  const read = deferred<string>();
  vi.mocked(invoke).mockImplementation((cmd) => cmd === "read_lrc_file" ? read.promise : Promise.resolve(null));
  const loading = useLrcStore.getState().loadLyricsPath("/old.lrc");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("read_lrc_file", expect.anything()));
  const st = useLrcStore.getState();
  if (kind === "new") await st.newLrc();
  if (kind === "recovery") await st.restoreDoc(defaultDocument(), null, null);
  if (kind === "fetched") await st.applyFetchedLyrics("[00:01.00]fresh");
  if (kind === "raw") await st.loadFromRawText("[00:01.00]raw");
  const current = useLrcStore.getState().doc;
  read.resolve("[00:02.00]obsolete");
  await loading;
  expect(useLrcStore.getState().doc).toBe(current);
});

it("late audio bookmark cannot overwrite a new selection of the same path", async () => {
  const first = deferred<string>();
  let count = 0;
  vi.mocked(invoke).mockImplementation(() => ++count === 1 ? first.promise : Promise.resolve("new-grant"));
  const st = useLrcStore.getState();
  st.setAudioPath("/a.mp3"); st.setAudioPath("/b.mp3"); st.setAudioPath("/a.mp3");
  await vi.waitFor(() => expect(useLrcStore.getState().audioBookmark).toBe("new-grant"));
  first.resolve("obsolete-grant");
  await first.promise; await Promise.resolve(); await Promise.resolve();
  expect(useLrcStore.getState().audioBookmark).toBe("new-grant");
});

it("failed recent lyrics preparation preserves the entire current pair", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("unreadable"));
  await expect(useLrcStore.getState().requestDocumentTransition({ kind: "recent", entry: {
    lrcPath: "/bad.lrc", audioPath: "/other.mp3", lrcBookmark: null, audioBookmark: null, openedAt: 1,
  } })).rejects.toThrow("unreadable");
  expect(useLrcStore.getState().audioPath).toBe("/current.mp3");
  expect(useLrcStore.getState().lrcPath).toBe("/song.lrc");
  expect(useSettingsStore.getState().recentFiles).toEqual([]);
});

it("same-path saves retain submission order even while the first grant is prepared", async () => {
  const grant = deferred<{ path: string; bookmark: string }>();
  const contents: string[] = [];
  let preparations = 0;
  useLrcStore.setState({ lrcBookmark: "old" });
  useLrcStore.getState().addLine("first");
  vi.mocked(invoke).mockImplementation((cmd, args) => {
    if (cmd === "prepare_file_ref") return ++preparations === 1 ? grant.promise : Promise.resolve({ path: "/song.lrc", bookmark: "fresh" });
    if (cmd === "write_lrc_file") contents.push((args as { content: string }).content);
    return Promise.resolve(null);
  });
  const first = useLrcStore.getState().saveLrc();
  useLrcStore.getState().updateLine(useLrcStore.getState().doc.lines[0].id, { text: "second" });
  const second = useLrcStore.getState().saveLrc();
  await vi.waitFor(() => expect(preparations).toBe(1));
  expect(contents).toEqual([]);
  grant.resolve({ path: "/song.lrc", bookmark: "fresh" });
  await Promise.all([first, second]);
  expect(contents[0]).toContain("first");
  expect(contents[1]).toContain("second");
  expect(useLrcStore.getState().isDirty).toBe(false);
});

it("cancelled or failed save blocks dirty replacement", async () => {
  setDocumentConfirmation(async () => "save");
  useLrcStore.getState().addLine("draft");
  const doc = useLrcStore.getState().doc;
  useLrcStore.setState({ lrcPath: null });
  vi.mocked(save).mockResolvedValue(null);
  expect(await useLrcStore.getState().requestDocumentTransition({ kind: "new" })).toBe("cancelled");
  expect(useLrcStore.getState().doc).toBe(doc);
  useLrcStore.setState({ lrcPath: "/song.lrc" });
  vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
  await expect(useLrcStore.getState().requestDocumentTransition({ kind: "new" })).rejects.toThrow("disk full");
  expect(useLrcStore.getState().doc).toBe(doc);
  expect(useLrcStore.getState().isDirty).toBe(true);
});

it("records successful recent pairs atomically and keeps at most eight entries", async () => {
  vi.mocked(invoke).mockImplementation((cmd) => cmd === "read_lrc_file" ? Promise.resolve("[00:01.00]new") : Promise.resolve(null));
  const observed: string[] = [];
  const unsubscribe = useLrcStore.subscribe((state) => {
    if (state.lrcPath === "/new.lrc") observed.push(state.audioPath!);
  });
  await useLrcStore.getState().requestDocumentTransition({ kind: "recent", entry: {
    lrcPath: "/new.lrc", audioPath: "/new.mp3", lrcBookmark: null, audioBookmark: null, openedAt: 1,
  } });
  unsubscribe();
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((path) => path === "/new.mp3")).toBe(true);
  for (let i = 0; i < 10; i++) useLrcStore.getState().setAudioPath(`/track-${i}.mp3`);
  expect(useSettingsStore.getState().recentFiles).toHaveLength(8);
  expect(useSettingsStore.getState().recentFiles[0].audioPath).toBe("/track-9.mp3");
});


it("audio-only recent selection preserves lyric history and avoids discard confirmation", async () => {
  useLrcStore.getState().addLine("draft");
  const before = useLrcStore.getState();
  const confirm = vi.fn(async () => "discard" as const);
  setDocumentConfirmation(confirm);
  await useLrcStore.getState().requestDocumentTransition({ kind: "recent", entry: {
    lrcPath: null, lrcBookmark: null, audioPath: "/selected.mp3", audioBookmark: "grant", openedAt: 1,
  } });
  expect(useLrcStore.getState().doc).toBe(before.doc);
  expect(useLrcStore.getState()._history).toBe(before._history);
  expect(useLrcStore.getState()._documentSession).toBe(before._documentSession);
  expect(confirm).not.toHaveBeenCalled();
});

it("older Save As completion cannot replace the newer destination", async () => {
  const first = deferred<void>();
  vi.mocked(save).mockResolvedValueOnce("/first.lrc").mockResolvedValueOnce("/second.lrc");
  vi.mocked(invoke).mockImplementation((cmd, args) => {
    if (cmd === "write_lrc_file" && (args as { path: string }).path === "/first.lrc") return first.promise;
    return Promise.resolve(null);
  });
  useLrcStore.getState().addLine("first");
  const saving = useLrcStore.getState().saveLrcAs("lrc");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/first.lrc" })));
  useLrcStore.getState().addLine("second");
  await useLrcStore.getState().saveLrcAs("lrc");
  first.resolve();
  await saving;
  expect(useLrcStore.getState().lrcPath).toBe("/second.lrc");
  expect(useLrcStore.getState().isDirty).toBe(false);
});

it("cancelled Save As retains a selected file's pending bookmark", async () => {
  const bookmark = deferred<string>();
  vi.mocked(invoke).mockImplementation((cmd) => cmd === "read_lrc_file" ? Promise.resolve("draft") : bookmark.promise);
  await useLrcStore.getState().loadLyricsPath("/selected.lrc");
  vi.mocked(save).mockResolvedValue(null);
  expect(await useLrcStore.getState().saveLrcAs("lrc")).toBe(false);
  bookmark.resolve("selected-grant");
  await vi.waitFor(() => expect(useLrcStore.getState().lrcBookmark).toBe("selected-grant"));
});

it("a write to the old destination cannot clean a newer Save As target", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  vi.mocked(save).mockResolvedValue("/b.lrc");
  vi.mocked(invoke).mockImplementation((cmd, args) => {
    if (cmd === "write_lrc_file") return (args as { path: string }).path === "/b.lrc" ? b.promise : a.promise;
    return Promise.resolve(null);
  });
  useLrcStore.getState().addLine("revision one");
  const saveAs = useLrcStore.getState().saveLrcAs("lrc");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/b.lrc" })));
  useLrcStore.getState().addLine("revision two");
  const saveOld = useLrcStore.getState().saveLrc();
  b.resolve();
  await saveAs;
  expect(useLrcStore.getState().lrcPath).toBe("/b.lrc");
  expect(useLrcStore.getState().isDirty).toBe(true);
  a.resolve();
  await saveOld;
  expect(useLrcStore.getState().isDirty).toBe(true);
});
