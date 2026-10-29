import { invoke } from "@tauri-apps/api/core";
import { shiftSrtEnd } from "./lineTiming";
import type { LrcDocument } from "../types/lrc";
import { readLyrics, type FileRef } from "./fileAccess";
import { enqueuePathWrite } from "./pathWriteQueue";
import { parseLrc, serializeLrc } from "./lrcParser";
import { parseSrt, serializeSrt, SrtUnrepresentableContentError } from "./srtConverter";
import { AssUnrepresentableContentError, serializeVtt, serializeAss } from "./exportFormats";

export interface BatchFileEntry {
  id: string;
  file: FileRef;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  error?: string;
}
export type BatchOperation =
  | { kind: "offset"; deltaSeconds: number }
  | { kind: "convert"; format: "srt" | "vtt" | "ass" }
  | { kind: "tag"; title?: string; artist?: string; album?: string };
export interface BatchSummary { done: number; error: number; cancelled: number; }
export interface BatchTask { entry: BatchFileEntry; name: string; targetPath: string; }

export function batchOutputName(path: string, operation: BatchOperation): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || !["lrc", "srt"].includes(base.slice(dot + 1).toLowerCase())) {
    throw new Error(`Unsupported input: ${base}`);
  }
  const name = operation.kind === "convert" ? `${base.slice(0, dot)}.${operation.format}` : base;
  // Reject names that have different basename meanings on Windows and Unix.
  const stem = name.split(".")[0].replace(/[. ]+$/, "");
  if (!name || /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/.test(name) || /[. ]$/.test(name) || name === "." || name === ".." || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(stem)) {
    throw new Error(`Invalid output name: ${name}`);
  }
  return name;
}

export function preflightBatch(entries: BatchFileEntry[], operation: BatchOperation, output: FileRef): BatchTask[] {
  if (!output.path) throw new Error("Select an output folder.");
  if (operation.kind === "offset" && !Number.isFinite(operation.deltaSeconds)) throw new Error("Offset must be finite.");
  const names = new Set<string>();
  const ids = new Set<string>();
  return entries.map((entry) => {
    const name = batchOutputName(entry.file.path, operation);
    if (operation.kind === "tag" && entry.file.path.toLowerCase().endsWith(".srt")) throw new Error("Metadata tags require LRC input.");
    const key = name.normalize("NFC").toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate output: ${name}`);
    if (ids.has(entry.id)) throw new Error("Duplicate batch entry ID.");
    names.add(key);
    ids.add(entry.id);
    const separator = output.path.includes("\\") && !output.path.includes("/") ? "\\" : "/";
    const targetPath = output.path.replace(/[\\/]+$/, "") + separator + name;
    return { entry: { ...entry, file: { ...entry.file } }, name, targetPath };
  });
}

function transformDocument(doc: LrcDocument, operation: BatchOperation): LrcDocument {
  if (operation.kind === "offset") {
    return {
      ...doc,
      lines: doc.lines.map((line) => {
        const timestamp = line.timestamp === null ? null : Math.max(0, line.timestamp + operation.deltaSeconds);
        return {
          ...line,
          timestamp,
          srtEndTime: shiftSrtEnd(line, operation.deltaSeconds, timestamp),
          syllables: line.syllables?.map((s) => ({ ...s, time: s.time === null ? null : Math.max(0, s.time + operation.deltaSeconds) })),
        };
      }),
    };
  }
  if (operation.kind === "tag") {
    const metadata = { ...doc.metadata };
    for (const field of ["title", "artist", "album"] as const) {
      const value = operation[field];
      if (value?.trim()) metadata[field] = value.trim();
    }
    return { ...doc, metadata };
  }
  return doc;
}

export async function runBatchOperation(
  entries: BatchFileEntry[], operation: BatchOperation, output: FileRef,
  onStatus: (id: string, status: BatchFileEntry["status"], error?: string, file?: FileRef) => void,
  options: { signal?: AbortSignal; concurrency?: number } = {},
): Promise<BatchSummary> {
  // Clone every run input before the first asynchronous read.
  const operationSnapshot = { ...operation };
  const outputSnapshot = { ...output };
  const tasks = preflightBatch(entries, operationSnapshot, outputSnapshot);
  const summary: BatchSummary = { done: 0, error: 0, cancelled: 0 };
  let next = 0;
  const concurrency = Number.isFinite(options.concurrency) ? Math.max(1, Math.min(4, Math.floor(options.concurrency!))) : 4;
  const worker = async () => {
    while (next < tasks.length && !options.signal?.aborted) {
      const task = tasks[next++];
      let refreshed: FileRef | undefined;
      onStatus(task.entry.id, "processing", undefined, undefined);
      try {
        const result = await readLyrics(task.entry.file);
        refreshed = result.file;
        const isSrt = task.entry.file.path.toLowerCase().endsWith(".srt");
        const doc = transformDocument(isSrt ? parseSrt(result.value) : parseLrc(result.value), operationSnapshot);
        const format = operationSnapshot.kind === "convert" ? operationSnapshot.format : isSrt ? "srt" : "lrc";
        const content = format === "lrc" ? serializeLrc(doc) : format === "srt" ? serializeSrt(doc) : format === "vtt" ? serializeVtt(doc) : serializeAss(doc);
        // An active file finishes even after cancellation. The native command never clobbers a destination.
        await enqueuePathWrite(task.targetPath, () => invoke<void>("write_batch_output", {
          outputDir: outputSnapshot.path, outputBookmark: outputSnapshot.bookmark, name: task.name, content,
        }));
        summary.done++;
        onStatus(task.entry.id, "done", undefined, refreshed);
      } catch (error) {
        summary.error++;
        const message = error instanceof SrtUnrepresentableContentError || error instanceof AssUnrepresentableContentError
          ? error.code
          : error instanceof Error ? error.message : String(error);
        onStatus(task.entry.id, "error", message, refreshed);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  for (const task of tasks.slice(next)) {
    summary.cancelled++;
    onStatus(task.entry.id, "cancelled", undefined, undefined);
  }
  return summary;
}
