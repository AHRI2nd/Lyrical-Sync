import { describe, expect, it } from "vitest";
import { detectLang } from "./useI18nStore";

describe("system language detection", () => {
  it("uses the first supported language in preferred order", () => {
    expect(detectLang(["en-US", "ko-KR", "ja-JP"])).toBe("en");
    expect(detectLang(["ko-KR", "ja-JP", "en-US"])).toBe("ko");
    expect(detectLang(["ja-JP", "ko-KR"])).toBe("ja");
  });

  it("does not match unsupported language prefixes", () => {
    expect(detectLang(["kok"])).toBe("en");
    expect(detectLang(["fr-FR", "kok"])).toBe("en");
  });

  it("skips malformed and unsupported candidates before a supported language", () => {
    expect(detectLang(["", "ko-", "en_US", "ja-JP"])).toBe("ja");
  });

  it("uses navigator.language when the preferred list is empty and defaults to English", () => {
    expect(detectLang([], "ja-JP")).toBe("ja");
    expect(detectLang([], "fr-FR")).toBe("en");
    expect(detectLang([])).toBe("en");
  });
});
