import type { LrcLine } from '../types/lrc';

/** Move the earliest timed glyph to the new onset, preserving calibrated intervals. */
export function retimeLine(line: LrcLine, timestamp: number | null): LrcLine {
  if (timestamp === null) return { ...line, timestamp, srtEndTime: undefined, syllables: undefined };
  const delta = line.timestamp === null ? 0 : timestamp - line.timestamp;
  let earliest: number | null = null;
  for (const syllable of line.syllables ?? []) {
    if (syllable.time !== null && Number.isFinite(syllable.time) && (earliest === null || syllable.time < earliest)) earliest = syllable.time;
  }
  if (earliest === null) return {
    ...line,
    timestamp,
    srtEndTime: Number.isFinite(line.srtEndTime) ? Math.max(timestamp, (line.srtEndTime as number) + delta) : line.srtEndTime,
  };
  const syllableDelta = timestamp - earliest;
  return { ...line, timestamp, syllables: line.syllables?.map(s => ({
    ...s, time: s.time === null ? null : Math.max(0, s.time + syllableDelta),
  })), srtEndTime: Number.isFinite(line.srtEndTime) ? Math.max(timestamp, (line.srtEndTime as number) + delta) : line.srtEndTime };
}

export function shiftSrtEnd(line: LrcLine, delta: number, nextTimestamp: number | null = line.timestamp): number | undefined {
  if (!Number.isFinite(line.srtEndTime) || !Number.isFinite(delta) || nextTimestamp === null) return line.srtEndTime;
  return Math.max(nextTimestamp, (line.srtEndTime as number) + delta);
}
