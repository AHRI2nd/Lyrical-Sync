import { invoke } from "@tauri-apps/api/core";

// The direct edition uses native path access; Store supplies a scoped adapter.
export interface FileRef { path: string; bookmark: string | null }
export async function readLyrics(file: FileRef): Promise<{ value: string; file: FileRef }> {
  return { value: await invoke<string>("read_lrc_file", { path: file.path }), file };
}
