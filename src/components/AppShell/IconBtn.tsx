export function IconBtn({
  children, onClick, disabled, accent, title, tooltipAlign = "center",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title: string;
  tooltipAlign?: "center" | "right";
}) {
  const tooltipPos = tooltipAlign === "right"
    ? "right-0"
    : "left-1/2 -translate-x-1/2";
  return (
    <div className="relative group/ibtn">
      <button
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
        className={`ls-button ls-button--icon ${`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          accent
            ? "ls-button--secondary"
            : "text-[var(--ls-text-secondary)] hover:bg-[var(--ls-control)] hover:text-white"
        }`}`}
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
