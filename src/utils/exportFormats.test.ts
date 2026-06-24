import { describe, it, expect } from "vitest";
import { serializeVtt, serializeAss } from "./exportFormats";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "Song", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({ metadata: emptyMeta, lines, extraTags: {} });

describe("serializeVtt", () => {
  it("emits a WEBVTT header and cues with .mmm times", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "first" },
      { id: "2", timestamp: 3, text: "second" },
    ]), 10);
    expect(out.startsWith("WEBVTT")).toBe(true);
    expect(out).toContain("00:00:01.000 --> 00:00:03.000\nfirst");
    expect(out).toContain("00:00:03.000 --> 00:00:10.000\nsecond"); // last uses lastCueEnd
  });

  it("emits inline timestamps for glyph-synced lines", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] },
    ]), 3);
    expect(out).toContain("<00:00:01.000>a<00:00:01.500>b");
  });

  it("skips blank boundary lines as cues", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "first" },
      { id: "2", timestamp: 3, text: "" },
      { id: "3", timestamp: 5, text: "second" },
    ]));
    expect(out.match(/-->/g)?.length).toBe(2);
    expect(out).toContain("00:00:01.000 --> 00:00:03.000\nfirst"); // ends at blank boundary
  });
});

describe("serializeAss", () => {
  it("includes header sections and a Dialogue per cue", () => {
    const out = serializeAss(docOf([
      { id: "1", timestamp: 1, text: "first" },
      { id: "2", timestamp: 3, text: "second" },
    ]), 10);
    expect(out).toContain("[Script Info]");
    expect(out).toContain("[V4+ Styles]");
    expect(out).toContain("[Events]");
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,first");
  });

  it("converts glyph timings into \\k karaoke durations (centiseconds)", () => {
    const out = serializeAss(docOf([
      { id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] },
    ]), 2);
    // a: 1.0→1.5 = 50cs, b: 1.5→cueEnd(2.0) = 50cs
    expect(out).toContain("{\\k50}a{\\k50}b");
  });
});
