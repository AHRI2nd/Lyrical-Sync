export function IconBtn({
  children, onClick, disabled, accent, title, tooltipAlign = "center", focusPeer,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title: string;
  tooltipAlign?: "center" | "right";
  focusPeer?: string;
}) {
  const tooltipPos = tooltipAlign === "right"
    ? "right-0"
    : "left-1/2 -translate-x-1/2";
  return (
    <div className="relative group/ibtn">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        data-modal-focus-peer={focusPeer}
        className={`ls-button ls-button--icon ${accent ? "ls-button--secondary" : "ls-button--ghost"}`}
      >
        {children}
      </button>
      <div className={`pointer-events-none absolute top-full ${tooltipPos} mt-1.5 hidden group-hover/ibtn:block group-focus-within/ibtn:block z-30`}>
        <div className="bg-[var(--ls-control)] border border-[var(--ls-border-control)] text-[var(--ls-text)] text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
          {title}
        </div>
      </div>
    </div>
  );
}
