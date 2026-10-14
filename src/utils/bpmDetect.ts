// A local onset-based estimate. Full mixes can produce half/double tempo;
// users can verify the estimate with Tap Tempo before applying it.

export interface BpmResult {
  bpm: number;
  /** Absolute time of the first grid beat, in seconds. */
  offsetSec: number;
  /** Relative autocorrelation peak prominence, from 0 to 1. */
  confidence: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;
const HOP_SEC = 0.02;
const MAX_FRAMES = 6000;
const MAX_FRAME_SAMPLES = 256;

/**
 * Estimate tempo and phase from a mono onset envelope. Analysis uses at most
 * the first two minutes and 256 energy samples per frame to bound synchronous
 * work independently of input duration and sample rate.
 */
export function detectBpm(samples: Float32Array | number[], sampleRate: number): BpmResult | null {
  if (!Number.isFinite(sampleRate) || !(sampleRate > 0) || samples.length === 0) return null;

  const hopSize = Math.max(1, Math.round(HOP_SEC * sampleRate));
  const frameSec = hopSize / sampleRate;
  const frameCount = Math.min(MAX_FRAMES, Math.floor(samples.length / hopSize));
  if (frameCount < 8) return null;

  // Frame RMS energy, with bounded sampling for large frame sizes.
  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const lo = f * hopSize;
    const stride = Math.max(1, Math.ceil(hopSize / MAX_FRAME_SAMPLES));
    let sumSquares = 0;
    let count = 0;
    for (let i = lo; i < lo + hopSize; i += stride) {
      const value = samples[i];
      if (!Number.isFinite(value)) return null;
      sumSquares += value * value;
      count++;
    }
    energy[f] = Math.sqrt(sumSquares / count);
    if (!Number.isFinite(energy[f])) return null;
  }

  // Positive energy changes emphasize attacks.
  const onset = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  }

  const lagMinFrames = Math.max(1, Math.round(60 / MAX_BPM / frameSec));
  const lagMaxFrames = Math.min(frameCount - 1, Math.round(60 / MIN_BPM / frameSec));
  if (lagMaxFrames <= lagMinFrames) return null;

  // Autocorrelation scores for each candidate beat period.
  let bestLag = lagMinFrames;
  let bestScore = -Infinity;
  const scores = new Float32Array(lagMaxFrames - lagMinFrames + 1);
  for (let lag = lagMinFrames; lag <= lagMaxFrames; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < frameCount; i++) {
      sum += onset[i] * onset[i + lag];
      count++;
    }
    const score = count > 0 ? sum / count : 0;
    scores[lag - lagMinFrames] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestScore <= 0 || !Number.isFinite(bestScore)) return null;

  const bpm = 60 / (bestLag * frameSec);

  let meanScore = 0;
  for (let i = 0; i < scores.length; i++) meanScore += scores[i];
  meanScore /= scores.length || 1;
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - meanScore) / bestScore)) : 0;

  // Find the phase with the strongest summed onsets.
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let phase = 0; phase < bestLag; phase++) {
    let sum = 0;
    for (let i = phase; i < frameCount; i += bestLag) sum += onset[i];
    if (sum > bestPhaseScore) {
      bestPhaseScore = sum;
      bestPhase = phase;
    }
  }
  const offsetSec = bestPhase * frameSec;

  return {
    bpm: Math.round(bpm * 100) / 100,
    offsetSec: Math.round(offsetSec * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

/** Snap seconds to the closest grid beat, clamping negative results to zero. */
export function nearestBeat(t: number, bpm: number, offsetSec: number): number {
  const period = 60 / bpm;
  if (!Number.isFinite(t) || !Number.isFinite(bpm) || !Number.isFinite(offsetSec) || !Number.isFinite(period) || !(period > 0)) return t;
  const n = Math.round((t - offsetSec) / period);
  const snapped = Math.round((offsetSec + n * period) * 1000) / 1000;
  return Number.isFinite(snapped) ? Math.max(0, snapped) : t;
}
