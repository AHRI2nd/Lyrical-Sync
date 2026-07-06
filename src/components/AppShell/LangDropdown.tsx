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
        className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
      >
        <GlobeIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden py-1 min-w-[110px]">
          {LANG_LABELS.map(({ lang: l, label }) => (
            <button
              key={l}
              onClick={() => handleSelect(l)}
              className={[
                "w-full flex items-center justify-between px-3 py-2 text-xs transition-colors",
                lang === l
                  ? "text-white bg-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-700 hover:text-white",
              ].join(" ")}
            >
              <span>{label}</span>
              {lang === l && <span className="text-indigo-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
