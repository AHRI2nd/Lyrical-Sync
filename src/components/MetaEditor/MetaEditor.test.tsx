// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { MetaEditor } from "./MetaEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";
import { setDocumentConfirmation } from "../../utils/documentTransition";
import { useToastStore } from "../../stores/useToastStore";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps metadata and local raw lyrics editing available without online lookup", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  useLrcStore.setState({ doc: defaultDocument(), isDirty: false, _history: [], _future: [] });
  const { container, getByTitle, getAllByRole, getByLabelText, getByRole } = render(<MetaEditor />);
  expect(container.textContent).not.toContain("LRCLIB");
  fireEvent.change(getAllByRole("textbox")[0], { target: { value: "Local song" } });
  expect(useLrcStore.getState().doc.metadata.title).toBe("Local song");
  expect(() => getByLabelText(useI18nStore.getState().t.metaTitle.label)).not.toThrow();
  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  expect(container.querySelector("textarea")?.value).toContain("Local song");
  const dialog = getByRole("dialog", { name: useI18nStore.getState().t.rawEditorTitle });
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(getByRole("textbox", { name: useI18nStore.getState().t.rawEditorTitle })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps a raw editor draft visible and blocks applying it after the source document changes", async () => {
  useLrcStore.setState({ doc: defaultDocument(), isDirty: false, _history: [], _future: [], _documentSession: 7, _editRevision: 2 });
  const { container, getByTitle, getByRole, getByText } = render(<MetaEditor />);
  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  const textarea = container.querySelector("textarea")!;
  fireEvent.change(textarea, { target: { value: "[00:01.00]draft" } });

  useLrcStore.setState({ _documentSession: 8, _editRevision: 2,
    doc: { ...useLrcStore.getState().doc, lines: [{ id: "replacement", timestamp: null, text: "replacement" }] } });
  fireEvent.click(getByText(useI18nStore.getState().t.rawEditorApply));

  await waitFor(() => expect(getByRole("alert").textContent).toBe(useI18nStore.getState().t.rawEditorStale));
  expect(container.querySelector("textarea")?.value).toBe("[00:01.00]draft");
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["replacement"]);
});

it("rejects a raw draft after metadata changes within the same session", async () => {
  useLrcStore.setState({ doc: defaultDocument(), isDirty: false, _history: [], _future: [], _documentSession: 11, _editRevision: 4 });
  const { container, getByTitle, getByRole, getByText } = render(<MetaEditor />);
  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  fireEvent.change(container.querySelector("textarea")!, { target: { value: "[00:01.00]draft" } });
  useLrcStore.setState({ _editRevision: 5 });
  fireEvent.click(getByText(useI18nStore.getState().t.rawEditorApply));

  await waitFor(() => expect(getByRole("alert").textContent).toBe(useI18nStore.getState().t.rawEditorStale));
  expect(container.querySelector("textarea")?.value).toBe("[00:01.00]draft");
  expect(useLrcStore.getState().doc.lines).toHaveLength(0);
});

it("applies an unchanged raw draft and keeps it undoable", async () => {
  const original = defaultDocument();
  original.lines = [{ id: "original", timestamp: 1, text: "A original" }];
  useLrcStore.setState({ doc: original, isDirty: false, _history: [], _future: [], _documentSession: 20, _editRevision: 0 });
  const { container, getByTitle, getByText } = render(<MetaEditor />);
  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  const editor = container.querySelector("textarea")!;
  fireEvent.change(editor, { target: { value: editor.value.replace("A original", "A updated") } });
  fireEvent.click(getByText(useI18nStore.getState().t.rawEditorApply));

  await waitFor(() => expect(container.querySelector("textarea")).toBeNull());
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["A updated"]);
  useLrcStore.getState().undo();
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["A original"]);
});

it("keeps the raw editor and draft after saving before apply fails", async () => {
  const t = useI18nStore.getState().t;
  const unregister = setDocumentConfirmation(async () => "save");
  useLrcStore.setState({
    doc: defaultDocument(), isDirty: true, _history: [], _future: [], _documentSession: 24, _editRevision: 1,
    saveLrc: vi.fn().mockRejectedValue(new Error("disk full")),
  });
  useToastStore.setState({ toasts: [] });
  const { container, getByTitle, getByText } = render(<MetaEditor />);
  fireEvent.click(getByTitle(t.viewAll));
  const draft = "[00:01.00]draft";
  fireEvent.change(container.querySelector("textarea")!, { target: { value: draft } });
  fireEvent.click(getByText(t.rawEditorApply));

  await waitFor(() => {
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe(t.toast.saveFailed);
  });
  expect(container.querySelector("textarea")?.value).toBe(draft);
  expect(useLrcStore.getState().doc.lines).toHaveLength(0);
  unregister();
});

it("preserves overlapping SRT cue ends when unchanged raw text is applied", async () => {
  const doc = {
    ...defaultDocument(),
    lines: [
      { id: "first", timestamp: 1, srtEndTime: 4, text: "first" },
      { id: "second", timestamp: 3, srtEndTime: 5, text: "second" },
    ],
  };
  useLrcStore.setState({ doc, lrcPath: "/tmp/song.srt", lrcBookmark: null, isDirty: false });
  const history = useLrcStore.getState()._history;
  const { container, getByTitle, getByText } = render(<MetaEditor />);

  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  fireEvent.click(getByText(useI18nStore.getState().t.rawEditorApply));
  await waitFor(() => expect(container.querySelector("textarea")).toBeNull());

  expect(useLrcStore.getState().doc).toBe(doc);
  expect(useLrcStore.getState().doc.lines.map((line) => line.srtEndTime)).toEqual([4, 5]);
  expect(useLrcStore.getState()._history).toBe(history);
  expect(useLrcStore.getState().isDirty).toBe(false);
});

it.each([{ isComposing: true }, { keyCode: 229 }])("keeps the raw editor open when Escape belongs to IME composition (%j)", (composition) => {
  useLrcStore.setState({ doc: defaultDocument(), _history: [], _future: [] });
  const { container, getByTitle } = render(<MetaEditor />);
  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  fireEvent.keyDown(container.querySelector("textarea")!, { key: "Escape", ...composition });
  expect(container.querySelector("textarea")).not.toBeNull();
});
