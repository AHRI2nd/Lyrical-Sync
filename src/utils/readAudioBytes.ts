import { readFile } from "@tauri-apps/plugin-fs";
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

interface AudioFileInfo {
  size: number;
  mtime: number;
}

async function getFileInfo(audioPath: string): Promise<AudioFileInfo> {
  try {
    const meta = await invoke<{ size: number; mtime: number }>("get_audio_file_info", { path: audioPath });
    return { size: meta.size, mtime: meta.mtime };
  } catch {
    // Fallback to FS plugin
    const bytes = await readFile(audioPath);
    // We can't get mtime from plugin-fs easily, so we use a hash of the path as a weak substitute
    return { size: bytes.byteLength, mtime: Date.now() };
  }
}

// 오디오 파일을 바이트로 읽음. fs 스코프(미디어 디렉터리) 내 파일은 plugin readFile(빠른
// 바이너리 채널), 스코프 밖(임시 폴더·외장 드라이브 등)은 스코프 제약 없는 Rust 커맨드로 폴백.
// 파일 아이덴티티(크기+mtime)를 검사해 TOCTOU 레이스 방지.
export async function readAudioBytes(audioPath: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; transcoded: boolean }> {
  checkCancelled(signal);
  const decoded = await decodeAiffIfNeeded(audioPath, signal);
  if (decoded) return { bytes: decoded, transcoded: true };
  
  // First validate the audio file (checks file size, duration, channels, sample rate, PCM budget)
  await invoke("validate_audio_file", { path: audioPath });
  checkCancelled(signal);
  
  // Then get file identity before read
  const infoBefore = await getFileInfo(audioPath);
  
  try {
    const bytes = await readFile(audioPath);
    checkCancelled(signal);
    // Verify file identity after read
    const infoAfterRead = await getFileInfo(audioPath);
    if (infoBefore.size !== infoAfterRead.size || infoBefore.mtime !== infoAfterRead.mtime) {
      throw new Error("Audio file changed during read");
    }
    return { bytes, transcoded: false };
  } catch {
    checkCancelled(signal);
    const buf = await invoke<ArrayBuffer>("read_audio_file", { path: audioPath });
    checkCancelled(signal);
    // Rust command read also validates identity
    const infoAfterRust = await getFileInfo(audioPath);
    if (infoBefore.size !== infoAfterRust.size || infoBefore.mtime !== infoAfterRust.mtime) {
      throw new Error("Audio file changed during read");
    }
    return { bytes: new Uint8Array(buf), transcoded: false };
  }
}
