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

describe("parseLrc — line level", () => {
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

describe("parseLrc / serializeLrc — translation lines", () => {
  it("merges a same-timestamp /-prefixed line into the previous line's translation", () => {
    const d = parseLrc("[00:12.34]Hello world\n[00:12.34]/안녕 세상");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].text).toBe("Hello world");
    expect(d.lines[0].translation).toBe("안녕 세상");
  });

  it("merges a translation for an untimed line (no timestamp yet)", () => {
    const d = parseLrc("Hello world\n/안녕 세상");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].timestamp).toBeNull();
    expect(d.lines[0].text).toBe("Hello world");
    expect(d.lines[0].translation).toBe("안녕 세상");
  });

  it("round-trips a translation through serializeLrc → parseLrc", () => {
    const original = parseLrc("[00:12.34]Hello world");
    original.lines[0].translation = "안녕 세상";
    const out = serializeLrc(original, false);
    expect(out).toContain("[00:12.34]Hello world");
    expect(out).toContain("[00:12.34]/안녕 세상");
    const reparsed = parseLrc(out);
    expect(reparsed.lines).toHaveLength(1);
    expect(reparsed.lines[0].translation).toBe("안녕 세상");
  });

  it("does not merge into a chorus repeat (different timestamp sets)", () => {
    // [t1][t2]text 뒤에 다른 타임스탬프의 "/" 줄이 오면 병합 대상이 아니므로 별도 줄로 남음
    const d = parseLrc("[00:01.00][00:05.00]chorus\n[00:09.00]/not a translation");
    expect(d.lines).toHaveLength(3);
    expect(d.lines.every((l) => l.translation === undefined)).toBe(true);
  });

  it("a duplicate-timestamp original line without a / marker still warns as before (non-interference)", () => {
    const d = parseLrc("[00:01.00]a\n[00:01.00]b");
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0].translation).toBeUndefined();
    expect(d.lines[1].translation).toBeUndefined();
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
