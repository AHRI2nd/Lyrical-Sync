import type { LrcDocument } from "../types/lrc";
import type { FileRef } from "./fileAccess";
import type { RecentFileEntry } from "../stores/useSettingsStore";

export type DocumentIntent =
  | { kind: "new" }
  | { kind: "file"; file: FileRef; audio?: FileRef | null }
  | { kind: "recent"; entry: RecentFileEntry }
  | { kind: "raw"; text: string }
  | { kind: "recovery"; doc: LrcDocument; lyrics: FileRef | null; audio: FileRef | null };
export type TransitionChoice = "save" | "discard" | "cancel";
export interface DocumentSnapshot { session: number; revision: number; dirty: boolean }
type Confirm = () => Promise<TransitionChoice>;
let dismiss = () => {};
export const cancelDocumentConfirmation = () => dismiss();
let confirmation: Confirm = async () => "cancel";
export function setDocumentConfirmation(handler: Confirm, cancel = () => {}): () => void {
  confirmation = handler;
  dismiss = cancel;
  return () => { if (confirmation === handler) { confirmation = async () => "cancel"; dismiss = () => {}; } };
}
export const confirmDocumentReplacement = () => confirmation();
const unchanged = (a: DocumentSnapshot, b: DocumentSnapshot) => a.session === b.session && a.revision === b.revision;

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
        if (!await options.save()) return null;
        if (!options.isCurrent()) return null;
        if (!unchanged(before, options.snapshot()) || options.snapshot().dirty) continue;
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
