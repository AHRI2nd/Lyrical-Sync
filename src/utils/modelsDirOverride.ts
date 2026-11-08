import { invoke } from "@tauri-apps/api/core";

let overrideQueue: Promise<void> = Promise.resolve();

/** Keep native model-root changes in renderer request order. */
export function setModelsDirOverride(path: string | null): Promise<void> {
  const current = overrideQueue.then(async () => {
    await invoke("set_models_dir_override", { path });
  });
  overrideQueue = current.then(() => undefined, () => undefined);
  return current;
}
