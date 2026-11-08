// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { MetaEditor } from "./MetaEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";
import { useToastStore } from "../../stores/useToastStore";

beforeEach(() => {
  useLrcStore.getState().newLrc();
  useLrcStore.getState().addLine("A original");
});

afterEach(() => cleanup());

it("rejects an offset too large to serialize without corrupting the document", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  const offset = screen.getByRole("textbox", { name: t.metaOffsetShort });
  fireEvent.change(offset, { target: { value: "9".repeat(400) } });

  expect(useLrcStore.getState().doc.metadata.offset).toBe(0);
  expect(Number.isFinite(useLrcStore.getState().doc.metadata.offset)).toBe(true);
  const toasts = useToastStore.getState().toasts;
  expect(toasts[toasts.length - 1]?.message).toBe(t.toast.invalidTimestamp);
});

it("connects metadata labels to their inputs", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  expect(screen.getByLabelText(t.metaTitle.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaArtist.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaAlbum.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaBy.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaOffsetShort)).toBeTruthy();
});

it("resets a transitional offset draft when a new document has the same offset", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  const offset = screen.getByRole("textbox", { name: t.metaOffsetShort }) as HTMLInputElement;
  fireEvent.change(offset, { target: { value: "-" } });
  expect(offset.value).toBe("-");
  expect(useLrcStore.getState().doc.metadata.offset).toBe(0);

  act(() => { useLrcStore.getState().newLrc(); });

  expect(screen.getByRole("textbox", { name: t.metaOffsetShort })).toHaveProperty("value", "0");
});

it("keeps a raw draft from being applied to a replacement document", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));

  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: editor.value.replace("A original", "A draft") } });

  useLrcStore.getState().newLrc();
  useLrcStore.getState().addLine("B document");
  fireEvent.click(screen.getAllByRole("button", { name: t.rawEditorApply }).slice(-1)[0]);

  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["B document"]);
  expect(screen.getByRole("alert").textContent).toBe(t.rawEditorStale);
  expect((screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement).value).toContain("A draft");
});

it("rejects a raw draft after metadata changes in the same document session", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: editor.value.replace("A original", "A draft") } });

  useLrcStore.getState().setMetadata({ title: "Updated externally" });
  fireEvent.click(screen.getAllByRole("button", { name: t.rawEditorApply }).slice(-1)[0]);

  expect(useLrcStore.getState().doc.metadata.title).toBe("Updated externally");
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["A original"]);
  expect(screen.getByRole("alert").textContent).toBe(t.rawEditorStale);
});

it("keeps silent metadata updates from being overwritten by an open raw draft", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  useLrcStore.getState().setMetadata({ title: "Track metadata" }, true);
  fireEvent.click(screen.getAllByRole("button", { name: t.rawEditorApply }).slice(-1)[0]);

  expect(useLrcStore.getState().doc.metadata.title).toBe("Track metadata");
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["A original"]);
  expect(screen.getByRole("alert").textContent).toBe(t.rawEditorStale);
});

it("applies an unchanged-session raw draft and keeps the operation undoable", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: editor.value.replace("A original", "A updated") } });
  fireEvent.click(screen.getAllByRole("button", { name: t.rawEditorApply }).slice(-1)[0]);

  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["A updated"]);
  useLrcStore.getState().undo();
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["A original"]);
});

it("keeps SRT cue ends when the unchanged raw editor is applied", () => {
  const t = useI18nStore.getState().t;
  const doc = {
    ...defaultDocument(),
    lines: [
      { id: "first", timestamp: 1, srtEndTime: 4, text: "first" },
      { id: "second", timestamp: 3, srtEndTime: 5, text: "second" },
    ],
  };
  useLrcStore.setState({ doc, lrcPath: "/tmp/song.srt", isDirty: false });
  const history = useLrcStore.getState()._history;
  render(<MetaEditor />);

  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  fireEvent.click(screen.getAllByRole("button", { name: t.rawEditorApply }).slice(-1)[0]);

  expect(useLrcStore.getState().doc).toBe(doc);
  expect(useLrcStore.getState().doc.lines.map((line) => line.srtEndTime)).toEqual([4, 5]);
  expect(useLrcStore.getState()._history).toBe(history);
  expect(useLrcStore.getState().isDirty).toBe(false);
});

it("opens the raw editor from non-reserved parse errors instead of hiding the repair path", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), metadata: { ...defaultDocument().metadata, title: "Bad\\nTitle" },
    lines: [{ id: "a", timestamp: 1, text: "A original" }] } });
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  expect(screen.getByRole("textbox", { name: t.rawEditorTitle })).toBeTruthy();
});

it("opens the raw editor with unsupported reserved control metadata preserved for correction", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), invalidControlTags: [{ key: "x-lyrical-inline-escape", value: "external-value" }],
    lines: [{ id: "a", timestamp: 1, text: "A original" }] } });
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement;
  expect(editor.value).toContain("[x-lyrical-inline-escape:external-value]");
  expect(screen.getByRole("alert").textContent).toBe(t.rawEditorReservedTagConflict);
});

it("keeps a raw editor with a reserved-tag conflict open and explains how to recover", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), invalidControlTags: [{ key: "x-lyrical-inline-escape", value: "external-value" }],
    lines: [{ id: "a", timestamp: 1, text: "A original" }] } });
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));

  const textarea = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement;
  const apply = screen.getAllByRole("button", { name: t.rawEditorApply }).slice(-1)[0] as HTMLButtonElement;
  expect(textarea.value).toContain("[x-lyrical-inline-escape:external-value]");
  expect(apply.disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe(t.rawEditorReservedTagConflict);

  fireEvent.change(textarea, { target: { value: textarea.value.replace("[x-lyrical-inline-escape:external-value]", "[x-lyrical-inline-escape:1]") } });
  fireEvent.click(apply);
  expect(useLrcStore.getState().doc.invalidControlTags).toBeUndefined();
  expect(screen.queryAllByRole("textbox").some((element) => element.tagName === "TEXTAREA")).toBe(false);
});

it("does not close the raw editor when Escape is composing an IME character", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA");
  expect(editor).toBeTruthy();

  fireEvent.keyDown(editor!, { key: "Escape", isComposing: true });
  fireEvent.keyDown(editor!, { key: "Escape", keyCode: 229 });

  expect(screen.getAllByRole("textbox").some((element) => element.tagName === "TEXTAREA")).toBe(true);
  fireEvent.keyDown(editor!, { key: "Escape" });
  expect(screen.queryAllByRole("textbox").some((element) => element.tagName === "TEXTAREA")).toBe(false);
});
