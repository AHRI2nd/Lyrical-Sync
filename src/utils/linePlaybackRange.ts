import type { LrcLine } from '../types/lrc';

/** Ignore equal or earlier timestamps: an empty interval cannot be repeated. */
export function getLinePlaybackRange(lines: LrcLine[], id: string | null, duration: number): { start: number; end: number } | null {
  if (!id || !Number.isFinite(duration) || duration <= 0) return null;
  const index = lines.findIndex(line => line.id === id);
  const start = lines[index]?.timestamp;
  if (start == null || !Number.isFinite(start) || start < 0 || start >= duration) return null;
  let end = duration;
  for (let i = index + 1; i < lines.length; i++) {
    const time = lines[i].timestamp;
    if (time !== null && Number.isFinite(time) && time > start) { end = Math.min(time, duration); break; }
  }
  return { start, end };
}
