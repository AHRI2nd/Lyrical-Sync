import { afterEach, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { checkModelFiles } from "./modelInventory";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => invokeMock.mockReset());

it("shares only an in-flight check for the same root and model", async () => {
  const first = deferred<boolean[]>();
  invokeMock.mockReturnValue(first.promise);

  const editorCheck = checkModelFiles("/models/a", "ctc");
  const settingsCheck = checkModelFiles("/models/a", "ctc");
  const otherRootCheck = checkModelFiles("/models/b", "ctc");
  const otherModelCheck = checkModelFiles("/models/a", "demucs");

  expect(settingsCheck).toBe(editorCheck);
  expect(otherRootCheck).not.toBe(editorCheck);
  expect(otherModelCheck).not.toBe(editorCheck);
  expect(invokeMock).toHaveBeenCalledTimes(3);
  expect(invokeMock).toHaveBeenNthCalledWith(1, "check_model_files", {
    expectedRoot: "/models/a",
    modelId: "ctc",
  });
  expect(invokeMock).toHaveBeenNthCalledWith(2, "check_model_files", {
    expectedRoot: "/models/b",
    modelId: "ctc",
  });
  expect(invokeMock).toHaveBeenNthCalledWith(3, "check_model_files", {
    expectedRoot: "/models/a",
    modelId: "demucs",
  });
  first.resolve([true]);
  await Promise.all([editorCheck, otherRootCheck, otherModelCheck]);
  await Promise.resolve();
});

it("does not cache settled or failed inventory results", async () => {
  invokeMock
    .mockResolvedValueOnce([true])
    .mockResolvedValueOnce([false])
    .mockRejectedValueOnce(new Error("inventory failed"))
    .mockResolvedValueOnce([true]);

  await expect(checkModelFiles("/models/a", "ctc")).resolves.toEqual([true]);
  await expect(checkModelFiles("/models/a", "ctc")).resolves.toEqual([false]);
  await expect(checkModelFiles("/models/a", "ctc")).rejects.toThrow("inventory failed");
  await expect(checkModelFiles("/models/a", "ctc")).resolves.toEqual([true]);
  expect(invokeMock).toHaveBeenCalledTimes(4);
});
