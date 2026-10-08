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
