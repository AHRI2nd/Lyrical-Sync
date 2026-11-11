import { create } from "zustand";
import { type Lang, translations, type Translations } from "../i18n/translations";

interface I18nState {
  lang: Lang;
  t: Translations;
}

// Prefer the first supported OS language; unsupported preferences fall through to English.
// There is no manual language selector in the App Store review build.
export function detectLang(languages?: readonly string[] | null, language?: string): Lang {
  const candidates = languages && languages.length > 0 ? languages : language ? [language] : [];
  for (const raw of candidates) {
    const primary = typeof raw === "string"
      ? /^([a-z]{2,3})(?:-[a-z0-9]{1,8})*$/i.exec(raw.trim())?.[1].toLowerCase()
      : undefined;
    if (primary === "ko") return "ko";
    if (primary === "ja") return "ja";
    if (primary === "en") return "en";
  }
  return "en";
}

const detected = detectLang(
  typeof navigator === "undefined" ? [] : navigator.languages,
  typeof navigator === "undefined" ? undefined : navigator.language,
);

export const useI18nStore = create<I18nState>()(() => ({
  lang: detected,
  t: translations[detected],
}));
