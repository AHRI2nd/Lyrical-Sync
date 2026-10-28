import { describe, it, expect } from "vitest";
import {
  parseLrc,
  serializeLrc,
  tokenizeText,
  isStampable,
  clampToNeighbors,
  parseTimestamp,
  parseTimestampInput,
  formatTimestamp,
  validateTimestamps,
} from "./lrcParser";
import type { LrcDocument } from "../types/lrc";

const emptyMeta = { title: "", artist: "", album: "", by: "", offset: 0 };
const docOf = (lines: LrcDocument["lines"]): LrcDocument => ({
  metadata: emptyMeta,
  lines,
  extraTags: {},
});

it.each([
  ["title", { title: "safe\n[00:02.00]injected", artist: "", album: "", by: "", offset: 0 }],
  ["artist", { title: "", artist: "safe\rvalue", album: "", by: "", offset: 0 }],
  ["album", { title: "", artist: "", album: "safe\nvalue", by: "", offset: 0 }],
  ["by", { title: "", artist: "", album: "", by: "safe\r\nvalue", offset: 0 }],
])("rejects line breaks in %s metadata", (_field, metadata) => {
  expect(() => serializeLrc({ ...docOf([]), metadata })).toThrow("LRC metadata cannot contain line breaks");
});

it("rejects line breaks in extra metadata keys and values", () => {
  expect(() => serializeLrc({ ...docOf([]), extraTags: { "x-safe\n[00:02.00]": "value" } })).toThrow("LRC metadata cannot contain line breaks");
  expect(() => serializeLrc({ ...docOf([]), extraTags: { "x-safe": "value\r\n[00:02.00]" } })).toThrow("LRC metadata cannot contain line breaks");
});

describe("tokenizeText", () => {
  it("splits by character, preserving spaces as tokens", () => {
    expect(tokenizeText("너의 손", "char").map((s) => s.text)).toEqual(["너", "의", " ", "손"]);
  });
  it("splits by word, keeping whitespace runs as separate tokens", () => {
    expect(tokenizeText("hello world", "word").map((s) => s.text)).toEqual(["hello", " ", "world"]);
  });
  it("returns empty for empty text", () => {
    expect(tokenizeText("", "char")).toEqual([]);
  });
  it("all tokens start with null time", () => {
    expect(tokenizeText("ab", "char").every((s) => s.time === null)).toBe(true);
  });
});

describe("isStampable", () => {
  it("is false for whitespace-only tokens", () => {
    expect(isStampable({ text: " ", time: null })).toBe(false);
    expect(isStampable({ text: "", time: null })).toBe(false);
  });
  it("is true for content tokens", () => {
    expect(isStampable({ text: "가", time: null })).toBe(true);
  });
});

describe("timestamp parsing/formatting", () => {
  it("parses [mm:ss.xx]", () => {
    expect(parseTimestamp("[01:02.34]")).toBeCloseTo(62.34, 5);
  });
  it("parses without centiseconds", () => {
    expect(parseTimestamp("[00:05]")).toBe(5);
  });
  it("parseTimestampInput handles 2 and 3 digit fractions", () => {
    expect(parseTimestampInput("1:02.34")).toBeCloseTo(62.34, 5);
    expect(parseTimestampInput("0:00.500")).toBeCloseTo(0.5, 5);
  });
  it("formatTimestamp round-trips", () => {
    expect(formatTimestamp(62.34)).toBe("01:02.34");
    expect(formatTimestamp(5)).toBe("00:05.00");
  });
});

