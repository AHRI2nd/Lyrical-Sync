import { safeUnlisten } from "./safeUnlisten";

/** Register an async Tauri event listener and always release it on cleanup. */
export function listenSafely(
  register: (isActive: () => boolean) => Promise<() => void>,
): () => void {
  let active = true;
  let unlisten: (() => void) | null = null;

  void register(() => active)
    .then((fn) => {
      if (active) unlisten = fn;
      else safeUnlisten(fn);
    })
    .catch(() => {});

  return () => {
    active = false;
    safeUnlisten(unlisten);
    unlisten = null;
  };
}
