import { describe, expect, it } from "vitest";
import { detectAlignmentLanguage } from "./detectAlignmentLanguage";

describe("lyric alignment language detection", () => {
  it.each([
    ["Hello world", "eng"],
    ["사랑해요 hello", "kor"],
    ["夜空に輝く stars", "jpn"],
    ["歌声", "jpn"],
    ["", "eng"],
    ["123 !?", "eng"],
    ["사랑", "kor"],
    ["ｶﾀｶﾅ", "jpn"],
  ] as const)("detects %s as %s", (input, expected) => {
    expect(detectAlignmentLanguage(input)).toBe(expected);
  });
});
