import { describe, expect, it } from "vitest";
import { retimeLine } from "./lineTiming";

describe("retimeLine", () => {
  it("retimes a line with a very large syllable list without overflowing the call stack", () => {
    const syllables = Array.from({ length: 200_000 }, (_, index) => ({ text: "x", time: index / 1000 }));
    const retimed = retimeLine({ id: "large", timestamp: 0, text: "x".repeat(syllables.length), syllables }, 1);

    expect(retimed.timestamp).toBe(1);
    expect(retimed.syllables?.[0].time).toBe(1);
    expect(retimed.syllables?.[syllables.length - 1].time).toBeCloseTo(200.999, 6);
  });
});
