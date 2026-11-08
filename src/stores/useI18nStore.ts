import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type Lang, translations, type Translations } from "../i18n/translations";

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translations;
}

export function normalizeLang(value: unknown): Lang {
  return value === "en" || value === "ja" ? value : "ko";
}

const safeLanguageStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name: string, value: string) => {
    try { localStorage.setItem(name, value); } catch { /* Keep the in-memory language usable. */ }
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name); } catch { /* Storage may be unavailable. */ }
  },
}));

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      lang: "ko",
      t: translations.ko,
      setLang: (lang) => {
        const supported = normalizeLang(lang);
        set({ lang: supported, t: translations[supported] });
      },
    }),
    {
      name: "lyrical-sync-lang",
      storage: safeLanguageStorage,
      partialize: (state) => ({ lang: state.lang }),
      merge: (persistedState, currentState) => {
        const persistedLang = persistedState && typeof persistedState === "object" && !Array.isArray(persistedState)
          ? (persistedState as { lang?: unknown }).lang
          : undefined;
        const lang = normalizeLang(persistedLang);
        return { ...currentState, lang, t: translations[lang] };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.lang = normalizeLang(state.lang);
          state.t = translations[state.lang];
        }
      },
    },
  ),
);
