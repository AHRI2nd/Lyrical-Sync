import { describe, it, expect } from "vitest";
import { parseSrt, serializeSrt } from "./srtConverter";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({
  metadata: emptyMeta,
  lines,
  extraTags: {},
});

describe("parseSrt", () => {
  it("parses cue start times and joins multi-line text", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello\nworld\n";
    const d = parseSrt(srt);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].timestamp).toBe(1);
    expect(d.lines[0].text).toBe("Hello world");
  });

  it("accepts both comma and dot fractional separators", () => {
    expect(parseSrt("1\n00:00:02.500 --> 00:00:03,000\nx\n").lines[0].timestamp).toBeCloseTo(2.5, 5);
  });

  it("inserts a blank boundary line for a gap between cues", () => {
    // cue1 ends at 3s, cue2 starts at 5s → gap → blank line at 3s
    const srt =
      "1\n00:00:01,000 --> 00:00:03,000\nfirst\n\n" +
      "2\n00:00:05,000 --> 00:00:07,000\nsecond\n";
    const d = parseSrt(srt);
    expect(d.lines.map((l) => [l.timestamp, l.text])).toEqual([
      [1, "first"],
      [3, ""],
      [5, "second"],
    ]);
  });

  it("does not insert a blank line when cues are contiguous", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:03,000\nfirst\n\n" +
      "2\n00:00:03,000 --> 00:00:05,000\nsecond\n";
    const d = parseSrt(srt);
    expect(d.lines.map((l) => l.text)).toEqual(["first", "second"]);
  });
});

describe("serializeSrt", () => {
  it("uses the next line's time as each cue's end", () => {
    const out = serializeSrt(
      docOf([
        { id: "1", timestamp: 1, text: "first" },
        { id: "2", timestamp: 3, text: "second" },
      ]),
      10
    );
    expect(out).toContain("00:00:01,000 --> 00:00:03,000");
    expect(out).toContain("00:00:03,000 --> 00:00:10,000"); // last uses lastCueEnd
  });

  it("blank lines act as a boundary, not a cue", () => {
    const out = serializeSrt(
      docOf([
        { id: "1", timestamp: 1, text: "first" },
        { id: "2", timestamp: 3, text: "" },
        { id: "3", timestamp: 5, text: "second" },
      ])
    );
    // first ends at the blank boundary (3s), blank itself is not emitted
    expect(out).toContain("00:00:01,000 --> 00:00:03,000\nfirst");
    expect(out).not.toContain("\n\n\n");
    expect(out.match(/-->/g)?.length).toBe(2);
  });

  it("round-trips SRT → LRC → SRT preserving the gap boundary", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:03,000\nfirst\n\n" +
      "2\n00:00:05,000 --> 00:00:07,000\nsecond\n";
    const back = serializeSrt(parseSrt(srt), 7);
    expect(back).toContain("00:00:01,000 --> 00:00:03,000");
    expect(back).toContain("00:00:05,000 --> 00:00:07,000");
  });
});


describe("SRT cue boundaries", () => {
  it("uses the next strictly later boundary for coincident starts", () => {
    const out = serializeSrt(docOf([
      { id: "a", timestamp: 1, text: "a" }, { id: "blank", timestamp: 1, text: "" },
      { id: "b", timestamp: 1, text: "b" }, { id: "end", timestamp: 3, text: "" },
      { id: "c", timestamp: 5, text: "c" },
    ]), 10);
    expect(out).toContain("00:00:01,000 --> 00:00:03,000\na");
    expect(out).toContain("00:00:01,000 --> 00:00:03,000\nb");
    expect(out).toContain("00:00:05,000 --> 00:00:10,000\nc");
    expect(out.match(/-->/g)).toHaveLength(3);
  });
  it.each([undefined, 0, 5, 4, NaN, Infinity])("falls back for absent or unusable duration %s", (end) => {
    expect(serializeSrt(docOf([{ id: "last", timestamp: 5, text: "last" }]), end))
      .toContain("00:00:05,000 --> 00:00:09,000");
  });
  it("uses duration for every coincident final cue", () => {
    const out = serializeSrt(docOf([{ id: "a", timestamp: 5, text: "a" }, { id: "b", timestamp: 5, text: "b" }]), 8);
    expect(out.match(/00:00:05,000 --> 00:00:08,000/g)).toHaveLength(2);
  });
});

it("preserves distinct millisecond cue boundaries in SRT", () => {
  expect(serializeSrt(docOf([{ id: "a", timestamp: 1.001, text: "a" }, { id: "b", timestamp: 1.004, text: "b" }])))
    .toContain("00:00:01,001 --> 00:00:01,004");
});
