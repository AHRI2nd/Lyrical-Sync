// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useI18nStore } from "../../stores/useI18nStore";
import { ELrcNoticeModal } from "./ELrcNoticeModal";
import { SaveFormatModal } from "./SaveFormatModal";
import { MiniConfirm } from "../LrcEditor/MiniConfirm";
import { ValidationPanel } from "../LrcEditor/ValidationPanel";

afterEach(cleanup);

it("gives the legacy notice a named focus scope and ignores composing Escape", () => {
  const onCancel = vi.fn();
  const t = useI18nStore.getState().t;
  render(<ELrcNoticeModal onConfirm={vi.fn()} onCancel={onCancel} />);
  const dialog = screen.getByRole("dialog", { name: t.elrcNotice.title });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
});

it("preserves a single Enter confirmation for the focused legacy notice", () => {
  const onConfirm = vi.fn();
  const t = useI18nStore.getState().t;
  render(<ELrcNoticeModal onConfirm={onConfirm} onCancel={vi.fn()} />);
  const checkbox = screen.getByRole("checkbox", { name: t.elrcNotice.dontShowAgain });
  fireEvent.keyDown(checkbox, { key: "Enter" });
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onConfirm).toHaveBeenCalledWith(false);
});

it("gives format selection a named focus scope and closes only on normal Escape", () => {
  const onCancel = vi.fn();
  const t = useI18nStore.getState().t;
  render(<SaveFormatModal onSelect={vi.fn()} onCancel={onCancel} />);
  const dialog = screen.getByRole("dialog", { name: t.saveFormatTitle });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
});

it("keeps a confirmation alertdialog named, focused and composition-safe", () => {
  const onCancel = vi.fn();
  render(<MiniConfirm title="Confirm change" message="This cannot be undone." okLabel="Continue" cancelLabel="Cancel" onOk={vi.fn()} onCancel={onCancel} />);
  const dialog = screen.getByRole("alertdialog", { name: "Confirm change" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
});

it("gives validation results a named focus scope and composition-safe dismissal", () => {
  const onClose = vi.fn();
  const t = useI18nStore.getState().t;
  render(<ValidationPanel stats={{ total: 1, stamped: 1, pct: 100 }} issues={[]} onJump={vi.fn()} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: t.validationTitle });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
