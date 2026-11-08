import { describe, expect, it } from "vitest";
import { retimeLine } from "./lineTiming";

describe("retimeLine", () => {
  it("preserves a delayed first glyph when restamping an enhanced line", () => {
    const retimed = retimeLine({
      id: "delayed",
      timestamp: 1,
      text: "ab",
      syllables: [{ text: "a", time: 1.2 }, { text: "b", time: 1.5 }],
    }, 2);

    expect(retimed.timestamp).toBe(2);
    expect(retimed.syllables?.map(({ time }) => time)).toEqual([2.2, 2.5]);
  });

  it("retimes a line with a very large syllable list without overflowing the call stack", () => {
    const syllables = Array.from({ length: 200_000 }, (_, index) => ({ text: "x", time: index / 1000 }));
    const retimed = retimeLine({ id: "large", timestamp: 0, text: "x".repeat(syllables.length), syllables }, 1);

    expect(retimed.timestamp).toBe(1);
    expect(retimed.syllables?.[0].time).toBe(1);
    expect(retimed.syllables?.[syllables.length - 1].time).toBeCloseTo(200.999, 6);
  });
});
