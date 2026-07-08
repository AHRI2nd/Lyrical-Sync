import { useEffect } from "react";
import { useI18nStore } from "../../stores/useI18nStore";

export function ValidationPanel({ stats, issues, onJump, onClose }: {
  stats: { total: number; stamped: number; pct: number };
  issues: { id: string; lineNo: number; text: string; type: "duplicate" | "outOfOrder" | "unstamped" }[];
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18nStore();
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const label = (ty: string) =>
    ty === "duplicate" ? t.warnDuplicate : ty === "outOfOrder" ? t.warnOutOfOrder : t.validationUnstamped;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <span className="font-semibold text-zinc-100">{t.validationTitle}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="grid grid-cols-3 gap-2 px-5 py-4 shrink-0">
          {[
            { v: `${stats.pct}%`, l: t.validationStatComplete, hl: stats.pct === 100 },
            { v: String(stats.stamped), l: t.validationStatStamped, hl: false },
            { v: String(stats.total), l: t.validationStatLines, hl: false },
          ].map((c, i) => (
            <div key={i} className="bg-zinc-800 rounded-lg p-2.5 flex flex-col">
              <span className={`text-xl font-semibold tabular-nums ${c.hl ? "text-emerald-400" : "text-zinc-100"}`}>{c.v}</span>
              <span className="text-[11px] text-zinc-500 mt-0.5">{c.l}</span>
            </div>
          ))}
        </div>

        <div className="overflow-y-auto px-3 pb-3 flex flex-col gap-0.5">
          {issues.length === 0 ? (
            <p className="text-center text-sm text-emerald-400 py-6">{t.validationNoIssues}</p>
          ) : (
            issues.map((iss) => (
              <button
                key={iss.id}
                onClick={() => onJump(iss.id)}
                className="flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <span className="text-zinc-600 text-xs w-7 shrink-0 text-right tabular-nums">{iss.lineNo}</span>
                <span className={`text-[11px] shrink-0 px-1.5 py-0.5 rounded ${iss.type === "unstamped" ? "bg-zinc-700/60 text-zinc-300" : "bg-amber-900/40 text-amber-300"}`}>{label(iss.type)}</span>
                <span className="text-sm text-zinc-300 truncate flex-1">{iss.text || <span className="text-zinc-600">—</span>}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
