import type { WaveformEnvelope, WaveformSource } from "./waveformEnvelope";

export const AUDIO_WAVEFORM_BLOCK_FRAMES = 256;
export const MAX_AUDIO_WAVEFORM_BINS = 1_048_576;
const HEADER_BYTES = 40;
const MAX_AUDIO_PCM_BYTES = 1024 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 4 * 60 * 60;

export interface AudioWaveformSummary {
  sampleRate: number;
  channels: number;
  frameCount: number;
  durationNanos: number;
  duration: number;
  blockFrames: number;
  minima: Float32Array;
  maxima: Float32Array;
  peaks: Float32Array;
}

export function parseAudioWaveformSummary(input: ArrayBuffer | Uint8Array): AudioWaveformSummary {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < HEADER_BYTES) throw new Error("Invalid waveform summary header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x4c535746 || view.getUint16(4, false) !== 1 || view.getUint16(6, false) !== HEADER_BYTES) {
    throw new Error("Unsupported waveform summary version");
  }
  const sampleRate = view.getUint32(8, false);
  const channels = view.getUint8(12);
  if (view.getUint8(13) !== 0 || view.getUint8(14) !== 0 || view.getUint8(15) !== 0) {
    throw new Error("Invalid waveform summary flags");
  }
  const frameCountBig = view.getBigUint64(16, false);
  const durationNanosBig = view.getBigUint64(24, false);
  if (frameCountBig > BigInt(Number.MAX_SAFE_INTEGER) || durationNanosBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Unsafe waveform summary dimensions");
  }
  const frameCount = Number(frameCountBig);
  const durationNanos = Number(durationNanosBig);
  const blockFrames = view.getUint32(32, false);
  const binCount = view.getUint32(36, false);
  if (sampleRate < 8_000 || sampleRate > 192_000 || channels < 1 || channels > 8 || frameCount === 0
    || durationNanos === 0 || blockFrames !== AUDIO_WAVEFORM_BLOCK_FRAMES || binCount === 0
    || binCount > MAX_AUDIO_WAVEFORM_BINS) {
    throw new Error("Invalid waveform summary dimensions");
  }
  const expectedBins = Math.ceil(frameCount / blockFrames);
  const payloadBytes = binCount * 8;
  if (!Number.isSafeInteger(payloadBytes) || HEADER_BYTES + payloadBytes !== bytes.byteLength || binCount !== expectedBins) {
    throw new Error("Invalid waveform summary length");
  }
  const pcmFramesAtWebRate = Math.ceil(frameCount * Math.max(sampleRate, 48_000) / sampleRate);
  if (!Number.isSafeInteger(pcmFramesAtWebRate)
    || pcmFramesAtWebRate * channels * 4 > MAX_AUDIO_PCM_BYTES
    || frameCount / sampleRate > MAX_AUDIO_DURATION_SECONDS) {
    throw new Error("Audio waveform summary exceeds resource limits");
  }
  const expectedDurationNanos = frameCountBig * 1_000_000_000n / BigInt(sampleRate);
  if (durationNanosBig !== expectedDurationNanos) throw new Error("Invalid waveform summary duration");

  const minima = new Float32Array(binCount);
  const maxima = new Float32Array(binCount);
  const peaks = new Float32Array(binCount);
  for (let index = 0; index < binCount; index++) {
    const minimum = view.getFloat32(HEADER_BYTES + index * 8, false);
    const maximum = view.getFloat32(HEADER_BYTES + index * 8 + 4, false);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)
      || minimum < -1 || maximum > 1 || minimum > maximum) {
      throw new Error("Invalid waveform summary value");
    }
    minima[index] = minimum;
    maxima[index] = maximum;
    peaks[index] = Math.abs(minimum) > Math.abs(maximum) ? minimum : maximum;
  }
  return {
    sampleRate,
    channels,
    frameCount,
    durationNanos,
    duration: frameCount / sampleRate,
    blockFrames,
    minima,
    maxima,
    peaks,
  };
}

export function createWaveformSourceFromSummary(summary: AudioWaveformSummary): WaveformSource {
  const sample = (start: number, end: number, width: number): WaveformEnvelope | null => {
    if (![start, end, width, summary.duration].every(Number.isFinite) || width <= 0 || end <= start) return null;
    start = Math.max(0, Math.min(summary.duration, start));
    end = Math.max(start, Math.min(summary.duration, end));
    if (end <= start) return null;
    width = Math.max(1, Math.min(4096, Math.round(width)));
    const min = new Float32Array(width);
    const max = new Float32Array(width);
    const firstFrame = start * summary.sampleRate;
    const frameSpan = (end - start) * summary.sampleRate;
    for (let pixel = 0; pixel < width; pixel++) {
      const left = firstFrame + frameSpan * pixel / width;
      const right = firstFrame + frameSpan * (pixel + 1) / width;
      if (right <= 0 || left >= summary.frameCount) continue;
      const firstBin = Math.max(0, Math.floor(left / summary.blockFrames));
      const lastBin = Math.min(summary.minima.length - 1, Math.ceil(right / summary.blockFrames) - 1);
      let low = 0;
      let high = 0;
      for (let bin = firstBin; bin <= lastBin; bin++) {
        low = Math.min(low, summary.minima[bin]);
        high = Math.max(high, summary.maxima[bin]);
      }
      min[pixel] = low;
      max[pixel] = high;
    }
    return { start, end, min, max };
  };
  return {
    getEnvelope: sample,
    getTile(index, secondsPerBin) {
      if (!Number.isSafeInteger(index) || index < 0 || !Number.isFinite(secondsPerBin) || secondsPerBin <= 0) return null;
      const firstBin = index * 512 - 1;
      const width = 514;
      const start = firstBin * secondsPerBin;
      const end = (firstBin + width) * secondsPerBin;
      if (!Number.isFinite(end)) return null;
      return sample(start, end, width);
    },
  };
}
