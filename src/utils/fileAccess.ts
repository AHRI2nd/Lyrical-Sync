import { invoke } from "@tauri-apps/api/core";

export interface FileRef {
  path: string;
  bookmark: string | null;
}
export interface FileResult<T> {
  value: T;
  file: FileRef;
}
export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
}

export async function prepareFileRef(file: FileRef): Promise<FileRef> {
  if (!file.bookmark) return { ...file };
  // Native preparation resolves/refreshes the reference without retaining scope.
  return invoke<FileRef>("prepare_file_ref", { ...file });
}

export async function readLyrics(file: FileRef): Promise<FileResult<string>> {
  const prepared = await prepareFileRef(file);
  const value = await invoke<string>("read_lrc_file", { ...prepared });
  return { value, file: prepared };
}

export async function writeLyrics(file: FileRef, content: string): Promise<FileResult<void>> {
  const prepared = await prepareFileRef(file);
  await invoke("write_lrc_file", { ...prepared, content });
  return { value: undefined, file: prepared };
}

export async function readAudio(file: FileRef): Promise<FileResult<Uint8Array>> {
  const prepared = await prepareFileRef(file);
  const buffer = await invoke<ArrayBuffer>("read_audio_file", { ...prepared });
  return { value: new Uint8Array(buffer), file: prepared };
}

export async function readAudioMetadata(file: FileRef): Promise<FileResult<AudioMetadata>> {
  const prepared = await prepareFileRef(file);
  const value = await invoke<AudioMetadata>("read_audio_metadata", { ...prepared });
  return { value, file: prepared };
}
