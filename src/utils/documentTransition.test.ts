import { expect, it, vi } from "vitest";
import { runDocumentTransition } from "./documentTransition";

it("blocks replacement when saving is cancelled", async () => {
  const apply = vi.fn();
  const state = { session: 1, revision: 1, dirty: true };
  const result = await runDocumentTransition({
    snapshot: () => state, isCurrent: () => true, confirm: async () => "save",
    save: async () => false, prepare: async () => "new", apply,
  });
  expect(result).toBe("cancelled");
  expect(apply).not.toHaveBeenCalled();
});

it("preserves save failures as a distinct transition error and never applies the replacement", async () => {
  const apply = vi.fn();
  const prepare = vi.fn(async () => "new");
  const saveError = new Error("simulated disk write failure");
  const state = { session: 1, revision: 1, dirty: true };
  const result = runDocumentTransition({
    snapshot: () => state, isCurrent: () => true, confirm: async () => "save",
    save: async () => { throw saveError; }, prepare, apply,
  });

  await expect(result).rejects.toMatchObject({ name: "DocumentTransitionSaveError", cause: saveError });
  expect(prepare).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

it("continues replacement only after a successful save clears the dirty snapshot", async () => {
  const state = { session: 1, revision: 1, dirty: true };
  const apply = vi.fn();
  const result = await runDocumentTransition({
    snapshot: () => state, isCurrent: () => true, confirm: async () => "save",
    save: async () => { state.dirty = false; return true; },
    prepare: async () => "new", apply,
  });

  expect(result).toBe("applied");
  expect(apply).toHaveBeenCalledWith("new");
});

it("rechecks edits during confirmation and prepared file reads", async () => {
  const state = { session: 1, revision: 1, dirty: true };
  const apply = vi.fn();
  const confirm = vi.fn(async () => {
    if (state.revision === 1) state.revision++;
    return confirm.mock.calls.length === 3 ? "cancel" as const : "discard" as const;
  });
  const result = await runDocumentTransition({
    snapshot: () => ({ ...state }), isCurrent: () => true, confirm,
    save: async () => true, prepare: async () => { state.revision++; return "new"; }, apply,
  });
  expect(result).toBe("cancelled");
  expect(confirm).toHaveBeenCalledTimes(3);
  expect(apply).not.toHaveBeenCalled();
});
