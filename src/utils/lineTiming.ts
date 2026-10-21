import type { LrcLine } from '../types/lrc';

/** Move the earliest timed glyph to the new onset, preserving calibrated intervals. */
export function retimeLine(line: LrcLine, timestamp: number | null): LrcLine {
  if (timestamp === null) return { ...line, timestamp, syllables: undefined };
  const times = line.syllables?.flatMap(s => s.time === null ? [] : [s.time]) ?? [];
  if (!times.length) return { ...line, timestamp };
  const delta = timestamp - Math.min(...times);
  return { ...line, timestamp, syllables: line.syllables?.map(s => ({
    ...s, time: s.time === null ? null : Math.max(0, s.time + delta),
  })) };
}
