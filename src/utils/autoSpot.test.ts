import { describe, it, expect } from "vitest";
import { detectSpeechSegments } from "./autoSpot";

const SR = 1000; // 1kHz — 1 sample = 1ms, 20ms window = 20 samples

// -1..1 사인파 구간(=충분히 큰 RMS)을 만들어 "발화"를 흉내낸다.
function tone(durationSec: number): number[] {
  const n = Math.round(durationSec * SR);
  return Array.from({ length: n }, (_, i) => Math.sin((i / SR) * 2 * Math.PI * 50));
}
function silence(durationSec: number): number[] {
  return new Array(Math.round(durationSec * SR)).fill(0);
}

describe("detectSpeechSegments", () => {
  it("returns nothing for empty or invalid input", () => {
    expect(detectSpeechSegments([], SR)).toEqual([]);
    expect(detectSpeechSegments([0, 1, 0], 0)).toEqual([]);
  });

  it("returns nothing when the whole clip is silent", () => {
    expect(detectSpeechSegments(silence(1), SR)).toEqual([]);
  });

  it("finds a single tone surrounded by silence", () => {
    const samples = [...silence(0.5), ...tone(0.5), ...silence(0.5)];
    const segs = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0);
    expect(segs.length).toBe(1);
    expect(segs[0].start).toBeCloseTo(0.5, 1);
    expect(segs[0].end).toBeCloseTo(1.0, 1);
  });

  it("drops a speech run shorter than minSpeechSec", () => {
    const samples = [...silence(0.5), ...tone(0.1), ...silence(0.5)];
    const segs = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0);
    expect(segs).toEqual([]);
  });

  it("merges two tones separated by a gap shorter than minSilenceSec", () => {
    const samples = [...tone(0.4), ...silence(0.1), ...tone(0.4)];
    const segs = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0);
    expect(segs.length).toBe(1);
  });

  it("keeps two tones separate when the gap exceeds minSilenceSec", () => {
    const samples = [...tone(0.4), ...silence(0.5), ...tone(0.4)];
    const segs = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0);
    expect(segs.length).toBe(2);
  });

  it("pads segment edges without crossing into a neighbor", () => {
    const samples = [...silence(1), ...tone(0.5), ...silence(1)];
    const padded = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0.2);
    const unpadded = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0);
    expect(padded[0].start).toBeCloseTo(unpadded[0].start - 0.2, 1);
    expect(padded[0].end).toBeCloseTo(unpadded[0].end + 0.2, 1);
  });

  it("never lets padding push a segment past the clip bounds", () => {
    const samples = tone(0.5); // 발화가 클립 전체를 채움 — 앞뒤 여유 공간 없음
    const segs = detectSpeechSegments(samples, SR, -35, 0.3, 0.3, 0.5);
    expect(segs[0].start).toBeGreaterThanOrEqual(0);
    expect(segs[0].end).toBeLessThanOrEqual(0.5);
  });
});
