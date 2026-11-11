import { describe, it, expect } from "vitest";
import { escapeVttText, serializeVtt, serializeAss, SubtitleTimestampUnrepresentableError } from "./exportFormats";
import { parseSrt } from "./srtConverter";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "Song", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({ metadata: emptyMeta, lines, extraTags: {} });

describe("serializeVtt", () => {
  it("renders only supported balanced SRT inline styles and escapes literal or malformed markup", () => {
    const styled = serializeVtt(parseSrt(
      "1\n00:00:01,000 --> 00:00:05,000\n<i>one <b>two</b></i> <u>three</u>\n",
    ));
    expect(styled).toContain("<i>one <b>two</b></i> <u>three</u>");

    const literal = serializeVtt(parseSrt(
      "1\n00:00:01,000 --> 00:00:05,000\n&lt;b&gt;literal&lt;/b&gt;\n",
    ));
    expect(literal).toContain("&lt;b&gt;literal&lt;/b&gt;");

    const malformed = serializeVtt(parseSrt("1\n00:00:01,000 --> 00:00:05,000\n<i>unclosed\n"));
    expect(malformed).toContain("&lt;i&gt;unclosed");
    expect(malformed).not.toContain("<i>unclosed");
  });

  it.each([
    { id: "combined", timestamp: 1, text: "original\r\n", translation: "translated" },
    { id: "paragraph", timestamp: 1, text: "first\n\nsecond" },
  ])("rejects cue bodies with blank paragraphs: $id", (line) => {
    expect(() => serializeVtt(docOf([line]))).toThrow("VTT cannot preserve blank paragraph rows");
  });
  it("escapes text characters in order without changing original text", () => {
    expect(escapeVttText("& < > &amp;")).toBe("&amp; &lt; &gt; &amp;amp;");
  });

  it("escapes WebVTT markup, entities, and literal timestamp-shaped body text", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "A <b>bold</b> &amp; B > <00:02.00>" },
    ]));
    expect(out).toContain("A &lt;b&gt;bold&lt;/b&gt; &amp;amp; B &gt; &lt;00:02.00&gt;");
  });

  it("emits a WEBVTT header and cues with .mmm times", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "first" },
      { id: "2", timestamp: 3, text: "second" },
    ]), 10);
    expect(out.startsWith("WEBVTT")).toBe(true);
    expect(out).toContain("00:00:01.000 --> 00:00:03.000\nfirst");
    expect(out).toContain("00:00:03.000 --> 00:00:10.000\nsecond"); // last uses lastCueEnd
  });

  it.each([-0.001, Number.MAX_VALUE])("rejects an unrepresentable cue timestamp %s", (timestamp) => {
    expect(() => serializeVtt(docOf([{ id: "bad", timestamp, text: "bad" }]))).toThrow(SubtitleTimestampUnrepresentableError);
  });

  it("preserves valid millisecond boundaries", () => {
    expect(serializeVtt(docOf([{ id: "edge", timestamp: 1.2345, text: "edge" }]))).toContain("00:00:01.235 --> 00:00:05.235");
  });

  it("emits inline timestamps for glyph-synced lines", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] },
    ]), 3);
    expect(out).toContain("a<00:00:01.500>b");
  });

  it.each([0.5, 2, Number.NaN])("rejects VTT glyph time %s outside its cue", (time) => {
    expect(() => serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "a", syllables: [{ text: "a", time }] },
      { id: "2", timestamp: 2, text: "next" },
    ]))).toThrow("VTT cannot represent these syllable timestamps");
  });

  it("omits a redundant inline glyph timestamp at the cue start", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] },
    ]), 3);
    expect(out).toContain("00:00:01.000 --> 00:00:03.000\na<00:00:01.500>b");
  });

  it("escapes syllable text but leaves generated VTT timing tags intact", () => {
    const out = serializeVtt(docOf([{
      id: "1", timestamp: 1, text: "<b> & >", translation: "&amp; <i>",
      syllables: [{ text: "<b> ", time: null }, { text: "& >", time: 1.5 }],
    }]));
    expect(out).toContain("&lt;b&gt; <00:00:01.500>&amp; &gt;\n&amp;amp; &lt;i&gt;");
  });

  it("escapes translation-only lines", () => {
    const out = serializeVtt(docOf([{ id: "1", timestamp: 1, text: "", translation: "<b>&amp;</b>" }]));
    expect(out).toContain("&lt;b&gt;&amp;amp;&lt;/b&gt;");
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
  it("converts only supported balanced SRT inline styles to ASS overrides", () => {
    const styled = serializeAss(parseSrt(
      "1\n00:00:01,000 --> 00:00:05,000\n<i>one <b>two</b></i> <u>three</u>\n",
    ));
    expect(styled).toContain("{\\i1}one {\\b1}two{\\b0}{\\i0} {\\u1}three{\\u0}");

    const repeated = serializeAss(parseSrt(
      "1\n00:00:01,000 --> 00:00:05,000\n<i>outer <i>inner</i> outer</i>\n",
    ));
    expect(repeated).toContain("{\\i1}outer inner outer{\\i0}");

    const malformed = serializeAss(parseSrt("1\n00:00:01,000 --> 00:00:05,000\n<i>unclosed\n"));
    expect(malformed).toContain("<i>unclosed");
    expect(malformed).not.toContain("{\\i1}");
  });

  it.each([-0.001, Number.MAX_VALUE])("rejects an unrepresentable cue timestamp %s", (timestamp) => {
    expect(() => serializeAss(docOf([{ id: "bad", timestamp, text: "bad" }]))).toThrow(SubtitleTimestampUnrepresentableError);
  });

  it("preserves valid centisecond boundaries", () => {
    expect(serializeAss(docOf([{ id: "edge", timestamp: 1.2345, text: "edge" }]))).toContain("0:00:01.23,0:00:05.23");
  });

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

  it("preserves the silent gap before the first timed glyph", () => {
    const out = serializeAss(docOf([{
      id: "1", timestamp: 1, text: "ab",
      syllables: [{ text: "a", time: 1.25 }, { text: "b", time: 1.5 }],
    }]), 2);
    expect(out).toContain("{\\k25}{\\k25}a{\\k50}b");
  });

  it.each([0.104, 0.106])("keeps long karaoke timing within the rounded cue end at %s seconds per glyph", (step) => {
    const syllables = Array.from({ length: 100 }, (_, index) => ({ text: "a", time: index * step }));
    const out = serializeAss(docOf([{ id: "long-fractional", timestamp: 0, text: "a".repeat(100), syllables }]), 100 * step);
    const event = out.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    const durations = [...event.matchAll(/\\k(\d+)/g)].map((match) => Number(match[1]));

    expect(durations).toHaveLength(100);
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(Math.round(100 * step * 100));
    expect(durations.every((duration) => duration >= 0)).toBe(true);
  });

  it("preserves centiseconds across sub-centisecond glyph boundaries", () => {
    const syllables = [0, 0.001, 0.004, 0.006].map((time, index) => ({ text: String(index), time }));
    const out = serializeAss(docOf([{ id: "small-boundaries", timestamp: 0, text: "0123", syllables }]), 0.01);
    const event = out.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    const durations = [...event.matchAll(/\\k(\d+)/g)].map((match) => Number(match[1]));

    expect(durations).toEqual([0, 0, 1, 0]);
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(1);
  });
});


