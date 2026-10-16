import { useCallback, useEffect, useRef, useState } from "react";
import { useI18nStore } from "../../stores/useI18nStore";
import { type Lang } from "../../i18n/translations";
import { GlobeIcon } from "./icons";

const LANG_LABELS: { lang: Lang; label: string }[] = [
  { lang: "ko", label: "한국어" },
  { lang: "en", label: "English" },
  { lang: "ja", label: "日本語" },
];

export function LangDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { lang, setLang } = useI18nStore();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback((l: Lang) => { setLang(l); setOpen(false); }, [setLang]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="ls-button w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--ls-control)] hover:bg-[var(--ls-control)] text-[var(--ls-text)] transition-colors"
      >
        <GlobeIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-lg shadow-xl z-50 overflow-hidden py-1 min-w-[110px]">
          {LANG_LABELS.map(({ lang: l, label }) => (
            <button
              key={l}
              onClick={() => handleSelect(l)}
              className={`ls-button ${[
                "w-full flex items-center justify-between px-3 py-2 text-xs transition-colors",
                lang === l
                  ? "text-white bg-[var(--ls-control)]"
                  : "text-[var(--ls-text-secondary)] hover:bg-[var(--ls-control)] hover:text-white",
              ].join(" ")}`}
            >
              <span>{label}</span>
              {lang === l && <span className="text-[var(--ls-accent)]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
