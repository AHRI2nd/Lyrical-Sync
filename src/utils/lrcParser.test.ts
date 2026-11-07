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

it("retains unsupported reserved controls as inactive recovery data and refuses normal serialization", () => {
  const raw = "[x-lyrical-translations:custom]\n[x-lyrical-inline-escape:custom]\n[00:01.00]safe";
  const parsed = parseLrc(raw);
  expect(parsed.invalidControlTags).toEqual([
    { key: "x-lyrical-translations", value: "custom" },
    { key: "x-lyrical-inline-escape", value: "custom" },
  ]);
  expect(parsed.extraTags).toEqual({});
  expect(() => serializeLrc(parsed)).toThrow("reserved");
  expect(serializeLrc(parsed, true, true)).toContain("[x-lyrical-translations:custom]");
  expect(serializeLrc(parsed, true, true)).toContain("[x-lyrical-inline-escape:custom]");
});

it("round-trips unusual metadata names without inherited-object key collisions", () => {
  const raw = "[constructor:Credit]\n[toString:Source]\n[__proto__:Literal]\n[00:01.00]hello";
  const parsed = parseLrc(raw);
  expect(Object.getOwnPropertyDescriptor(parsed.extraTags, "constructor")?.value).toBe("Credit");
  expect(Object.getOwnPropertyDescriptor(parsed.extraTags, "tostring")?.value).toBe("Source");
  expect(Object.getOwnPropertyDescriptor(parsed.extraTags, "__proto__")?.value).toBe("Literal");
  const serialized = serializeLrc(parsed);
  expect(serialized).toContain("[constructor:Credit]");
  expect(serialized).toContain("[tostring:Source]");
  expect(serialized).toContain("[__proto__:Literal]");
  expect(parseLrc(serialized).lines.map((line) => [line.timestamp, line.text])).toEqual([[1, "hello"]]);
});

it("preserves repeated recognized and unknown metadata in source order across parse and save", () => {
  const input = "[ar:First Artist]\n[x-origin:First Source]\n[ar:Second Artist]\n[x-origin:Second Source]\n[00:01.00]lyric";
  const doc = parseLrc(input);
  expect(doc.metadata.artist).toBe("Second Artist");
  expect(doc.extraTags["x-origin"]).toBe("Second Source");
  const output = serializeLrc(doc);
  expect(output).toContain("[ar:First Artist]\n[x-origin:First Source]\n[ar:Second Artist]\n[x-origin:Second Source]");
  expect(serializeLrc(parseLrc(output))).toBe(output);
});

it("updates only the last repeated artist and custom tag when edited, including clearing the artist", () => {
  const doc = parseLrc("[ar:Early]\n[x-origin:Old]\n[ar:Latest]\n[x-origin:Recent]\n[00:01.00]hi");
  const edited = {
    ...doc,
    metadata: { ...doc.metadata, artist: "Changed", title: "New Title" },
    extraTags: { ...doc.extraTags, "x-origin": "New Source" },
  };
  const output = serializeLrc(edited);
  expect(output).toContain("[ar:Early]\n[x-origin:Old]\n[ar:Changed]\n[x-origin:New Source]");
  expect(output).toContain("[ti:New Title]");
  expect(parseLrc(output).metadata.artist).toBe("Changed");
  expect(parseLrc(output).extraTags["x-origin"]).toBe("New Source");

  edited.metadata.artist = "";
  const cleared = serializeLrc(edited);
  expect(cleared).toContain("[ar:Early]\n[x-origin:Old]\n[ar:]\n[x-origin:New Source]");
  expect(parseLrc(cleared).metadata.artist).toBe("");
});

it("preserves repeated prototype-named unknown keys without polluting object prototypes", () => {
  const doc = parseLrc("[__proto__:first]\n[__proto__:second]\n[constructor:prior]\n[constructor:final]\n[00:01.00]hi");
  const output = serializeLrc(doc);
  expect(output).toContain("[__proto__:first]\n[__proto__:second]\n[constructor:prior]\n[constructor:final]");
  expect(Object.getOwnPropertyDescriptor(parseLrc(output).extraTags, "__proto__")?.value).toBe("second");
  expect(Object.getPrototypeOf(doc.extraTags)).toBe(Object.prototype);
});

it("keeps the established single-tag shape and serialization unchanged", () => {
  const input = "[ti:Single]\n[ar:Artist]\n[x-origin:Source]\n[00:01.00]hello";
  const doc = parseLrc(input);
  expect(doc).not.toHaveProperty("metadataTagSequence");
  expect(serializeLrc(doc)).toBe(input.replace("[x-origin:Source]\n", "[x-origin:Source]\n\n"));
});

it("retains repeated offset values while reflecting an edited final numeric offset", () => {
  const parsed = parseLrc("[offset:0010]\n[offset:0020]\n[00:01.00]hi");
  expect(parsed.metadata.offset).toBe(20);
  expect(serializeLrc(parsed)).toContain("[offset:0010]\n[offset:0020]");
  const recovered = JSON.parse(JSON.stringify(parsed)) as LrcDocument;
  recovered.metadata.offset = 30;
  const output = serializeLrc(recovered);
  expect(output).toContain("[offset:0010]\n[offset:30]");
  expect(parseLrc(output).metadata.offset).toBe(30);
});

it("refuses to overwrite an unknown translation extension value when translations are active", () => {
  const doc = { ...docOf([{ id: "a", timestamp: 1, text: "original", translation: "translated" }]),
    extraTags: { "x-lyrical-translations": "custom" } };
  expect(() => serializeLrc(doc)).toThrow("reserved LRC tag has an unknown value");
});

