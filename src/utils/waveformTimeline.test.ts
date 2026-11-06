import { describe, expect, it } from "vitest";
import type { LrcSyllable } from "../types/lrc";
import { getTimeTicks, layoutGlyphMarkers, getCenteredView } from "./waveformTimeline";

describe("waveform timeline", () => {
  it("centers playback and lets the playhead traverse the whole track at its boundaries", () => {
    expect(getCenteredView(0, 6, 100)).toEqual({ start: 0, end: 6 });
    expect(getCenteredView(50, 6, 100)).toEqual({ start: 47, end: 53 });
    expect(getCenteredView(99, 6, 100)).toEqual({ start: 94, end: 100 });
    expect(getCenteredView(.25, 2, .5)).toEqual({ start: 0, end: .5 });
  });
  it("anchors readable ticks to absolute time during fractional scrolling", () => {
    expect(getTimeTicks(11.2, 14.2, 600).map(t => t.time)).toEqual([11.5, 12, 12.5, 13, 13.5, 14]);
    expect(getTimeTicks(11.21, 14.21, 600).map(t => t.time)).toEqual([11.5, 12, 12.5, 13, 13.5, 14]);
    expect(getTimeTicks(11.2, 14.2, 280).map(t => t.time)).toEqual([12, 13]);
    expect(getTimeTicks(0, 0, 600)).toEqual([]);
  });
  it("bounds tick generation for a finite but pathologically wide viewport", () => {
    const ticks = getTimeTicks(0, 10, 1_000_000);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(512);
    expect(ticks.every(({ time, percent }) => Number.isFinite(time) && Number.isFinite(percent) && percent >= 0 && percent <= 100)).toBe(true);
    expect(ticks[ticks.length - 1]?.percent).toBeGreaterThan(95); // bounded ticks still cover the view
    expect(ticks.every((tick, index) => index === 0 || tick.time > ticks[index - 1].time)).toBe(true);
  });
  it("returns promptly for finite tick indices beyond exact integer precision", () => {
    expect(getTimeTicks(1e16, 1e16 + 2, 4096)).toEqual([]);
    expect(getTimeTicks(-1e16, -1e16 + 2, 4096)).toEqual([]);
  });
  it("packs markers into two reserved rows and groups dense times without losing glyphs", () => {
    const syllables: LrcSyllable[] = Array.from({ length: 10 }, (_, i) => ({ text: String(i), time: 1 + i * .015 }));
    syllables.push({ text: "untimed", time: null });
    const markers = layoutGlyphMarkers(syllables, 0, 3, 280);
    expect(markers.flatMap(m => m.indices)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(markers.every(m => m.row < 2)).toBe(true);
    expect(markers.some(m => m.indices.length > 1)).toBe(true);
    expect(markers.every(m => m.x >= 16 && m.x <= 264)).toBe(true);
  });
});
