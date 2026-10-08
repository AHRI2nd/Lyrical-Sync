import { invoke } from "@tauri-apps/api/core";
import { prepareFileRef, readAudio, type FileRef } from "./fileAccess";

// Windows WebView2 needs AIFF conversion. The temporary WAV contract remains
// until P06 replaces it with a direct binary conversion response.
export async function readAudioBytes(
  audioPath: string,
  bookmark: string | null = null,
): Promise<{ bytes: Uint8Array; transcoded: boolean; file: FileRef }> {
  const input = { path: audioPath, bookmark };
  const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
  const isAiff = ext === "aiff" || ext === "aif";
  if (isAiff && navigator.platform.startsWith("Win")) {
    const file = await prepareFileRef(input);
    const path = await invoke<string>("decode_audio_to_wav", { ...file });
    const result = await readAudio({ path, bookmark: null });
    return { bytes: result.value, transcoded: true, file };
  }
  const result = await readAudio(input);
  return { bytes: result.value, transcoded: false, file: result.file };
}
