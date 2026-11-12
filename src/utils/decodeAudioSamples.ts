import { invoke } from "@tauri-apps/api/core";

const MAX_ANALYSIS_BUCKETS = 6_000;
const MAX_ANALYSIS_RESPONSE_BYTES = MAX_ANALYSIS_BUCKETS * Float32Array.BYTES_PER_ELEMENT;
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
    const payload = await invoke<unknown>("analyze_bpm_prefix", { path: audioPath, runId });
    checkCancelled(signal);
    let bytes: Uint8Array;
    if (payload instanceof ArrayBuffer) {
      bytes = new Uint8Array(payload);
    } else if (payload instanceof Uint8Array) {
      bytes = payload;
    } else if (Array.isArray(payload)
      && payload.length <= MAX_ANALYSIS_RESPONSE_BYTES
      && payload.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff)) {
      bytes = Uint8Array.from(payload);
    } else {
      throw new DOMException("Invalid audio analysis response", "EncodingError");
    }
    if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
      || bytes.byteLength > MAX_ANALYSIS_RESPONSE_BYTES) {
      throw new DOMException("Audio analysis exceeded its prefix limit", "EncodingError");
    }
    const samples = new Float32Array(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index++) {
      samples[index] = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
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
