import { afterEach, expect, it, vi } from "vitest";
import { runDocumentTransition, setDocumentConfirmation } from "./documentTransition";

afterEach(() => setDocumentConfirmation(async () => "cancel")());

it.each(["save", "discard", "cancel"] as const)("honors the %s choice for a dirty document", async (choice) => {
  let snapshot = { session: 1, revision: 4, dirty: true };
  const confirm = vi.fn(async () => choice);
  const save = vi.fn(async () => {
    if (choice === "save") snapshot = { ...snapshot, dirty: false };
    return true;
  });
  const apply = vi.fn();
  const result = await runDocumentTransition({
    snapshot: () => snapshot,
    isCurrent: () => true,
    confirm,
    save,
    prepare: async () => "fetched lyrics",
    apply,
  });

  expect(result).toBe(choice === "cancel" ? "cancelled" : "applied");
  expect(save).toHaveBeenCalledTimes(choice === "save" ? 1 : 0);
  expect(apply).toHaveBeenCalledTimes(choice === "cancel" ? 0 : 1);
  expect(snapshot).toEqual({ session: 1, revision: 4, dirty: choice !== "save" });
});

it("applies clean documents without prompting", async () => {
  const confirm = vi.fn(async () => "cancel" as const);
  const apply = vi.fn();
  const result = await runDocumentTransition({
    snapshot: () => ({ session: 1, revision: 0, dirty: false }),
    isCurrent: () => true,
    confirm,
    save: async () => true,
    prepare: async () => 42,
    apply,
  });
  expect(result).toBe("applied");
  expect(confirm).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledWith(42);
});

it("reconfirms after edits made while the user is deciding", async () => {
  let snapshot = { session: 1, revision: 1, dirty: true };
  const confirm = vi.fn()
    .mockImplementationOnce(async () => { snapshot = { ...snapshot, revision: 2 }; return "discard" as const; })
    .mockResolvedValueOnce("cancel" as const);
  const apply = vi.fn();
  const result = await runDocumentTransition({
    snapshot: () => snapshot,
    isCurrent: () => true,
    confirm,
    save: async () => true,
    prepare: async () => "lyrics",
    apply,
  });
  expect(result).toBe("cancelled");
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
});

it("preserves the current document when saving fails or a newer session replaces it", async () => {
  const snapshot = { session: 1, revision: 1, dirty: true };
  const apply = vi.fn();
  const saveFailure = await runDocumentTransition({
    snapshot: () => snapshot,
    isCurrent: () => true,
    confirm: async () => "save",
    save: async () => { throw new Error("disk full"); },
    prepare: async () => "lyrics",
    apply,
  });
  expect(saveFailure).toBe("cancelled");

  const staleSession = await runDocumentTransition({
    snapshot: () => snapshot,
    isCurrent: () => false,
    confirm: async () => "discard",
    save: async () => true,
    prepare: async () => "lyrics",
    apply,
  });
  expect(staleSession).toBe("cancelled");
  expect(apply).not.toHaveBeenCalled();
});

it("asks again when a manual edit happens while the selected save is in progress", async () => {
  let snapshot = { session: 1, revision: 2, dirty: true };
  const confirm = vi.fn()
    .mockResolvedValueOnce("save" as const)
    .mockResolvedValueOnce("cancel" as const);
  const save = vi.fn(async () => {
    snapshot = { session: 1, revision: 3, dirty: true };
    return true;
  });
  const apply = vi.fn();
  const result = await runDocumentTransition({
    snapshot: () => snapshot,
    isCurrent: () => true,
    confirm,
    save,
    prepare: async () => "lyrics",
    apply,
  });
  expect(result).toBe("cancelled");
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
});
