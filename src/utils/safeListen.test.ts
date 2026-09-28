import { describe, expect, it, vi } from "vitest";
import { listenSafely } from "./safeListen";

describe("listenSafely", () => {
  it("unlistens if registration resolves after cleanup", async () => {
    let resolveRegistration!: (unlisten: () => void) => void;
    const registration = new Promise<() => void>((resolve) => { resolveRegistration = resolve; });
    const unlisten = vi.fn();
    const cleanup = listenSafely(() => registration);

    cleanup();
    resolveRegistration(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("unlistens on cleanup after registration", async () => {
    const unlisten = vi.fn();
    const cleanup = listenSafely(async () => unlisten);
    await Promise.resolve();

    cleanup();

    expect(unlisten).toHaveBeenCalledOnce();
  });
});
