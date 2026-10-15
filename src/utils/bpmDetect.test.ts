import { describe, expect, it } from "vitest";
import { detectBpm, nearestBeat } from "./bpmDetect";

function pulseTrack(period: number, offset: number, duration = 12) {
  const samples = new Float32Array(duration * 1000);
  for (let start = offset * 1000; start < samples.length; start += period * 1000) {
    samples.fill(1, start, start + 20);
  }
  return samples;
}

describe("local BPM detection", () => {
  it("finds a 120 BPM pulse with a 100ms phase", () => {
    const result = detectBpm(pulseTrack(0.5, 0.1), 1000);
    expect(result).toMatchObject({ bpm: 120, offsetSec: 0.1 });
    expect(result?.confidence).toBeGreaterThan(0);
    expect(result?.confidence).toBeLessThanOrEqual(1);
  });

  it("finds a 150 BPM pulse with a 200ms phase", () => {
    expect(detectBpm(pulseTrack(0.4, 0.2), 1000)?.bpm).toBe(150);
    expect(detectBpm(pulseTrack(0.4, 0.2), 1000)?.offsetSec).toBe(0.2);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid sample rate %s", (rate) => {
    expect(detectBpm(pulseTrack(0.5, 0.1), rate)).toBeNull();
  });

  it("returns no guess for silence, short input or invalid samples", () => {
    expect(detectBpm(new Float32Array(12000), 1000)).toBeNull();
    expect(detectBpm(new Float32Array(10), 1000)).toBeNull();
    const invalid = pulseTrack(0.5, 0.1);
    invalid[100] = NaN;
    expect(detectBpm(invalid, 1000)).toBeNull();
  });

  it("bounds long input analysis without reading its distant tail", () => {
    const samples = Array.from(pulseTrack(0.5, 0.1, 120));
    samples.length = 3600000;
    Object.defineProperty(samples, 120001, { get: () => { throw new Error("unbounded read"); } });
    expect(detectBpm(samples, 1000)?.bpm).toBe(120);
  });
});

describe("nearest beat", () => {
  it.each([
    [1.34, 120, 0.1, 1.1],
    [1.38, 120, 0.1, 1.6],
    [0.01, 120, -0.1, 0],
    [1, 90, 0, 1.333],
  ])("snaps %s seconds on a %s BPM grid", (time, bpm, offset, expected) => {
    expect(nearestBeat(time, bpm, offset)).toBe(expected);
  });

  it.each([
    [0, 0], [-1, 0], [NaN, 0], [Infinity, 0], [120, NaN], [120, Infinity], [Number.MIN_VALUE, 0],
  ])("leaves time intact for an invalid grid (%s, %s)", (bpm, offset) => {
    expect(nearestBeat(1.34, bpm, offset)).toBe(1.34);
  });
});
