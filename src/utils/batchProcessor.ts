// 일괄 처리 도구: 여러 LRC/SRT 파일에 하나의 작업(오프셋 적용 · 포맷 변환 · 태그 채우기)을
// 순차 적용. useLrcStore(라이브 편집 상태)를 전혀 거치지 않고 파일을 직접 읽고/쓴다 —
// 열려있는 문서와 무관하게, 닫힌 여러 파일을 한 번에 처리하기 위함.

import { invoke } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";
import { parseLrc, serializeLrc } from "./lrcParser";
import { parseSrt, serializeSrt } from "./srtConverter";
import { serializeVtt, serializeAss } from "./exportFormats";
import type { LrcDocument } from "../types/lrc";

const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"];

export interface BatchFileEntry {
  lrcPath: string;
  audioPath: string | null;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
}

export type BatchOperation =
  | { kind: "offset"; deltaSeconds: number }
  | { kind: "convert"; format: "srt" | "vtt" | "ass" }
  | { kind: "tag"; title?: string; artist?: string; album?: string };

function splitPath(path: string): { dir: string; base: string } {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? { dir: path.slice(0, i), base: path.slice(i + 1) } : { dir: ".", base: path };
}

function stemOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(0, dot) : filename;
}

/** lrcPath와 같은 폴더에서 파일명 stem이 일치하는 오디오 파일을 best-effort로 찾는다.
 *  스코프 밖 폴더 등으로 읽기가 실패하면 null(사용자가 목록에서 직접 채울 수 있음). */
export async function findMatchingAudio(lrcPath: string): Promise<string | null> {
  const { dir, base } = splitPath(lrcPath);
  const stem = stemOf(base);
  try {
    const entries = await readDir(dir);
    for (const entry of entries) {
      if (!entry.isFile) continue;
      const eDot = entry.name.lastIndexOf(".");
      if (eDot < 0) continue;
      const eStem = entry.name.slice(0, eDot);
      const eExt = entry.name.slice(eDot + 1).toLowerCase();
      if (eStem === stem && AUDIO_EXTENSIONS.includes(eExt)) return `${dir}/${entry.name}`;
    }
  } catch {
    // 읽기 실패 — 매칭 없음으로 처리
  }
  return null;
}

async function readLrcOrSrt(path: string): Promise<LrcDocument> {
  const content: string = await invoke("read_lrc_file", { path });
  const isSrt = path.toLowerCase().endsWith(".srt");
  return isSrt ? parseSrt(content) : parseLrc(content);
}

async function applyOffsetToFile(lrcPath: string, deltaSeconds: number): Promise<void> {
  const doc = await readLrcOrSrt(lrcPath);
  const shifted: LrcDocument = {
    ...doc,
    lines: doc.lines.map((l) => ({
      ...l,
      timestamp: l.timestamp !== null ? Math.max(0, l.timestamp + deltaSeconds) : null,
      syllables: l.syllables?.map((s) => ({ ...s, time: s.time !== null ? Math.max(0, s.time + deltaSeconds) : null })),
    })),
  };
  const isSrt = lrcPath.toLowerCase().endsWith(".srt");
  const content = isSrt ? serializeSrt(shifted) : serializeLrc(shifted);
  await invoke("write_lrc_file", { path: lrcPath, content });
}

function withExtension(path: string, ext: string): string {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 ? path.slice(0, dot) : path) + "." + ext;
}

async function convertFileFormat(lrcPath: string, format: "srt" | "vtt" | "ass"): Promise<void> {
  const doc = await readLrcOrSrt(lrcPath);
  const content =
    format === "srt" ? serializeSrt(doc)
    : format === "vtt" ? serializeVtt(doc)
    : serializeAss(doc);
  await invoke("write_lrc_file", { path: withExtension(lrcPath, format), content });
}

// LRC 파일 자체의 태그(ti/ar/al)만 대상 — 오디오 파일 ID3/Vorbis 태그를 쓰는 커맨드는
// 없음(read_audio_metadata는 읽기 전용). SRT는 메타데이터 태그 개념이 없어 대상에서 제외.
async function applyTagsToFile(lrcPath: string, tags: { title?: string; artist?: string; album?: string }): Promise<void> {
  if (lrcPath.toLowerCase().endsWith(".srt")) {
    throw new Error("SRT files have no metadata tags");
  }
  const doc = await readLrcOrSrt(lrcPath);
  const metadata = {
    ...doc.metadata,
    ...(tags.title ? { title: tags.title } : {}),
    ...(tags.artist ? { artist: tags.artist } : {}),
    ...(tags.album ? { album: tags.album } : {}),
  };
  await invoke("write_lrc_file", { path: lrcPath, content: serializeLrc({ ...doc, metadata }) });
}

const DEFAULT_CONCURRENCY = 4;

export async function runBatchOperation(
  entries: BatchFileEntry[],
  operation: BatchOperation,
  onProgress: (index: number, status: BatchFileEntry["status"], error?: string) => void,
  options: { signal?: AbortSignal; concurrency?: number } = {}
): Promise<void> {
  const { signal, concurrency = DEFAULT_CONCURRENCY } = options;
  let cursor = 0;

  const worker = async () => {
    while (cursor < entries.length) {
      if (signal?.aborted) return;
      const i = cursor++;
      onProgress(i, "processing");
      try {
        if (operation.kind === "offset") await applyOffsetToFile(entries[i].lrcPath, operation.deltaSeconds);
        else if (operation.kind === "convert") await convertFileFormat(entries[i].lrcPath, operation.format);
        else await applyTagsToFile(entries[i].lrcPath, operation);
        onProgress(i, "done");
      } catch (err) {
        onProgress(i, "error", String(err));
      }
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, entries.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
}
