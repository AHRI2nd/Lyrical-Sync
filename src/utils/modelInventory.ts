import { invoke } from "@tauri-apps/api/core";

const pendingChecks = new Map<string, Promise<boolean[]>>();

export function checkModelFiles(expectedRoot: string, modelId: string): Promise<boolean[]> {
  const key = JSON.stringify([expectedRoot, modelId]);
  const pending = pendingChecks.get(key);
  if (pending) return pending;

  const request = invoke<boolean[]>("check_model_files", { expectedRoot, modelId }).finally(() => {
    if (pendingChecks.get(key) === request) pendingChecks.delete(key);
  });
  pendingChecks.set(key, request);
  return request;
}