it("retains unsupported line-order values but refuses normal serialization", () => {
  const parsed = parseLrc("[x-lyrical-line-order:external]\n[00:01.00]a");
  expect(parsed.invalidControlTags).toEqual([{ key: "x-lyrical-line-order", value: "external" }]);
  expect(() => serializeLrc(parsed)).toThrow("reserved LRC tag");
  expect(serializeLrc(parsed, true, true)).toContain("[x-lyrical-line-order:external]");
  const conflict = { ...docOf([{ id: "late", timestamp: 2, text: "late" }, { id: "early", timestamp: 1, text: "early" }]),
    extraTags: { "x-lyrical-line-order": "external" } };
  expect(() => serializeLrc(conflict)).toThrow("reserved LRC tag has an unknown value");
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

  it("serializes millisecond timestamps without rounding them to centiseconds", () => {
    const document = docOf([{ id: "ms", timestamp: 1.123, text: "line" }]);
    const serialized = serializeLrc(document);
    expect(serialized).toContain("[00:01.123]line");
    expect(parseLrc(serialized).lines[0].timestamp).toBe(1.123);
    expect(serializeLrc(docOf([{ id: "cs", timestamp: 1.12, text: "legacy" }]))).toContain("[00:01.12]legacy");
  });

  it("serializes millisecond syllable timestamps without precision loss", () => {
    const serialized = serializeLrc(docOf([{
      id: "syllables", timestamp: 1.123, text: "ab",
      syllables: [{ text: "a", time: 1.123 }, { text: "b", time: 1.456 }],
    }]));
    expect(serialized).toContain("[00:01.123]<00:01.123>a<00:01.456>b");
    expect(parseLrc(serialized).lines[0].syllables?.map((syllable) => syllable.time)).toEqual([1.123, 1.456]);
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

  it("rejects marked inline timestamps that overflow safe milliseconds", () => {
    const raw = "[x-lyrical-inline-escape:1]\n[00:01.00]<999999999999999999999999999999999999:00>word";
    expect(() => parseLrc(raw)).toThrow("LRC timestamps and offsets must be finite numbers");
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
  it("does not flag distinct millisecond timestamps as centisecond duplicates", () => {
    const warnings = validateTimestamps([
      { id: "a", timestamp: 1.001, text: "first" },
      { id: "b", timestamp: 1.002, text: "second" },
    ]);
    expect(warnings.has("a")).toBe(false);
    expect(warnings.has("b")).toBe(false);
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

it("round-trips edited row order, untimed blank rows, and lyric edge whitespace", () => {
  const doc = docOf([
    { id: 'first', timestamp: 1, text: '  first  ' },
    { id: 'blank', timestamp: null, text: '' },
    { id: 'middle', timestamp: null, text: '   ' },
    { id: 'last', timestamp: 3, text: 'last' },
  ]);
  const restored = parseLrc(serializeLrc(doc));
  expect(restored.lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([
    [1, '  first  '], [null, ''], [null, '   '], [3, 'last'],
  ]);
});

it("keeps legacy external LRC timestamp sorting without the app preservation marker", () => {
  expect(parseLrc('[00:03.00]late\n[00:01.00]early').lines.map((line) => line.text)).toEqual(['early', 'late']);
});

it("recognizes CR-only legacy LRC line endings as separate timed rows", () => {
  const parsed = parseLrc("[ti:CR only]\r[00:01.00]one\r[00:02.00]two\r");
  expect(parsed.metadata.title).toBe("CR only");
  expect(parsed.lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([
    [1, "one"], [2, "two"],
  ]);
  expect(parseLrc(serializeLrc(parsed)).lines.map((line) => line.text)).toEqual(["one", "two"]);
});

it("preserves explicitly escaped carriage returns in marked translation text", () => {
  const parsed = parseLrc("[x-lyrical-translations:1]\r[00:01.00]original\r[00:01.00]/line\\rbreak");
  expect(parsed.lines).toHaveLength(1);
  expect(parsed.lines[0].translation).toBe("line\rbreak");
  expect(parseLrc(serializeLrc(parsed)).lines[0].translation).toBe("line\rbreak");
});

it("parses the millisecond timestamp displayed by hour-aware inline editors", () => {
  expect(parseTimestampInput("1:00:02.369")).toBe(3602.369);
  expect(parseTimestampInput("0:00:02.369")).toBe(2.369);
  expect(parseTimestampInput("60:02.369")).toBe(3602.369);
});

  it("rejects timestamp input that overflows JavaScript's finite number range", () => {
    expect(parseTimestampInput(`${"9".repeat(310)}:00.00`)).toBeNull();
    expect(parseTimestamp(`[${"9".repeat(310)}:00.00]`)).toBeNull();
  });

  it("keeps overflowing timestamps literal when parsing an LRC row", () => {
    const raw = `[${"9".repeat(310)}:00.00]literal`;
    expect(parseLrc(raw).lines.map(({ timestamp, text }) => [timestamp, text])).toEqual([[null, raw]]);
  });

  it("rejects non-finite values at the LRC serialization boundary", () => {
    expect(() => serializeLrc(docOf([{ id: "bad", timestamp: Number.POSITIVE_INFINITY, text: "x" }]))).toThrow("timestamps and offsets must be finite");
    expect(() => serializeLrc({ ...docOf([]), metadata: { ...emptyMeta, offset: Number.NaN } })).toThrow("timestamps and offsets must be finite");
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
