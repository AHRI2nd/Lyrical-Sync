// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { MetaEditor } from "./MetaEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";

beforeEach(() => {
  useLrcStore.getState().newLrc();
  useLrcStore.getState().addLine("A original");
});

afterEach(() => cleanup());

it("connects metadata labels to their inputs", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  expect(screen.getByLabelText(t.metaTitle.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaArtist.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaAlbum.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaBy.label)).toBeTruthy();
  expect(screen.getByLabelText(t.metaOffsetShort)).toBeTruthy();
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

it("keeps the raw editor available when an inactive reserved tag has an unknown value", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), extraTags: { "x-lyrical-inline-escape": "external-value" },
    lines: [{ id: "a", timestamp: 1, text: "A original" }] } });
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA") as HTMLTextAreaElement;
  expect(editor.value).toContain("[x-lyrical-inline-escape:external-value]");
});

it("does not close the raw editor when Escape is composing an IME character", () => {
  const t = useI18nStore.getState().t;
  render(<MetaEditor />);
  fireEvent.click(screen.getByRole("button", { name: t.viewAll }));
  const editor = screen.getAllByRole("textbox").find((element) => element.tagName === "TEXTAREA");
  expect(editor).toBeTruthy();

  fireEvent.keyDown(window, { key: "Escape", isComposing: true });
  fireEvent.keyDown(window, { key: "Escape", keyCode: 229 });

  expect(screen.getAllByRole("textbox").some((element) => element.tagName === "TEXTAREA")).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryAllByRole("textbox").some((element) => element.tagName === "TEXTAREA")).toBe(false);
});
