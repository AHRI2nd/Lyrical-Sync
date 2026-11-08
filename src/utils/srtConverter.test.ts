import { describe, it, expect } from "vitest";
import { parseLrc, serializeLrc } from "./lrcParser";
import { hasUnrepresentableSrtCueEndsInLrc, parseSrt, serializeSrt, SrtMalformedCueError, SRT_MALFORMED_CUE_CODE } from "./srtConverter";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({
  metadata: emptyMeta,
  lines,
  extraTags: {},
});

describe("parseSrt", () => {
  it("detects overlapping SRT cue ends that LRC cannot preserve", () => {
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:10,000\nfirst\n\n2\n00:00:03,000 --> 00:00:05,000\nsecond\n");
    expect(hasUnrepresentableSrtCueEndsInLrc(doc)).toBe(true);
  });

  it("matches each cue end to the next start regardless of source order", () => {
    expect(hasUnrepresentableSrtCueEndsInLrc(docOf([
      { id: "later", timestamp: 3, text: "later" },
      { id: "middle", timestamp: 2, srtEndTime: 3, text: "middle" },
      { id: "earlier", timestamp: 1, srtEndTime: 2, text: "earlier" },
    ]))).toBe(false);
  });

  it.each([
    ["start", "00:00:XX,000 --> 00:00:05,000"],
    ["end", "00:00:04,000 --> 00:00:XX,000"],
  ])("rejects a malformed %s cue instead of silently saving the remaining document", (_field, timing) => {
    const input = "1\n00:00:01,000 --> 00:00:02,000\nkeep\n\n" +
      `2\n${timing}\nMUST NOT LOSE THIS TEXT\n`;
    expect(() => parseSrt(input)).toThrow(SrtMalformedCueError);
    try {
      parseSrt(input);
    } catch (error) {
      expect((error as SrtMalformedCueError).code).toBe(SRT_MALFORMED_CUE_CODE);
    }
  });

  it("rejects a malformed unnumbered cue rather than importing only its valid neighbor", () => {
    const input = "00:00:01,000 --> 00:00:02,000\nkeep\n\n" +
      "00:00:XX,000 --> 00:00:04,000\nmissing\n";
    expect(() => parseSrt(input)).toThrow(SrtMalformedCueError);
  });

  it("ignores unrelated preamble text containing arrows and keeps valid cue settings", () => {
    const input = "Arbitrary header --> not a time\nSome notes\n\n" +
      "index description --> unrelated\n\n" +
      "42\nUnrelated numbered note --> still not a timestamp\n\n" +
      "Example: 00:00:01,000 --> not a standalone timing row\n\n" +
      "1\n00:00:01,250 --> 00:00:03,500 X1:10 X2:20 Y1:25 Y2:50\nsubtitle\n";
    const parsed = parseSrt(input);
    expect(parsed.lines.map((line) => [line.timestamp, line.text])).toEqual([
      [1.25, "subtitle"], [3.5, ""],
    ]);
  });

  it("preserves cue coordinates through text edits, JSON recovery, and SRT autosave", () => {
    const input = "1\n00:00:01,250 --> 00:00:03,500 X1:10 X2:20 Y1:25 Y2:50\nsubtitle\n";
    const parsed = parseSrt(input);
    expect(parsed.lines[0].srtCueSettings).toBe("X1:10 X2:20 Y1:25 Y2:50");
    expect(serializeSrt(parsed)).toBe(input);

    const recovered: LrcDocument = JSON.parse(JSON.stringify(parsed));
    const edited = {
      ...recovered,
      lines: recovered.lines.map((line) => line.text ? { ...line, text: "edited subtitle" } : line),
    };
    expect(serializeSrt(edited)).toBe(input.replace("subtitle", "edited subtitle"));
  });

  it("retains independent position settings when SRT cues overlap", () => {
    const input = "1\n00:00:01,000 --> 00:00:04,000 Y2:210 X1:040\nfirst\n\n" +
      "2\n00:00:02,000 --> 00:00:05,000 X2:310 Y1:100\nsecond\n";
    expect(serializeSrt(parseSrt(input))).toBe(input);
  });

  it("keeps bounded unknown single-line settings to avoid dropping accepted SRT extensions", () => {
    for (const settings of ["position:50%", "X1:10 Y3:20", "X1:10;X2:20", "X1:10\tY1:20"]) {
      const input = `1\n00:00:01,000 --> 00:00:03,000 ${settings}\ntext\n`;
      expect(serializeSrt(parseSrt(input))).toBe(input);
    }
  });

  it("rejects malformed or unsafe timing-line suffixes", () => {
    for (const settings of ["X1:10 --> bad", "X1:10\u0001BAD", "X1:10\u2028", "X1:10" + "x".repeat(256)]) {
      expect(() => parseSrt(`1\n00:00:01,000 --> 00:00:03,000 ${settings}\ntext\n`)).toThrow(SrtMalformedCueError);
    }
  });

  it("returns an empty document for empty or unrelated non-cue input", () => {
    for (const input of ["", "  \n", "free text\nwithout any cues", "other --> explanatory text"]) {
      expect(parseSrt(input).lines).toEqual([]);
    }
  });
  it("preserves an overlapping cue end when reopening and saving SRT", () => {
    const input =
      "1\n00:00:01,000 --> 00:00:04,000\nfirst\n\n" +
      "2\n00:00:02,000 --> 00:00:05,000\nsecond\n";

    expect(serializeSrt(parseSrt(input))).toBe(input);
  });

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
  it("rejects tampered recovery cue settings before output could acquire another cue", () => {
    for (const settings of ["X1:10\n2\n00:00:02,000 --> 00:00:04,000", "X1:10 --> fake", "X1:10\u2028hidden"]) {
      expect(() => serializeSrt(docOf([{ id: "cue", timestamp: 1, srtEndTime: 3, text: "safe", srtCueSettings: settings }]))).toThrow();
    }
  });
  it("rejects terminal newlines that SRT parsing would remove from a cue body", () => {
    expect(() => serializeSrt(docOf([{ id: "1", timestamp: 1, text: "first\n" }]))).toThrow(
      "SRT cannot preserve blank paragraph rows",
    );
  });

  it("rejects a terminal newline after translated text in an SRT cue", () => {
    expect(() => serializeSrt(docOf([{ id: "1", timestamp: 1, text: "original", translation: "translated\n" }]))).toThrow(
      "SRT cannot preserve blank paragraph rows",
    );
  });

  it("escapes SRT markup while preserving literal text on reopen", () => {
    const text = "A <b>bold</b> &amp; B";
    const serialized = serializeSrt(docOf([{ id: "1", timestamp: 1, text }]));
    expect(serialized).toContain("A &lt;b&gt;bold&lt;/b&gt; &amp;amp; B");
    expect(parseSrt(serialized).lines[0].text).toBe(text);
  });

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

  it("round-trips editor-created blank timed rows through an SRT working save", () => {
    const edited = docOf([
      { id: "first", timestamp: 1, text: "first" },
      { id: "first-end", timestamp: 3, text: "" },
      { id: "second", timestamp: 5, text: "second" },
      { id: "second-end", timestamp: 7, text: "" },
    ]);
    const saved = serializeSrt(edited);
    const reopened = parseSrt(saved);

    expect(saved).toContain("00:00:01,000 --> 00:00:03,000\nfirst");
    expect(saved).toContain("00:00:05,000 --> 00:00:07,000\nsecond");
    expect(reopened.lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([
      [1, "first"], [3, ""], [5, "second"], [7, ""],
    ]);
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
  const shifted = { ...parsed, lines: parsed.lines.map(line => ({
    ...line,
    timestamp: line.timestamp === null ? null : line.timestamp + 2,
    srtEndTime: line.srtEndTime === undefined ? undefined : line.srtEndTime + 2,
  })) };
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
it("rejects an SRT cue collapsed by negative-time clamping instead of inventing a fallback end", () => {
  const collapsed = docOf([{ id: "collapsed", timestamp: 0, srtEndTime: 0, text: "cue" }]);
  expect(() => serializeSrt(collapsed)).toThrow("SRT timestamp");
});

it('rejects finite subtitle times that overflow integer milliseconds instead of emitting Infinity or NaN', () => {
 const huge = 1e306;
 expect(Number.isFinite(huge)).toBe(true);
 expect(() => serializeSrt(docOf([{id:'a',timestamp:huge,text:'unsafe'}]))).toThrow('SRT timestamp');
 const malformed = `1\n${'9'.repeat(304)}:00:00,000 --> ${'9'.repeat(304)}:00:01,000\nunsafe`;
 const parsed = parseSrt(malformed);
 expect(parsed.lines.length).toBeGreaterThan(0);
 expect(() => serializeSrt(parsed)).toThrow('SRT timestamp');
});
it.each(['junk00:00:01,000','00:61:01,000','00:00:61,000','00:00:01,0000',`${'9'.repeat(400)}:00:01,000`])('rejects malformed or non-finite SRT start: %s', start => {
 expect(() => parseSrt(`1\n${start} --> 00:00:05,000\ninvalid`)).toThrow(SrtMalformedCueError);
});
it('retains compatibility with whitespace-separated cue position settings', () => {
 expect(parseSrt('1\n00:00:01,250 --> 00:00:03,500 X1:10 X2:20\ntext').lines.map(l=>l.timestamp)).toEqual([1.25,3.5]);
});
