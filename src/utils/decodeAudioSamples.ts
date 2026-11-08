import { readAudioBytes } from "./readAudioBytes";

const MAX_AUDIO_PCM_BYTES = 1024 * 1024 * 1024; // 1 GiB

// Decode original PCM for local analysis; display peaks lose transient detail.
export async function decodeAudioSamples(audioPath: string, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
  const checkCancelled = () => {
    if (signal?.aborted) throw new DOMException("Audio analysis cancelled", "AbortError");
  };
  checkCancelled();
  const { bytes } = await readAudioBytes(audioPath, signal);
  checkCancelled();
  // Match the native resource estimate's Web Audio baseline so device output
  // rates cannot silently inflate decoded PCM for local analysis.
  const ctx = new AudioContext({ sampleRate: 48_000 });
  try {
    // decodeAudioData consumes its ArrayBuffer. The file reader returns a fresh byte
    // view, and nothing reads it after this call, so reuse complete ArrayBuffers
    // rather than making another potentially 1 GiB encoded-audio allocation.
    // Partial and SharedArrayBuffer-backed views still need an exact owned copy.
    const backing = bytes.buffer;
    let arrayBuffer: ArrayBuffer;
    if (backing instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === backing.byteLength) {
      arrayBuffer = backing;
    } else {
      const exact = new Uint8Array(bytes.byteLength);
      exact.set(bytes);
      arrayBuffer = exact.buffer;
    }
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    checkCancelled();
    const channels = audioBuffer.numberOfChannels;
    const { length, sampleRate } = audioBuffer;
    
    // Validate decoded PCM size against 1 GiB limit
    const estimatedPcmBytes = BigInt(length) * BigInt(channels) * 4n;
    if (estimatedPcmBytes > BigInt(MAX_AUDIO_PCM_BYTES)) {
      throw new Error("AUDIO_RESOURCE_LIMIT: Decoded PCM exceeds 1 GiB limit");
    }
    
    // Average channels in chunks so cancellation and UI events can run.
    const samples = new Float32Array(length);
    const channelData = Array.from({ length: channels }, (_, c) => audioBuffer.getChannelData(c));
    const chunkSize = 200000;
    for (let start = 0; start < length; start += chunkSize) {
      checkCancelled();
      const end = Math.min(length, start + chunkSize);
      for (const data of channelData) {
        for (let i = start; i < end; i++) samples[i] += data[i] / channels;
      }
      if (end < length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled();
    return { samples, sampleRate };
  } finally {
    // Closing a context must not replace the original decode/cancel error.
    try { await ctx.close(); } catch { /* Context may already be closed. */ }
  }
}
