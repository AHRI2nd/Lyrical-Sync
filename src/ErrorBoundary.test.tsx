// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { useLrcStore } from "./stores/useLrcStore";
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