describe("shared subtitle cue boundaries", () => {
  it("uses strictly later blank boundaries and final duration in VTT and ASS", () => {
    const doc = docOf([{ id: "a", timestamp: 1, text: "a" }, { id: "b", timestamp: 1, text: "b" },
      { id: "end", timestamp: 3, text: "" }, { id: "last", timestamp: 5, text: "last" }]);
    const vtt = serializeVtt(doc, 8);
    expect(vtt.match(/00:00:01.000 --> 00:00:03.000/g)).toHaveLength(2);
    expect(vtt).toContain("00:00:05.000 --> 00:00:08.000");
    const ass = serializeAss(doc, 8);
    expect(ass.match(/Dialogue: 0,0:00:01.00,0:00:03.00/g)).toHaveLength(2);
    expect(ass).toContain("Dialogue: 0,0:00:05.00,0:00:08.00");
  });
  it.each([undefined, 0, 5, NaN, Infinity])("uses finite fallback ends with duration %s", (end) => {
    const doc = docOf([{ id: "a", timestamp: 5, text: "a" }, { id: "b", timestamp: 5, text: "b" }]);
    expect(serializeVtt(doc, end).match(/00:00:05.000 --> 00:00:09.000/g)).toHaveLength(2);
    expect(serializeAss(doc, end).match(/Dialogue: 0,0:00:05.00,0:00:09.00/g)).toHaveLength(2);
  });
});


