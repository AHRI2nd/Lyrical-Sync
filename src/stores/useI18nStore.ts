import { create } from "zustand";
import { type Lang, translations, type Translations } from "../i18n/translations";

interface I18nState {
  lang: Lang;
  t: Translations;
}

// 기기(OS) 언어를 기준으로 한국어/일본어만 매칭하고, 그 외는 전부 영어로 표시.
// 수동 전환 UI는 없음 — App Store 심사 대상 경량판은 시스템 언어를 그대로 따른다.
function detectLang(): Lang {
  const candidates =
    typeof navigator !== "undefined"
      ? navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language]
      : [];
  for (const raw of candidates) {
    const lower = raw?.toLowerCase() ?? "";
    if (lower.startsWith("ko")) return "ko";
    if (lower.startsWith("ja")) return "ja";
  }
  return "en";
}

const detected = detectLang();

export const useI18nStore = create<I18nState>()(() => ({
  lang: detected,
  t: translations[detected],
}));
