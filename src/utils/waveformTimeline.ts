import { isStampable } from "./lrcParser";
import type { LrcSyllable } from "../types/lrc";

export function getCenteredView(time: number, span: number, duration: number) {
  const width = duration > 0 ? Math.min(span, duration) : span;
  const start = Math.max(0, Math.min(duration > 0 ? Math.max(0, duration - width) : Infinity, time - width / 2));
  return { start, end: start + width };
}

export function getTimeTicks(start: number, end: number, width: number) {
  if (![start, end, width].every(Number.isFinite) || end <= start || width <= 0) return [];
  const span = end - start;
  if (!Number.isFinite(span)) return [];
  const target = span / Math.max(1, width / 80);
  if (!Number.isFinite(target) || target <= 0) return [];
  const base = 10 ** Math.floor(Math.log10(target));
  const step = ([1, 2, 5, 10].find(x => x * base >= target) ?? 10) * base;
  if (!Number.isFinite(step) || step <= 0) return [];
  // Integer indices outside the safe range may stop advancing with i++.
  const first = Math.ceil(start / step);
  const last = Math.ceil(end / step);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last <= first) return [];

  const ticks: { time: number; percent: number }[] = [];
  const count = last - first;
  // A typical viewport uses tens of ticks. For enormous finite widths, sample
  // evenly across the full view rather than allocating one element per tick.
  const limit = Math.min(512, count);
  for (let n = 0; n < limit; n++) {
    const offset = count <= limit ? n : Math.floor(n * (count - 1) / (limit - 1));
    const index = first + offset;
    if (!Number.isSafeInteger(index)) continue;
    const rawTime = index * step;
    if (!Number.isFinite(rawTime) || rawTime >= end) continue;
    const time = Number(rawTime.toPrecision(12));
    const px = (time - start) / span * width;
    if (Number.isFinite(px) && px >= 32 && px <= width - 32 && ticks[ticks.length - 1]?.time !== time) {
      ticks.push({ time, percent: px / width * 100 });
    }
  }
  return ticks;
}

export function layoutGlyphMarkers(syllables: LrcSyllable[], start: number, end: number, width: number, cell = 32) {
  if (end <= start || width < cell) return [];
  const groups: { indices: number[]; x: number; row: number }[] = [];
  const right = [-Infinity, -Infinity];
  const timed = syllables.map((s, index) => ({ s, index }))
    .filter(({ s }) => s.time !== null && Number.isFinite(s.time) && isStampable(s) && s.time >= start && s.time <= end)
    .sort((a, b) => a.s.time! - b.s.time!);
  for (const { s, index } of timed) {
    const x = Math.max(cell / 2, Math.min(width - cell / 2, (s.time! - start) / (end - start) * width));
    const previous = groups[groups.length - 1];
    if (previous && x - previous.x < 12) { previous.indices.push(index); continue; }
    const row = right.findIndex(value => x - cell / 2 >= value + 6);
    if (row < 0 && previous) { previous.indices.push(index); continue; }
    const level = Math.max(0, row);
    right[level] = x + cell / 2;
    groups.push({ indices: [index], x, row: level });
  }
  return groups;
}
