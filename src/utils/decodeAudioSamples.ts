import { readAudioBytes } from "./readAudioBytes";

// Decode original PCM for local analysis; display peaks lose transient detail.
export async function decodeAudioSamples(audioPath: string, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
  const checkCancelled = () => {
    if (signal?.aborted) throw new DOMException("Audio analysis cancelled", "AbortError");
  };
  checkCancelled();
  const { bytes } = await readAudioBytes(audioPath);
  checkCancelled();
  const ctx = new AudioContext();
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    checkCancelled();
    const channels = audioBuffer.numberOfChannels;
    const { length, sampleRate } = audioBuffer;
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
