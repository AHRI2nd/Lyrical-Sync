export const VIRTUAL_LINE_THRESHOLD = 500;
export const DEFAULT_LINE_HEIGHT = 40;
export const LINE_GAP = 4;
export const VIRTUAL_LINE_OVERSCAN = 720;

export interface VirtualLineRange {
  start: number;
  end: number;
}

export function buildLineOffsets(
  count: number,
  heightAt: (index: number) => number | undefined,
  defaultHeight = DEFAULT_LINE_HEIGHT,
  gap = LINE_GAP,
): number[] {
  const offsets = new Array<number>(count + 1);
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    offsets[index] = offset;
    const measured = heightAt(index);
    const height = measured !== undefined && Number.isFinite(measured) && measured > 0
      ? measured
      : defaultHeight;
    offset += height + gap;
  }
  offsets[count] = offset;
  return offsets;
}

function indexAtOffset(offsets: readonly number[], offset: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, count - 1);
}

export function getVirtualLineRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = VIRTUAL_LINE_OVERSCAN,
): VirtualLineRange {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const safeScrollTop = Math.max(0, Math.min(scrollTop, offsets[count]));
  const start = indexAtOffset(offsets, Math.max(0, safeScrollTop - overscan));
  const endOffset = safeScrollTop + Math.max(0, viewportHeight) + overscan;
  const end = Math.min(count, indexAtOffset(offsets, endOffset) + 1);
  return { start, end: Math.max(start + 1, end) };
}

export function includePinnedLineIndices(
  range: VirtualLineRange,
  count: number,
  pinnedIndices: readonly (number | null | undefined)[],
): number[] {
  const indices = new Set<number>();
  for (let index = range.start; index < range.end; index += 1) indices.add(index);
  for (const index of pinnedIndices) {
    if (index !== null && index !== undefined && Number.isInteger(index) && index >= 0 && index < count) {
      indices.add(index);
    }
  }
  return [...indices].sort((left, right) => left - right);
}
