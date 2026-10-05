export interface DecodedAudio {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  getChannelData: (channel: number) => Float32Array;
}
export interface WaveformEnvelope {
  start: number;
  end: number;
  min: Float32Array;
  max: Float32Array;
}
export interface WaveformSource {
  getEnvelope: (start: number, end: number, pixelWidth: number) => WaveformEnvelope | null;
}

const BLOCK = 256;
const CHUNK = 262144;
const CACHE_LIMIT = 8;

/** Keep decoded PCM by reference; build compact summaries while yielding between chunks. */
export async function createWaveformSource(buffer: DecodedAudio, signal?: AbortSignal): Promise<WaveformSource> {
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Waveform preparation aborted', 'AbortError');
  };
  checkAbort();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const blocks = Math.ceil(buffer.length / BLOCK);
  const lows = new Float32Array(blocks);
  const highs = new Float32Array(blocks);
  let amplitude = 0;
  for (let chunk = 0; chunk < buffer.length; chunk += CHUNK) {
    checkAbort();
    const chunkEnd = Math.min(buffer.length, chunk + CHUNK);
    for (let start = chunk; start < chunkEnd; start += BLOCK) {
      const end = Math.min(buffer.length, start + BLOCK);
      let lo = 0; let hi = 0;
      for (const channel of channels) {
        for (let i = start; i < end; i++) {
          const v = channel[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const block = start / BLOCK;
      lows[block] = lo; highs[block] = hi;
      amplitude = Math.max(amplitude, hi, -lo);
    }
    if (chunkEnd < buffer.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  checkAbort();
  const scale = amplitude > 0 ? 1 / amplitude : 1;
  const cache = new Map<string, WaveformEnvelope>();
  return {
    getEnvelope(start, end, pixelWidth) {
      if (![start, end, pixelWidth, buffer.duration].every(Number.isFinite) || pixelWidth <= 0 || buffer.length === 0 || channels.length === 0) return null;
      start = Math.max(0, Math.min(buffer.duration, start));
      end = Math.max(start, Math.min(buffer.duration, end));
      if (end <= start) return null;
      const width = Math.max(1, Math.min(4096, Math.round(pixelWidth)));
      const key = `${start}:${end}:${width}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const min = new Float32Array(width); const max = new Float32Array(width);
      const first = start * buffer.sampleRate;
      const span = (end - start) * buffer.sampleRate;
      for (let bin = 0; bin < width; bin++) {
        let a = Math.min(buffer.length - 1, Math.floor(first + span * bin / width));
        const b = Math.min(buffer.length, Math.max(a + 1, Math.ceil(first + span * (bin + 1) / width)));
        let lo = 0; let hi = 0;
        while (a < b) {
          if (a % BLOCK === 0 && a + BLOCK <= b) {
            const index = a / BLOCK;
            lo = Math.min(lo, lows[index]); hi = Math.max(hi, highs[index]); a += BLOCK;
          } else {
            for (const channel of channels) {
              const v = channel[a];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
            a++;
          }
        }
        min[bin] = lo * scale; max[bin] = hi * scale;
      }
      const envelope = { start, end, min, max };
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(key, envelope);
      return envelope;
    },
  };
}
