import { invoke } from "@tauri-apps/api/core";

const MAX_ANALYSIS_BUCKETS = 6_000;
const ANALYSIS_SAMPLE_RATE = 50;
let cancellationQueue: Promise<unknown> = Promise.resolve();

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Audio analysis cancelled", "AbortError");
}

function requestNativeCancellation(runId: string): Promise<unknown> {
  cancellationQueue = cancellationQueue
    .catch(() => undefined)
    .then(() => invoke("cancel_audio_analysis", { runId }));
  return cancellationQueue;
}

/** Ask the native decoder for the first two minutes as 20 ms mono RMS buckets. */
export async function decodeAudioSamples(
  audioPath: string,
  signal?: AbortSignal,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  checkCancelled(signal);
  const runId = crypto.randomUUID();
  const cancelNative = () => { void requestNativeCancellation(runId).catch(() => undefined); };
  signal?.addEventListener("abort", cancelNative, { once: true });

  try {
    await cancellationQueue.catch(() => undefined);
    checkCancelled(signal);
    const bytes = await invoke<ArrayBuffer>("analyze_bpm_prefix", { path: audioPath, runId });
    checkCancelled(signal);
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new DOMException("Invalid audio analysis response", "EncodingError");
    }
    const samples = new Float32Array(bytes);
    if (samples.length > MAX_ANALYSIS_BUCKETS) {
      throw new DOMException("Audio analysis exceeded its prefix limit", "EncodingError");
    }
    return { samples, sampleRate: ANALYSIS_SAMPLE_RATE };
  } catch (error) {
    if (signal?.aborted || error === "cancelled") {
      throw new DOMException("Audio analysis cancelled", "AbortError");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelNative);
  }
}
