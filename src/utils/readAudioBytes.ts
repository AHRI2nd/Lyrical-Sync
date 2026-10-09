import { invoke } from "@tauri-apps/api/core";
import { prepareFileRef, readAudio, type FileRef } from "./fileAccess";

// Windows WebView2 receives converted WAV directly as raw IPC bytes.
export async function readAudioBytes(
  audioPath: string,
  bookmark: string | null = null,
): Promise<{ bytes: Uint8Array; transcoded: boolean; file: FileRef }> {
  const input = { path: audioPath, bookmark };
  const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
  const isAiff = ext === "aiff" || ext === "aif";
  if (isAiff && navigator.platform.startsWith("Win")) {
    const file = await prepareFileRef(input);
    const buffer = await invoke<ArrayBuffer>("decode_audio_to_wav", { ...file });
    return { bytes: new Uint8Array(buffer), transcoded: true, file };
  }
  const result = await readAudio(input);
  return { bytes: result.value, transcoded: false, file: result.file };
}