it("round-trips bracketed metadata values without turning their suffixes into lyric rows", () => {
  const doc = parseLrc([
    "[ti:Song [Live]: Reprise]",
    "[ar:Björk: 京子]",
    "[al:Album [Deluxe [夜]]]",
    "[by:Editor [v2]]",
    "[x-source:Provider: [🎧]]",
    "[00:01.00]Actual lyric",
  ].join("\n"));

  expect(doc.metadata).toMatchObject({
    title: "Song [Live]: Reprise",
    artist: "Björk: 京子",
    album: "Album [Deluxe [夜]]",
    by: "Editor [v2]",
  });
  expect(doc.extraTags["x-source"]).toBe("Provider: [🎧]");
  expect(doc.lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([[1, "Actual lyric"]]);
  const restored = parseLrc(serializeLrc(doc));
  expect(restored.metadata).toEqual(doc.metadata);
  expect(restored.extraTags).toEqual(doc.extraTags);
  expect(restored.lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([[1, "Actual lyric"]]);
});

it("round-trips empty bracket metadata and timestamp-like literal lyric text", () => {
  const doc = parseLrc("[ti:]\n[ar:]\n[x-empty:]\n[00:01.00]hello");
  doc.lines.push({ id: "literal", timestamp: null, text: "[00:02.00]literal", translation: "[Intro: 夜]" });
  const restored = parseLrc(serializeLrc(doc));
  expect(restored.metadata).toMatchObject({ title: "", artist: "" });
  expect(restored.extraTags["x-empty"]).toBe("");
  expect(restored.lines.map(({ timestamp, text, translation }) => [timestamp, text, translation])).toEqual([
    [1, "hello", undefined],
    [null, "[00:02.00]literal", "[Intro: 夜]"],
  ]);
});

describe("parseLrc — line level", () => {
  it("round-trips literal inline timestamp text without treating it as Enhanced LRC timing", () => {
    const original = docOf([{ id: "literal", timestamp: 1, text: "Look <00:02.00> here" }]);
    const serialized = serializeLrc(original);
    const restored = parseLrc(serialized);

    expect(serialized).toContain("[x-lyrical-inline-escape:1]");
    expect(restored.lines[0].text).toBe("Look <00:02.00> here");
    expect(restored.lines[0].syllables).toBeUndefined();
  });

  it("keeps generated Enhanced LRC timestamps while escaping literal timestamp text in syllables", () => {
    const original = docOf([{
      id: "timed", timestamp: 12, text: "word <00:02.00>",
      syllables: [{ text: "word ", time: 12 }, { text: "<00:02.00>", time: 12.4 }],
    }]);
    const serialized = serializeLrc(original);
    const restored = parseLrc(serialized);

    expect(serialized).toContain("<00:12.00>word <00:12.40>\\u003C00:02.00>");
    expect(restored.lines[0].text).toBe(original.lines[0].text);
    expect(restored.lines[0].syllables).toEqual(original.lines[0].syllables);
  });

  it("decodes the inline extension and translation escapes exactly once", () => {
    const original = docOf([{
      id: "translated", timestamp: 1,
      text: "original \\\\u003C00:03.00> \\\\ path",
      translation: "translated <00:02.00> \\\\u003C00:04.00> \\\\ path\nnext",
    }]);
    const restored = parseLrc(serializeLrc(original));

    expect(restored.lines.map(({ text, translation }) => [text, translation])).toEqual([
      [original.lines[0].text, original.lines[0].translation],
    ]);
  });

  it("fails clearly if an existing extra tag collides with the required extension marker", () => {
    const original = docOf([{ id: "literal", timestamp: 1, text: "<00:02.00>" }]);
    original.extraTags["x-lyrical-inline-escape"] = "custom value";

    expect(() => serializeLrc(original)).toThrow("x-lyrical-inline-escape tag is reserved");
  });

  it("uses the extension in non-enhanced export without emitting inline timing tags", () => {
    const original = docOf([{
      id: "literal", timestamp: 1, text: "Look <00:02.00>",
      syllables: [{ text: "Look ", time: null }, { text: "<00:02.00>", time: 1.5 }],
    }]);
    const serialized = serializeLrc(original, false);
    const restored = parseLrc(serialized);

    expect(serialized).toContain("[x-lyrical-inline-escape:1]");
    expect(serialized).not.toContain("<00:01.50>");
    expect(restored.lines[0].text).toBe(original.lines[0].text);
  });

  it("parses a plain timestamped line", () => {
    const d = parseLrc("[00:03.50]hello");
    expect(d.lines[0].timestamp).toBe(3.5);
    expect(d.lines[0].text).toBe("hello");
    expect(d.lines[0].syllables).toBeUndefined();
  });
  it("expands repeated timestamps [t1][t2]text into multiple lines", () => {
    const d = parseLrc("[00:01.00][00:05.00]chorus");
    expect(d.lines.map((l) => [l.timestamp, l.text])).toEqual([
      [1, "chorus"],
      [5, "chorus"],
    ]);
  });
  it("parses metadata and preserves unknown tags", () => {
    const d = parseLrc("[ti:Song]\n[ar:Artist]\n[custom:x]\n[00:01.00]a");
    expect(d.metadata.title).toBe("Song");
    expect(d.metadata.artist).toBe("Artist");
    expect(d.extraTags.custom).toBe("x");
  });
});

describe("Enhanced LRC (A2) — char/word sync", () => {
  it("parses inline <mm:ss.xx> tags into syllables", () => {
    const d = parseLrc("[00:12.00]<00:12.00>너<00:12.24>의 손");
    expect(d.lines[0].timestamp).toBe(12);
    expect(d.lines[0].text).toBe("너의 손");
    expect(d.lines[0].syllables?.map((s) => [s.text, s.time])).toEqual([
      ["너", 12.0],
      ["의 손", 12.24],
    ]);
  });

  it("serializes syllables to A2 inline form", () => {
    const out = serializeLrc(
      docOf([
        {
          id: "1",
          timestamp: 12,
          text: "너의",
          syllables: [
            { text: "너", time: 12.0 },
            { text: "의", time: 12.24 },
          ],
        },
      ])
    );
    expect(out.trim()).toBe("[00:12.00]<00:12.00>너<00:12.24>의");
  });

  it("round-trips parse(serialize(...))", () => {
    const original = docOf([
      {
        id: "1",
        timestamp: 12,
        text: "너의",
        syllables: [
          { text: "너", time: 12.0 },
          { text: "의", time: 12.24 },
        ],
      },
    ]);
    const reparsed = parseLrc(serializeLrc(original));
    expect(reparsed.lines[0].syllables?.map((s) => [s.text, s.time])).toEqual([
      ["너", 12.0],
      ["의", 12.24],
    ]);
  });

  it("keeps whitespace tokens (no time) intact through serialize", () => {
    const out = serializeLrc(
      docOf([
        {
          id: "1",
          timestamp: 1,
          text: "a b",
          syllables: [
            { text: "a", time: 1.0 },
            { text: " ", time: null },
            { text: "b", time: 2.0 },
          ],
        },
      ])
    );
    expect(out.trim()).toBe("[00:01.00]<00:01.00>a <00:02.00>b");
    expect(parseLrc(out).lines[0].text).toBe("a b");
  });

  it("falls back to plain output when no syllable has a time", () => {
    const out = serializeLrc(
      docOf([{ id: "1", timestamp: 5, text: "hi", syllables: [{ text: "hi", time: null }] }])
    );
    expect(out.trim()).toBe("[00:05.00]hi");
  });

  it("enhanced=false strips glyph tags (plain LRC)", () => {
    const doc = docOf([
      {
        id: "1",
        timestamp: 12,
        text: "너의",
        syllables: [
          { text: "너", time: 12.0 },
          { text: "의", time: 12.24 },
        ],
      },
    ]);
    expect(serializeLrc(doc, true).trim()).toBe("[00:12.00]<00:12.00>너<00:12.24>의");
    expect(serializeLrc(doc, false).trim()).toBe("[00:12.00]너의");
  });
});

describe("clampToNeighbors", () => {
  const row = [
    { text: "a", time: 5 as number | null },
    { text: "b", time: null as number | null },
    { text: "c", time: 8 as number | null },
  ];
  it("clamps up to the previous stamped time", () => {
    expect(clampToNeighbors(row, 1, 3)).toBe(5);
  });
  it("clamps down to the next stamped time", () => {
    expect(clampToNeighbors(row, 1, 10)).toBe(8);
  });
  it("keeps a value already between neighbors", () => {
    expect(clampToNeighbors(row, 1, 6.5)).toBe(6.5);
  });
  it("never goes below 0", () => {
    expect(clampToNeighbors([{ text: "a", time: null }], 0, -2)).toBe(0);
  });
  it("with no stamped neighbors, only enforces non-negative", () => {
    expect(clampToNeighbors([{ text: "a", time: null }], 0, 12.3)).toBe(12.3);
  });
});

describe("validateTimestamps", () => {
  it("flags duplicate timestamps", () => {
    const w = validateTimestamps([
      { id: "a", timestamp: 1, text: "x" },
      { id: "b", timestamp: 1, text: "y" },
    ]);
    expect(w.get("a")).toBe("duplicate");
    expect(w.get("b")).toBe("duplicate");
  });
  it("flags out-of-order timestamps", () => {
    const w = validateTimestamps([
      { id: "a", timestamp: 5, text: "x" },
      { id: "b", timestamp: 2, text: "y" },
    ]);
    expect(w.get("b")).toBe("outOfOrder");
  });
});


describe("long LRC timestamps", () => {
  it.each([99, 100, 1000])("round-trips %i-minute line and inline timestamps", (minutes) => {
    const start = minutes * 60 + 59.25;
    const doc = docOf([{ id: "long", text: "ab", timestamp: start,
      syllables: [{ text: "a", time: start }, { text: "b", time: start + 0.5 }] }]);
    const parsed = parseLrc(serializeLrc(doc));
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({ timestamp: start, text: "ab", syllables: doc.lines[0].syllables });
    expect(parseTimestamp(`[${formatTimestamp(start)}]`)).toBe(start);
    expect(parseLrc(serializeLrc(doc, false)).lines[0]).toMatchObject({ timestamp: start, text: "ab" });
  });
  it("parses repeated long timestamps and millisecond inline tags", () => {
    const doc = parseLrc("[100:00.123][1000:00.123]<100:00.123>a<100:00.456>b");
    expect(doc.lines.map((line) => line.timestamp)).toEqual([6000.123, 60000.123]);
    expect(doc.lines[0].syllables?.map((token) => token.time)).toEqual([6000.123, 6000.456]);
    expect(doc.lines[0].syllables).not.toBe(doc.lines[1].syllables);
  });
});


describe("explicit translation LRC", () => {
  it("preserves default literal slash rows and ignores unsupported markers", () => {
    for (const header of ["", "[x-lyrical-translations:2]\n"]) {
      const parsed = parseLrc(header + "[00:01.00]original\n[00:01.00]/literal");
      expect(parsed.lines.map(l => l.text)).toEqual(["original", "/literal"]);
      expect(parsed.lines.every(l => !("translation" in l))).toBe(true);
    }
  });
  it("pairs marked repeated timestamps before sorting and retains enhanced originals", () => {
    const parsed = parseLrc("[x-lyrical-translations:1]\n[00:01.00][00:05.00]<00:01.00>hi\n[00:01.00][00:05.00]/hello\n[00:03.00]/literal");
    expect(parsed.lines.map(l => [l.timestamp, l.text, l.translation])).toEqual([
      [1, "hi", "hello"], [3, "/literal", undefined], [5, "hi", "hello"],
    ]);
    expect(parsed.lines[0].syllables).toEqual([{ text: "hi", time: 1 }]);
    expect(parsed.lines[0].syllables).not.toBe(parsed.lines[2].syllables);
  });
  it("round-trips enhanced, untimed and empty translations alongside literal slash rows", () => {
    const doc = docOf([
      { id: "1", timestamp: 1, text: "hi", translation: "hello", syllables: [{ text: "hi", time: 1 }] },
      { id: "2", timestamp: 1, text: "/literal" },
      { id: "3", timestamp: null, text: "untimed", translation: "plain" },
      { id: "4", timestamp: null, text: "\\literal", translation: "" },
    ]);
    const out = serializeLrc(doc);
    expect(out).toContain("[x-lyrical-translations:1]");
    const parsed = parseLrc(out);
    expect(parsed.lines.map(l => [l.timestamp, l.text, l.translation])).toEqual([
      [1, "hi", "hello"], [1, "/literal", undefined], [null, "untimed", "plain"], [null, "\\literal", ""],
    ]);
    expect(parsed.lines[0].syllables).toEqual([{ text: "hi", time: 1 }]);
    expect(parseLrc(serializeLrc(doc, false)).lines[0].syllables).toBeUndefined();
  });
  it("drops stale translation markers when no line has a translation", () => {
    const doc = docOf([{ id: "1", timestamp: 1, text: "a" }, { id: "2", timestamp: 1, text: "/b" }]);
    doc.extraTags = { "x-lyrical-translations": "1" };
    const out = serializeLrc(doc);
    expect(out).not.toContain("x-lyrical-translations");
    expect(parseLrc(out).lines.map(l => l.text)).toEqual(["a", "/b"]);
  });
});


it("retains empty untimed originals and multiline translation strings in marked LRC", () => {
  const doc = docOf([
    { id: "1", timestamp: null, text: "", translation: "only translation" },
    { id: "2", timestamp: null, text: "one\ntwo\\n", translation: "/three\nfour\\path" },
  ]);
  expect(parseLrc(serializeLrc(doc)).lines.map(l => [l.text, l.translation])).toEqual([
    ["", "only translation"], ["one\ntwo\\n", "/three\nfour\\path"],
  ]);
});
it("does not merge pre-marker or mismatched repeated timestamps", () => {
  const parsed = parseLrc("[00:01.00]a\n[00:01.00]/b\n[x-lyrical-translations:1]\n[00:03.00][00:05.00]c\n[00:03.00]/d");
  expect(parsed.lines.map(l => [l.timestamp, l.text, l.translation])).toEqual([
    [1, "a", undefined], [1, "/b", undefined], [3, "c", undefined], [3, "/d", undefined], [5, "c", undefined],
  ]);
});


it("retains ordinary LRC whitespace normalization around timestamps", () => {
  expect(parseLrc("  [00:01.00]hello  ").lines[0]).toMatchObject({ timestamp: 1, text: "hello" });
});

it("parses the millisecond timestamp displayed by hour-aware inline editors", () => {
  expect(parseTimestampInput("1:00:02.369")).toBe(3602.369);
  expect(parseTimestampInput("0:00:02.369")).toBe(2.369);
  expect(parseTimestampInput("60:02.369")).toBe(3602.369);
});

it.each(['[Intro: Instrumental]', '[ti:literal title]', '[00:02.00]literal cue'])('retains untimed bracket syntax as literal lyrics: %s', text => {
 const doc=docOf([{id:'a',timestamp:null,text}]);
 doc.metadata.title='actual title';
 const restored=parseLrc(serializeLrc(doc));
 expect(restored.lines.map(l=>[l.timestamp,l.text])).toEqual([[null,text]]);
 expect(restored.metadata.title).toBe('actual title');
});
it('retains timestamp-like lyric text after a real timestamp', () => {
 const restored=parseLrc(serializeLrc(docOf([{id:'a',timestamp:1,text:'[00:02.00]echo'}])));
 expect(restored.lines.map(l=>[l.timestamp,l.text])).toEqual([[1,'[00:02.00]echo']]);
});
it('keeps marked bracket lyrics and translations distinct from legacy tags', () => {
 const doc=docOf([{id:'a',timestamp:null,text:'[by:literal]',translation:'[Intro: translated]'},
  {id:'b',timestamp:null,text:'\\[literal]',translation:'\\path'}]);
 const restored=parseLrc(serializeLrc(doc));
 expect(restored.lines.map(l=>[l.text,l.translation])).toEqual([['[by:literal]','[Intro: translated]'],['\\[literal]','\\path']]);
 expect(parseLrc('[ti:legacy]\n[00:01.00]hello').metadata.title).toBe('legacy');
 expect(parseLrc('\\[literal]').lines[0].text).toBe('\\[literal]');
});

it.each([' [ti:literal title]', '\t[Intro: Instrumental]'])('preserves whitespace-prefixed bracket lyrics with or without translations: %s', text => {
 for(const translated of [false,true]) {
  const doc=docOf([{id:'a',timestamp:null,text,...(translated?{translation:'translated'}:{})}]);
  doc.metadata.title='actual title';
  const restored=parseLrc(serializeLrc(doc));
  expect(restored.lines.map(l=>l.text)).toEqual([text]);
  expect(restored.metadata.title).toBe('actual title');
 }
});
