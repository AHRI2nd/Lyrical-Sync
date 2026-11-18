// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const { onCloseRequested, closeWindow } = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  closeWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested, close: closeWindow }),
}));

import { useUnsavedCloseGuard } from "./useUnsavedCloseGuard";

afterEach(() => { cleanup(); onCloseRequested.mockReset(); closeWindow.mockReset(); });

it("blocks a dirty-window close and opens the application confirmation", async () => {
  let handler: ((event: { preventDefault: () => void }) => void) | undefined;
  onCloseRequested.mockImplementation(async (callback: typeof handler) => {
    handler = callback;
    return () => {};
  });
  const onRequest = vi.fn();
  renderHook(() => useUnsavedCloseGuard(() => true, onRequest, vi.fn()));
  await waitFor(() => expect(handler).toBeTypeOf("function"));
  const preventDefault = vi.fn();

  handler!({ preventDefault });

  expect(preventDefault).toHaveBeenCalledOnce();
  expect(onRequest).toHaveBeenCalledOnce();
});

it("prevents the native destroy fallback and closes through the authorized close API when clean", async () => {
  let handler: ((event: { preventDefault: () => void }) => void) | undefined;
  const unlisten = vi.fn();
  const destroy = vi.fn().mockRejectedValue(new Error("window.destroy is not allowed"));
  onCloseRequested.mockImplementation(async (callback: typeof handler) => {
    handler = callback;
    return unlisten;
  });
  closeWindow.mockResolvedValue(undefined);
  const onRequest = vi.fn();
  const { result } = renderHook(() => useUnsavedCloseGuard(() => false, onRequest, vi.fn()));
  await waitFor(() => expect(handler).toBeTypeOf("function"));
  const preventDefault = vi.fn();
  let prevented = false;

  handler!({
    preventDefault: () => {
      prevented = true;
      preventDefault();
    },
  });
  // Tauri's onCloseRequested wrapper calls destroy() unless the callback prevents the event.
  if (!prevented) await destroy();

  expect(preventDefault).toHaveBeenCalledOnce();
  expect(destroy).not.toHaveBeenCalled();
  expect(onRequest).not.toHaveBeenCalled();
  await waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
  expect(unlisten).toHaveBeenCalledOnce();
  expect(unlisten.mock.invocationCallOrder[0]).toBeLessThan(closeWindow.mock.invocationCallOrder[0]);
  expect(result.current).toBeTypeOf("function");
});

it("restores the close guard after the authorized close API rejects", async () => {
  let handler: ((event: { preventDefault: () => void }) => void) | undefined;
  const unlisten = vi.fn();
  onCloseRequested.mockImplementation(async (callback: typeof handler) => {
    handler = callback;
    return unlisten;
  });
  closeWindow.mockRejectedValueOnce(new Error("close rejected"));
  const onRequest = vi.fn();
  const onCloseError = vi.fn();
  const { result } = renderHook(() => useUnsavedCloseGuard(() => false, onRequest, onCloseError));
  await waitFor(() => expect(handler).toBeTypeOf("function"));

  await result.current();

  expect(unlisten).toHaveBeenCalledOnce();
  expect(onCloseRequested).toHaveBeenCalledTimes(2);
  expect(onCloseError).toHaveBeenCalledOnce();

  const preventDefault = vi.fn();
  handler!({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  await waitFor(() => expect(closeWindow).toHaveBeenCalledTimes(2));
});
