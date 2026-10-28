import { describe, it, expect } from "vitest";
import { parseLrc, serializeLrc } from "./lrcParser";
import { parseSrt, serializeSrt } from "./srtConverter";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({
  metadata: emptyMeta,
  lines,
  extraTags: {},
});

describe("parseSrt", () => {
  it("parses cue start times and preserves multi-line text", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello\nworld\n";
    const d = parseSrt(srt);
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0].timestamp).toBe(1);
    expect(d.lines[0].text).toBe("Hello\nworld");
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
      [7, ""],
    ]);
  });

  it("does not insert an intermediate blank line when cues are contiguous", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:03,000\nfirst\n\n" +
      "2\n00:00:03,000 --> 00:00:05,000\nsecond\n";
    const d = parseSrt(srt);
    expect(d.lines.map((l) => l.text)).toEqual(["first", "second", ""]);
  });
});

describe("serializeSrt", () => {
  it("rejects a blank paragraph formed where original text meets translation", () => {
    expect(() => serializeSrt(docOf([{ id: "1", timestamp: 1, text: "original\r\n", translation: "translated" }]))).
      toThrow("SRT cannot preserve blank paragraph rows");
  });
  it.each([
    ["original", "first\n\nsecond", undefined],
    ["translation", "text", "translated\r\n \r\ncontinued"],
  ])("rejects a blank paragraph row in %s text", (_field, text, translation) => {
    expect(() => serializeSrt(docOf([{ id: "1", timestamp: 1, text, translation }]))).toThrow("SRT cannot preserve blank paragraph rows");
  });

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

it('preserves the final subtitle end without a supplied audio duration', () => {
  const input = '1\n00:00:10,000 --> 00:00:12,000\nlyric\n';
  expect(serializeSrt(parseSrt(input))).toContain('00:00:10,000 --> 00:00:12,000');
});
it('shifts the final subtitle end along with the imported cue', () => {
  const parsed = parseSrt('1\n00:00:10,000 --> 00:00:12,000\nlyric\n');
  const shifted = { ...parsed, lines: parsed.lines.map(line => ({ ...line, timestamp: line.timestamp === null ? null : line.timestamp + 2 })) };
  expect(serializeSrt(shifted)).toContain('00:00:12,000 --> 00:00:14,000');
});


it("exports translations and reimports the complete multiline body without guessing fields", () => {
  const original = docOf([{ id: "a", timestamp: 1, text: "original\ncontinuation", translation: "translated" }]);
  const out = serializeSrt(original, 3);
  expect(out).toContain("original\ncontinuation\ntranslated");
  const parsed = parseSrt(out);
  expect(parsed.lines[0].text).toBe("original\ncontinuation\ntranslated");
  expect(parsed.lines[0]).not.toHaveProperty("translation");
  expect(serializeSrt(parsed)).toBe(out);
});
it("preserves spaces within multiline SRT body rows", () => {
  expect(parseSrt("1\n00:00:01,000 --> 00:00:03,000\n  first  \n second \n").lines[0].text)
    .toBe("  first  \n second ");
});


it("exports a translation-only timed line as content instead of a boundary", () => {
  const doc = docOf([{ id: "1", timestamp: 1, text: "", translation: "translated" }]);
  const out = serializeSrt(doc, 3);
  expect(out).toContain("00:00:01,000 --> 00:00:03,000\ntranslated");
  expect(parseSrt(out).lines[0].text).toBe("translated");
});


it("preserves multiline SRT bodies through LRC save and reopen without translations", () => {
  const input = "1\n00:00:10,000 --> 00:00:12,000\nfirst\nsecond\n";
  const lrc = serializeLrc(parseSrt(input));
  expect(serializeSrt(parseLrc(lrc))).toBe(input);
});
it("retains the end of a valid sub-centisecond final subtitle", () => {
  const doc = parseSrt("1\n00:00:10,000 --> 00:00:10,004\nshort\n");
  expect(serializeSrt(doc)).toContain("00:00:10,000 --> 00:00:10,004");
});

it.each([100,1000])('round-trips subtitle starts and ends at %s hours', hours => {
 const start=hours*3600+2.125;
 const restored=parseSrt(serializeSrt(docOf([{id:'a',timestamp:start,text:'late'}]),start+4));
 expect(restored.lines.map(l=>l.timestamp)).toEqual([start,start+4]);
});
it.each(['junk00:00:01,000','00:61:01,000','00:00:61,000','00:00:01,0000',`${'9'.repeat(400)}:00:01,000`])('rejects malformed or non-finite SRT start: %s', start => {
 expect(parseSrt(`1\n${start} --> 00:00:05,000\ninvalid`).lines).toEqual([]);
});
it('retains compatibility with whitespace-separated cue position settings', () => {
 expect(parseSrt('1\n00:00:01,250 --> 00:00:03,500 X1:10 X2:20\ntext').lines.map(l=>l.timestamp)).toEqual([1.25,3.5]);
});
