import { describe, expect, it } from "vitest";
import { buildLineOffsets, getVirtualLineRange, includePinnedLineIndices } from "./virtualLineWindow";

describe("virtual line window", () => {
  it("uses measured variable row heights when finding the visible range", () => {
    const offsets = buildLineOffsets(5, (index) => [20, 80, 30, 90, 40][index], 40, 4);

    expect(offsets).toEqual([0, 24, 108, 142, 236, 280]);
    expect(getVirtualLineRange(offsets, 110, 40, 0)).toEqual({ start: 2, end: 4 });
  });

  it("keeps an offscreen focused or dragged row mounted without expanding the whole gap", () => {
    const offsets = buildLineOffsets(10_000, () => undefined);
    const range = getVirtualLineRange(offsets, 20_000, 600, 200);

    expect(range.start).toBeGreaterThan(400);
    expect(range.end).toBeLessThan(700);
    expect(includePinnedLineIndices(range, 10_000, [3, 9_999, range.start])).toEqual(
      [3, ...Array.from({ length: range.end - range.start }, (_, offset) => range.start + offset), 9_999],
    );
  });
});
