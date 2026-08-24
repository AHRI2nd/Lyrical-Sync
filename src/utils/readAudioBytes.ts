import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

// AIFF 트랜스코딩은 Windows WebView2 전용(미지원 포맷) — macOS는 AIFF 네이티브 지원.
// 또한 macOS 임시 폴더(/var/folders/…)는 $HOME 밖이라 readFile이 실패하므로 필요 없음.
async function resolveReadablePath(audioPath: string): Promise<{ path: string; transcoded: boolean }> {
  const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
  const isAiff = ext === "aiff" || ext === "aif";
  const isWindows = navigator.platform.startsWith("Win");
  if (isAiff && isWindows) {
    return { path: await invoke<string>("decode_audio_to_wav", { path: audioPath }), transcoded: true };
  }
  return { path: audioPath, transcoded: false };
}

// 오디오 파일을 바이트로 읽음. fs 스코프(미디어 디렉터리) 내 파일은 plugin readFile(빠른
// 바이너리 채널), 스코프 밖(임시 폴더·외장 드라이브 등)은 스코프 제약 없는 Rust 커맨드로 폴백.
export async function readAudioBytes(audioPath: string): Promise<{ bytes: Uint8Array; transcoded: boolean }> {
  const { path, transcoded } = await resolveReadablePath(audioPath);
  try {
    return { bytes: await readFile(path), transcoded };
  } catch {
    const buf = await invoke<ArrayBuffer>("read_audio_file", { path });
    return { bytes: new Uint8Array(buf), transcoded };
  }
}