it("keeps valid cue ends after ASS centisecond rounding without shortening VTT precision", () => {
  const doc = docOf([{ id: "a", timestamp: 1.001, text: "a" }, { id: "b", timestamp: 1.004, text: "b" },
    { id: "c", timestamp: 3, text: "c" }]);
  expect(serializeVtt(doc)).toContain("00:00:01.001 --> 00:00:01.004");
  expect(serializeAss(doc).match(/Dialogue: 0,0:00:01.00,0:00:03.00/g)).toHaveLength(2);
  expect(serializeAss(docOf([{ id: "a", timestamp: 1.001, text: "a" }]), 1.004))
    .toContain("Dialogue: 0,0:00:01.00,0:00:05.00");
});


it("exports translations after enhanced originals in VTT and ASS", () => {
  const doc = docOf([{ id: "a", timestamp: 1, text: "hi", translation: "hello", syllables: [{ text: "hi", time: 1 }] }]);
  expect(serializeVtt(doc, 3)).toContain("hi\nhello");
  expect(serializeAss(doc, 3)).toContain("{\\k200}hi\\Nhello");
});
it.each(["{word}", "unmatched { brace", "unmatched } brace", "literal \\N line", "literal \\n line", "literal \\h space"])(
  "rejects ASS text that cannot be represented literally: %s",
  (text) => {
    expect(() => serializeAss(docOf([{ id: "a", timestamp: 1, text }]))).toThrow(/ASS cannot preserve this text/);
  },
);
it("rejects unrepresentable text in translations and timed syllables", () => {
  expect(() => serializeAss(docOf([{ id: "a", timestamp: 1, text: "safe", translation: "{literal}" }]))).toThrow(/ASS cannot preserve this text/);
  expect(() => serializeAss(docOf([{ id: "a", timestamp: 1, text: "safe", syllables: [{ text: "\\N", time: 1 }] }]))).toThrow(/ASS cannot preserve this text/);
});
it("rejects line breaks in the ASS title header", () => {
  const doc = { ...docOf([{ id: "a", timestamp: 1, text: "safe" }]), metadata: { ...emptyMeta, title: "title\n[Events]" } };
  expect(() => serializeAss(doc)).toThrow(/ASS cannot preserve this text/);
});
it("encodes actual body newlines while preserving ordinary backslashes and generated karaoke tags", () => {
  const doc = docOf([{ id: "a", timestamp: 1, text: "one\\path\ntwo", translation: "three\\music\nfour" }]);
  const out = serializeAss(doc, 3);
  expect(out).toContain("one\\path\\Ntwo\\Nthree\\music\\Nfour");
  expect(out.split("\n").filter(l => l.startsWith("Dialogue:"))).toHaveLength(1);
  const karaoke = serializeAss(docOf([{ id: "b", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] }]), 2);
  expect(karaoke).toContain("{\\k50}a{\\k50}b");
});
it("does not add empty subtitle translation rows", () => {
  const doc = docOf([{ id: "a", timestamp: 1, text: "hi", translation: "" }]);
  expect(serializeVtt(doc, 3)).toContain("\nhi\n");
  expect(serializeAss(doc, 3)).not.toContain("hi\\N");
});


it("exports translation-only content in VTT and ASS", () => {
  const doc = docOf([{ id: "1", timestamp: 1, text: "", translation: "translated" }]);
  expect(serializeVtt(doc, 3)).toContain("00:00:01.000 --> 00:00:03.000\ntranslated");
  expect(serializeAss(doc, 3)).toContain("Default,,0,0,0,,translated");
});
