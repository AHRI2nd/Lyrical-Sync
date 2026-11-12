import { invoke } from "@tauri-apps/api/core";
import type { FileRef } from "./fileAccess";

const MAX_ANALYSIS_BUCKETS = 6_000;
let cancellationQueue: Promise<unknown> = Promise.resolve();

interface NativeBpmResult {
  samples: number[];
  sample_rate: number;
  file: FileRef;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Audio analysis cancelled", "AbortError");
}

function requestNativeCancellation(runId: string): Promise<unknown> {
  cancellationQueue = cancellationQueue
    .catch(() => undefined)
    .then(() => invoke("cancel_audio_analysis", { runId }));
  return cancellationQueue;
}

/** Ask the native decoder for at most two minutes as 20 ms mono RMS buckets. */
export async function decodeBpmAudioPrefix(
  audioPath: string,
  bookmark: string | null = null,
  signal?: AbortSignal,
): Promise<{ samples: Float32Array; sampleRate: number; file: FileRef }> {
  checkCancelled(signal);
  const runId = crypto.randomUUID();
  const cancelNative = () => { void requestNativeCancellation(runId).catch(() => undefined); };
  signal?.addEventListener("abort", cancelNative, { once: true });

  try {
    await cancellationQueue.catch(() => undefined);
    checkCancelled(signal);
    const result = await invoke<NativeBpmResult>("analyze_bpm_prefix", {
      path: audioPath,
      bookmark,
      runId,
    });
    checkCancelled(signal);
    if (!result || !Array.isArray(result.samples) || result.samples.length > MAX_ANALYSIS_BUCKETS ||
      result.sample_rate !== 50 || !result.file || typeof result.file.path !== "string" ||
      !(result.file.bookmark === null || typeof result.file.bookmark === "string") ||
      !result.samples.every((sample) => typeof sample === "number" && Number.isFinite(sample))) {
      throw new DOMException("Invalid audio analysis response", "EncodingError");
    }
    return {
      samples: Float32Array.from(result.samples),
      sampleRate: result.sample_rate,
      file: result.file,
    };
  } catch (error) {
    if (signal?.aborted || error === "cancelled") {
      throw new DOMException("Audio analysis cancelled", "AbortError");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelNative);
  }
}
