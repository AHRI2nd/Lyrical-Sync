import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Lang, translations, type Translations } from "../i18n/translations";

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translations;
}

export function normalizeLang(value: unknown): Lang {
  return value === "en" || value === "ja" ? value : "ko";
}

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
      partialize: (state) => ({ lang: state.lang }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.lang = normalizeLang(state.lang);
          state.t = translations[state.lang];
        }
      },
    },
  ),
);
