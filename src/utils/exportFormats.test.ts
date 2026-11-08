import { describe, it, expect } from "vitest";
import { escapeVttText, nextCueEnds, serializeVtt, serializeAss } from "./exportFormats";
import { parseLrc } from "./lrcParser";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "Song", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({ metadata: emptyMeta, lines, extraTags: {} });

describe("serializeVtt", () => {
  it("rejects a blank paragraph formed where original text meets translation", () => {
    expect(() => serializeVtt(docOf([{ id: "1", timestamp: 1, text: "original\n", translation: "translated" }]))).
      toThrow("VTT cannot preserve blank paragraph rows");
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

  it("emits inline timestamps for glyph-synced lines", () => {
    const out = serializeVtt(docOf([
      { id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] },
    ]), 3);
    expect(out).toContain("a<00:00:01.500>b");
  });

  it("exports a marked enhanced-LRC untimed prefix when the first timed glyph starts at the cue start", () => {
    const parsed = parseLrc("[x-lyrical-translations:1]\n[00:01.00] <00:01.00>a<00:01.50>b");
    expect(parsed.lines[0]).toMatchObject({
      timestamp: 1, text: " ab",
      syllables: [{ text: " ", time: null }, { text: "a", time: 1 }, { text: "b", time: 1.5 }],
    });
    expect(serializeVtt(parsed, 3)).toContain("00:00:01.000 --> 00:00:03.000\n a<00:00:01.500>b");
  });

  it("preserves untimed prefix text, escaping, and later timestamp order", () => {
    const out = serializeVtt(docOf([{
      id: "1", timestamp: 1, text: "♪&<a>b",
      syllables: [
        { text: "♪&", time: null },
        { text: "<a>", time: 1 },
        { text: "b", time: 1.5 },
      ],
    }]), 3);
    expect(out).toContain("00:00:01.000 --> 00:00:03.000\n♪&amp;&lt;a&gt;<00:00:01.500>b");
    expect(out).not.toContain("<00:00:01.000>");
  });

  it.each([
    ["second start-equal timestamp", [
      { text: "prefix", time: null }, { text: "a", time: 1 }, { text: "b", time: 1 },
    ]],
    ["later reversed timestamp", [
      { text: "prefix", time: null }, { text: "a", time: 1.5 }, { text: "b", time: 1.25 },
    ]],
    ["cue-end timestamp", [
      { text: "prefix", time: null }, { text: "a", time: 1 }, { text: "b", time: 3 },
    ]],
  ])("still rejects genuinely invalid timed glyphs after untimed prefix: %s", (_case, syllables) => {
    const text = syllables.map((s) => s.text).join("");
    expect(() => serializeVtt(docOf([{ id: "1", timestamp: 1, text, syllables }]), 3))
      .toThrow(/VTT cannot represent these syllable timestamps/);
  });

  it.each([
    [{ id: "1", timestamp: 1, text: "a", syllables: [{ text: "a", time: 3 }] }, 3],
    [{ id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1.5 }, { text: "b", time: 1.5 }] }, 4],
    [{ id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 2 }, { text: "b", time: 1.5 }] }, 4],
  ])("rejects inline timestamps outside the cue or out of order", (line, end) => {
    expect(() => serializeVtt(docOf([line]), end)).toThrow(/VTT cannot represent these syllable timestamps/);
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

  it("distributes centisecond rounding across absolute karaoke boundaries", () => {
    const doc = docOf([{
      id: "fractional",
      timestamp: 0,
      text: "abc",
      syllables: [
        { text: "a", time: 0 },
        { text: "b", time: 0.004 },
        { text: "c", time: 0.008 },
      ],
    }]);
    const out = serializeAss(doc, 0.012);
    const event = out.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    const durations = [...event.matchAll(/\\k(\d+)/g)].map((match) => Number(match[1]));
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(1);
  });

  it("converts glyph timings into \\k karaoke durations (centiseconds)", () => {
    const out = serializeAss(docOf([
      { id: "1", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] },
    ]), 2);
    // a: 1.0→1.5 = 50cs, b: 1.5→cueEnd(2.0) = 50cs
    expect(out).toContain("{\\k50}a{\\k50}b");
  });
});


