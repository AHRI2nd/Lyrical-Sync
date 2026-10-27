// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { MetaEditor } from "./MetaEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";

beforeEach(() => {
  useLrcStore.getState().newLrc();
  useLrcStore.getState().addLine("A original");
});

afterEach(() => cleanup());

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
