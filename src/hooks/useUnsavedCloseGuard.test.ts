// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const { onCloseRequested } = vi.hoisted(() => ({ onCloseRequested: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested }),
}));

import { useUnsavedCloseGuard } from "./useUnsavedCloseGuard";

afterEach(() => { cleanup(); onCloseRequested.mockReset(); });

it("blocks a dirty-window close and opens the application confirmation", async () => {
  let handler: ((event: { preventDefault: () => void }) => void) | undefined;
  onCloseRequested.mockImplementation(async (callback: typeof handler) => {
    handler = callback;
    return () => {};
  });
  const onRequest = vi.fn();
  renderHook(() => useUnsavedCloseGuard(() => true, onRequest));
  await waitFor(() => expect(handler).toBeTypeOf("function"));
  const preventDefault = vi.fn();

  handler!({ preventDefault });

  expect(preventDefault).toHaveBeenCalledOnce();
  expect(onRequest).toHaveBeenCalledOnce();
});

it("allows closing when the document is clean", async () => {
  let handler: ((event: { preventDefault: () => void }) => void) | undefined;
  onCloseRequested.mockImplementation(async (callback: typeof handler) => {
    handler = callback;
    return () => {};
  });
  const onRequest = vi.fn();
  renderHook(() => useUnsavedCloseGuard(() => false, onRequest));
  await waitFor(() => expect(handler).toBeTypeOf("function"));
  const preventDefault = vi.fn();

  handler!({ preventDefault });

  expect(preventDefault).not.toHaveBeenCalled();
  expect(onRequest).not.toHaveBeenCalled();
});