it.each([NaN, Infinity, 1e300])("rejects VTT and ASS timestamps outside safe output precision: %s", (timestamp) => {
  const doc = docOf([{ id: "unsafe", timestamp, text: "unsafe" }]);
  expect(() => serializeVtt(doc)).toThrow("Subtitle timestamp cannot be represented");
  expect(() => serializeAss(doc)).toThrow("Subtitle timestamp cannot be represented");
});

describe("shared subtitle cue boundaries", () => {
  it("precomputes equal-start fallback boundaries without rescanning later cues", () => {
    const lines = Array.from({ length: 5000 }, (_, index) => ({ id: String(index), timestamp: 5, text: "line" }));
    const ends = nextCueEnds(lines);
    expect(ends).toHaveLength(lines.length);
    expect(ends.every((end) => end === 9)).toBe(true);
  });

  it("keeps a positive fallback duration when negative starts clamp to zero", () => {
    const doc = docOf([{ id: "negative", timestamp: -5, text: "clamped" }]);
    expect(serializeVtt(doc)).toContain("00:00:00.000 --> 00:00:04.000\nclamped");
    expect(serializeAss(doc)).toContain("Dialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,clamped");
  });

  it("rejects SRT cue ends that collapse at ASS centisecond precision", () => {
    const shortCue = docOf([{ id: "short", timestamp: 1.001, srtEndTime: 1.004, text: "short" }]);
    expect(serializeVtt(shortCue)).toContain("00:00:01.001 --> 00:00:01.004");
    expect(() => serializeAss(shortCue)).toThrow("ASS centisecond precision cannot preserve");
  });

  it("preserves overlapping imported SRT cue ends in VTT and ASS", () => {
    const doc = docOf([
      { id: "first", timestamp: 1, srtEndTime: 4, text: "first" },
      { id: "second", timestamp: 2, srtEndTime: 5, text: "second" },
    ]);
    expect(serializeVtt(doc)).toContain("00:00:01.000 --> 00:00:04.000\nfirst");
    expect(serializeVtt(doc)).toContain("00:00:02.000 --> 00:00:05.000\nsecond");
    expect(serializeAss(doc)).toContain("Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,first");
    expect(serializeAss(doc)).toContain("Dialogue: 0,0:00:02.00,0:00:05.00,Default,,0,0,0,,second");
  });

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
it("waits from the cue start until the first timed ASS syllable", () => {
  const doc = docOf([{ id: "a", timestamp: 1, text: "ab", syllables: [
    { text: "a", time: 2 }, { text: "b", time: 2.5 },
  ] }]);
  expect(serializeAss(doc, 4)).toContain("Default,,0,0,0,,{\\k100}{\\k50}a{\\k150}b");
});
it("rejects ASS glyph timing after the cue ends", () => {
  const doc = docOf([{ id: "a", timestamp: 1, srtEndTime: 2, text: "ab", syllables: [
    { text: "a", time: 1 }, { text: "b", time: 10 },
  ] }]);

  expect(() => serializeAss(doc)).toThrow("ASS cannot preserve this text");
});
it.each([
  { id: "a", timestamp: 2, text: "a", syllables: [{ text: "a", time: 1 }] },
  { id: "a", timestamp: 1, text: "ab", syllables: [{ text: "a", time: 2 }, { text: "b", time: 1.5 }] },
])("rejects ASS syllable times before the cue or in reverse order", (line) => {
  expect(() => serializeAss(docOf([line]), 4)).toThrow(/ASS cannot preserve this text/);
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
it.each([
  [{ text: "\\", time: null }, { text: "N", time: null }],
  [{ text: "\\", time: 1 }, { text: "N", time: null }],
])("rejects ASS control escapes split across adjacent character tokens", (...syllables) => {
  const doc = docOf([{ id: "split-escape", timestamp: 1, text: "\\N", syllables }]);
  expect(() => serializeAss(doc, 3)).toThrow(/ASS cannot preserve this text/);
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
