import { describe, expect, it } from "vitest";
import { createWaveformSourceFromSummary, parseAudioWaveformSummary } from "./audioWaveformSummary";

function binarySummary(minima = [-1, -0.25], maxima = [0.75, 0.5]) {
  const header = 40;
  const bytes = new Uint8Array(header + minima.length * 8);
  const view = new DataView(bytes.buffer);
  bytes.set([76, 83, 87, 70], 0);
  view.setUint16(4, 1, false);
  view.setUint16(6, header, false);
  view.setUint32(8, 48_000, false);
  bytes[12] = 2;
  view.setBigUint64(16, BigInt((minima.length - 1) * 256 + 1), false);
  view.setBigUint64(24, BigInt(Math.floor(((minima.length - 1) * 256 + 1) * 1e9 / 48_000)), false);
  view.setUint32(32, 256, false);
  view.setUint32(36, minima.length, false);
  for (let i = 0; i < minima.length; i++) {
    view.setFloat32(header + i * 8, minima[i], false);
    view.setFloat32(header + i * 8 + 4, maxima[i], false);
  }
  return bytes;
}

describe("audio waveform summary parser", () => {
  it("parses a bounded versioned min/max summary", () => {
    const summary = parseAudioWaveformSummary(binarySummary());
    expect(summary.sampleRate).toBe(48_000);
    expect(summary.channels).toBe(2);
    expect(summary.frameCount).toBe(257);
    expect(summary.duration).toBeCloseTo(257 / 48_000);
    expect(summary.minima).toEqual(new Float32Array([-1, -0.25]));
    expect(summary.maxima).toEqual(new Float32Array([0.75, 0.5]));
    expect(summary.peaks).toEqual(new Float32Array([-1, 0.5]));
  });

  it("serves zoomable envelopes from the compact summary", () => {
    const summary = parseAudioWaveformSummary(binarySummary());
    const source = createWaveformSourceFromSummary(summary);
    const envelope = source.getEnvelope(0, 256 / summary.sampleRate, 1);
    const finalBin = source.getEnvelope(256 / summary.sampleRate, summary.duration, 1);
    expect(envelope?.min).toEqual(new Float32Array([-1]));
    expect(envelope?.max).toEqual(new Float32Array([0.75]));
    expect(finalBin?.min).toEqual(new Float32Array([-0.25]));
    expect(finalBin?.max).toEqual(new Float32Array([0.5]));
    expect(source.getTile(0, 0.001)?.min).toHaveLength(514);
  });

  it.each(["truncated", "trailing", "wrong-version", "invalid-range", "nonfinite", "wrong-bin-count"]) (
    "rejects %s summaries",
    (kind) => {
      const bytes = binarySummary();
      const view = new DataView(bytes.buffer);
      if (kind === "truncated") return expect(() => parseAudioWaveformSummary(bytes.subarray(0, bytes.length - 1))).toThrow();
      if (kind === "trailing") {
        const trailing = new Uint8Array(bytes.length + 1);
        trailing.set(bytes);
        return expect(() => parseAudioWaveformSummary(trailing)).toThrow();
      }
      if (kind === "wrong-version") view.setUint16(4, 2, false);
      if (kind === "invalid-range") view.setFloat32(40, -1.1, false);
      if (kind === "nonfinite") view.setFloat32(44, Number.NaN, false);
      if (kind === "wrong-bin-count") view.setUint32(36, 3, false);
      expect(() => parseAudioWaveformSummary(bytes)).toThrow();
    },
  );

  it("rejects nonzero reserved bytes and unsafe dimensions", () => {
    const bytes = binarySummary();
    bytes[13] = 1;
    expect(() => parseAudioWaveformSummary(bytes)).toThrow();
    const oversized = binarySummary();
    new DataView(oversized.buffer).setBigUint64(16, 0xffff_ffff_ffff_ffffn, false);
    expect(() => parseAudioWaveformSummary(oversized)).toThrow();
  });
});
