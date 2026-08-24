import { describe, it, expect } from "vitest";
import { detectBpm, nearestBeat } from "./bpmDetect";

// 지정 BPM으로 짧은 사인파 "클릭"을 주기적으로 배치한 합성 트랙 생성(그 외 구간은 무음).
function makeClickTrack(bpm: number, sampleRate: number, durationSec: number, firstBeatSec = 0): Float32Array {
  const n = Math.floor(durationSec * sampleRate);
  const samples = new Float32Array(n);
  const period = 60 / bpm;
  const clickLenSamples = Math.round(0.01 * sampleRate); // 10ms 클릭
  for (let beatT = firstBeatSec; beatT < durationSec; beatT += period) {
    const start = Math.round(beatT * sampleRate);
    for (let i = 0; i < clickLenSamples && start + i < n; i++) {
      // 감쇠하는 1kHz 톤 — 타격음 근사
      samples[start + i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * (1 - i / clickLenSamples);
    }
  }
  return samples;
}

describe("detectBpm", () => {
  it("returns null for empty/silent input", () => {
    expect(detectBpm(new Float32Array(0), 8000)).toBeNull();
    expect(detectBpm(new Float32Array(1000), 8000)).toBeNull();
  });

  it("returns null for an invalid sample rate", () => {
    expect(detectBpm(new Float32Array(1000), 0)).toBeNull();
  });

  it("recovers the BPM of a clean synthetic click track (120 BPM)", () => {
    const sampleRate = 8000;
    const track = makeClickTrack(120, sampleRate, 8);
    const result = detectBpm(track, sampleRate);
    expect(result).not.toBeNull();
    expect(result!.bpm).toBeGreaterThan(118);
    expect(result!.bpm).toBeLessThan(122);
  });

  it("recovers the BPM and phase of an offset click track (90 BPM, first beat at 0.3s)", () => {
    const sampleRate = 8000;
    const track = makeClickTrack(90, sampleRate, 10, 0.3);
    const result = detectBpm(track, sampleRate);
    expect(result).not.toBeNull();
    expect(result!.bpm).toBeGreaterThan(88);
    expect(result!.bpm).toBeLessThan(92);
    // 위상은 주기 이내로만 보장(0.3s 자체가 아니라 0.3s mod period와 근접해야 함)
    const period = 60 / result!.bpm;
    const phaseDiff = Math.min(
      Math.abs(result!.offsetSec - 0.3) % period,
      period - (Math.abs(result!.offsetSec - 0.3) % period)
    );
    expect(phaseDiff).toBeLessThan(0.05);
  });
});

describe("nearestBeat", () => {
  it("snaps to the nearest beat on a simple grid", () => {
    // 120 BPM = 0.5s 주기, offset 0
    expect(nearestBeat(0.24, 120, 0)).toBeCloseTo(0, 3);
    expect(nearestBeat(0.26, 120, 0)).toBeCloseTo(0.5, 3);
    expect(nearestBeat(1.76, 120, 0)).toBeCloseTo(2.0, 3);
  });

  it("respects a non-zero offset", () => {
    expect(nearestBeat(0.35, 120, 0.1)).toBeCloseTo(0.1, 3);
    expect(nearestBeat(0.55, 120, 0.1)).toBeCloseTo(0.6, 3);
  });

  it("never returns a negative timestamp", () => {
    expect(nearestBeat(0, 120, 5)).toBeGreaterThanOrEqual(0);
  });
});
