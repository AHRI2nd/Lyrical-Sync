import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { setModelsDirOverride } from "./modelsDirOverride";

describe("setModelsDirOverride", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("serializes overlapping native updates so the latest selected root wins", async () => {
    let finishFirst!: () => void;
    const firstNativeCall = new Promise<void>((resolve) => { finishFirst = resolve; });
    const appliedRoots: (string | null)[] = [];
    invoke.mockImplementation((_command: string, args: { path: string | null }) => {
      appliedRoots.push(args.path);
      return appliedRoots.length === 1 ? firstNativeCall : Promise.resolve();
    });

    const first = setModelsDirOverride("/models/old");
    const latest = setModelsDirOverride("/models/new");
    await Promise.resolve();
    expect(appliedRoots).toEqual(["/models/old"]);

    finishFirst();
    await Promise.all([first, latest]);

    expect(appliedRoots).toEqual(["/models/old", "/models/new"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("continues the queue after an earlier native update fails", async () => {
    invoke
      .mockRejectedValueOnce(new Error("first update failed"))
      .mockResolvedValueOnce(undefined);

    const first = setModelsDirOverride("/models/old");
    const latest = setModelsDirOverride("/models/new");

    await expect(first).rejects.toThrow("first update failed");
    await expect(latest).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(2, "set_models_dir_override", { path: "/models/new" });
  });
});
