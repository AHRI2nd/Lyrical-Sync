import { invoke } from "@tauri-apps/api/core";

// AIFF 트랜스코딩은 Windows WebView2 전용(미지원 포맷) — macOS는 AIFF 네이티브 지원.
// Rust가 WAV 바이트를 직접 반환하므로 공유 임시 파일을 만들 필요가 없다.
function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Audio load cancelled", "AbortError");
}

async function decodeAiffIfNeeded(audioPath: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  checkCancelled(signal);
  const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
  const isAiff = ext === "aiff" || ext === "aif";
  const isWindows = navigator.platform.startsWith("Win");
  if (isAiff && isWindows) {
    const buf = await invoke<ArrayBuffer>("decode_audio_to_wav", { path: audioPath });
    checkCancelled(signal);
    return new Uint8Array(buf);
  }
  return null;
}

// Native code validates audio metadata and reads the bytes from the same open
// file handle. Splitting validation, filesystem reads, and identity checks across
// separate calls can decode a replacement that was never checked against the
// decoded-memory budget.
export async function readAudioBytes(audioPath: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; transcoded: boolean }> {
  checkCancelled(signal);
  const decoded = await decodeAiffIfNeeded(audioPath, signal);
  if (decoded) return { bytes: decoded, transcoded: true };
  
  const buf = await invoke<ArrayBuffer>("read_audio_file", { path: audioPath });
  checkCancelled(signal);
  return { bytes: new Uint8Array(buf), transcoded: false };
}
