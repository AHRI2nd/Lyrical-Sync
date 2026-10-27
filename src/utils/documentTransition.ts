export type TransitionChoice = "save" | "discard" | "cancel";
export interface DocumentSnapshot { session: number; revision: number; dirty: boolean }
type Confirm = () => Promise<TransitionChoice>;

let dismissCurrent = () => {};
let confirmation: Confirm = async () => "cancel";

export function setDocumentConfirmation(handler: Confirm, dismiss = () => {}): () => void {
  confirmation = handler;
  dismissCurrent = dismiss;
  return () => {
    if (confirmation !== handler) return;
    confirmation = async () => "cancel";
    dismissCurrent = () => {};
  };
}

export function cancelDocumentConfirmation(): void {
  dismissCurrent();
}

export function confirmDocumentReplacement(): Promise<TransitionChoice> {
  return confirmation();
}

const unchanged = (left: DocumentSnapshot, right: DocumentSnapshot) =>
  left.session === right.session && left.revision === right.revision;

export async function runDocumentTransition<T>(options: {
  snapshot: () => DocumentSnapshot;
  isCurrent: () => boolean;
  confirm: Confirm;
  save: () => Promise<boolean>;
  prepare: () => Promise<T>;
  apply: (prepared: T) => void;
}): Promise<"applied" | "cancelled"> {
  const authorize = async (): Promise<DocumentSnapshot | null> => {
    while (options.isCurrent()) {
      const before = options.snapshot();
      if (!before.dirty) return before;
      const choice = await options.confirm();
      if (!options.isCurrent() || choice === "cancel") return null;
      if (!unchanged(before, options.snapshot())) continue;
      if (choice === "save") {
        try {
          if (!await options.save()) return null;
        } catch {
          return null;
        }
        if (!options.isCurrent()) return null;
        const afterSave = options.snapshot();
        if (!unchanged(before, afterSave) || afterSave.dirty) continue;
      }
      return before;
    }
    return null;
  };

  let approved = await authorize();
  if (!approved) return "cancelled";
  const prepared = await options.prepare();
  if (!options.isCurrent()) return "cancelled";
  if (!unchanged(approved, options.snapshot())) {
    approved = await authorize();
    if (!approved) return "cancelled";
  }
  if (!options.isCurrent()) return "cancelled";
  options.apply(prepared);
  return "applied";
}
