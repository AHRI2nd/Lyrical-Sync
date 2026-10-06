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
  getTile: (index: number, secondsPerBin: number) => WaveformEnvelope | null;
}

const BLOCK = 256;
const CHUNK = 262144;
const CACHE_LIMIT = 16;
export const WAVEFORM_TILE_BINS = 512;

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
  const sampleEnvelope = (start: number, end: number, width: number, key: string,
    boundary: (bin: number) => number): WaveformEnvelope => {
    const cached = cache.get(key);
    if (cached) return cached;
    const min = new Float32Array(width); const max = new Float32Array(width);
    for (let bin = 0; bin < width; bin++) {
      const left = boundary(bin); const right = boundary(bin + 1);
      if (right <= 0 || left >= buffer.length) continue;
      let a = Math.max(0, Math.floor(left));
      const b = Math.min(buffer.length, Math.max(a + 1, Math.ceil(right)));
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
  };
  return {
    getEnvelope(start, end, pixelWidth) {
      if (![start, end, pixelWidth, buffer.duration].every(Number.isFinite) || pixelWidth <= 0 || buffer.length === 0 || channels.length === 0) return null;
      start = Math.max(0, Math.min(buffer.duration, start));
      end = Math.max(start, Math.min(buffer.duration, end));
      if (end <= start) return null;
      const width = Math.max(1, Math.min(4096, Math.round(pixelWidth)));
      const first = start * buffer.sampleRate;
      const span = (end - start) * buffer.sampleRate;
      return sampleEnvelope(start, end, width, `range:${start}:${end}:${width}`, bin => first + span * bin / width);
    },
    getTile(index, secondsPerBin) {
      if (!Number.isSafeInteger(index) || index < 0 || !Number.isFinite(secondsPerBin) || secondsPerBin <= 0
        || !buffer.length || !channels.length) return null;
      // Guard bins overlap adjacent tiles, keeping continuous paths connected at the seam.
      const firstBin = index * WAVEFORM_TILE_BINS - 1;
      const width = WAVEFORM_TILE_BINS + 2;
      const start = firstBin * secondsPerBin;
      const end = (firstBin + width) * secondsPerBin;
      if (!Number.isFinite(end)) return null;
      return sampleEnvelope(start, end, width, `tile:${index}:${secondsPerBin}`,
        bin => (firstBin + bin) * secondsPerBin * buffer.sampleRate);
    },
  };
}

/** Quantize only resolution noise; viewport position remains continuous. */
export function getWaveformTiles(source: WaveformSource, start: number, end: number, pixelWidth: number): WaveformEnvelope[] {
  if (![start, end, pixelWidth].every(Number.isFinite) || end <= start || pixelWidth <= 0) return [];
  const width = Math.max(1, Math.min(4096, Math.round(pixelWidth)));
  const secondsPerBin = Number(((end - start) / width).toPrecision(12));
  const tileSpan = secondsPerBin * WAVEFORM_TILE_BINS;
  const first = Math.max(0, Math.floor(start / tileSpan));
  const last = Math.max(first, Math.floor(end / tileSpan));
  const tiles: WaveformEnvelope[] = [];
  for (let index = first; index <= last; index++) {
    const tile = source.getTile(index, secondsPerBin);
    if (tile) tiles.push(tile);
  }
  return tiles;
}
