import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

// AIFF 트랜스코딩은 Windows WebView2 전용(미지원 포맷) — macOS는 AIFF 네이티브 지원.
// Rust가 WAV 바이트를 직접 반환하므로 공유 임시 파일을 만들 필요가 없다.
async function decodeAiffIfNeeded(audioPath: string): Promise<Uint8Array | null> {
  const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
  const isAiff = ext === "aiff" || ext === "aif";
  const isWindows = navigator.platform.startsWith("Win");
  if (isAiff && isWindows) {
    const buf = await invoke<ArrayBuffer>("decode_audio_to_wav", { path: audioPath });
    return new Uint8Array(buf);
  }
  return null;
}

// 오디오 파일을 바이트로 읽음. fs 스코프(미디어 디렉터리) 내 파일은 plugin readFile(빠른
// 바이너리 채널), 스코프 밖(임시 폴더·외장 드라이브 등)은 스코프 제약 없는 Rust 커맨드로 폴백.
export async function readAudioBytes(audioPath: string): Promise<{ bytes: Uint8Array; transcoded: boolean }> {
  const decoded = await decodeAiffIfNeeded(audioPath);
  if (decoded) return { bytes: decoded, transcoded: true };
  try {
    return { bytes: await readFile(audioPath), transcoded: false };
  } catch {
    const buf = await invoke<ArrayBuffer>("read_audio_file", { path: audioPath });
    return { bytes: new Uint8Array(buf), transcoded: false };
  }
}
