// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { useLrcStore } from "./stores/useLrcStore";
import { useI18nStore } from "./stores/useI18nStore";
import { loadRecoverySnapshot } from "./utils/recovery";

function CrashOnRender(): never {
  throw new Error("synthetic render failure");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("preserves a dirty document when a render error replaces the app with its fallback", () => {
  localStorage.clear();
  useLrcStore.getState().loadFromRawText("[00:01.00]unsaved draft");
  vi.spyOn(console, "error").mockImplementation(() => {});

  render(<ErrorBoundary><CrashOnRender /></ErrorBoundary>);

  expect(screen.getByText(/synthetic render failure/)).toBeTruthy();
  expect(loadRecoverySnapshot()?.doc.lines[0]?.text).toBe("unsaved draft");
});

it("lets the renderer error fallback reload the app", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();

  render(<ErrorBoundary onReload={reload}><CrashOnRender /></ErrorBoundary>);
  fireEvent.click(screen.getByRole("button", { name: "새로고침" }));

  expect(reload).toHaveBeenCalledOnce();
});

it("uses the active language for the renderer error fallback action", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useI18nStore.getState().setLang("en");

  render(<ErrorBoundary onReload={vi.fn()}><CrashOnRender /></ErrorBoundary>);

  expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  useI18nStore.getState().setLang("ko");
});
