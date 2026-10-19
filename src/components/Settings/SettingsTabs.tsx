import type { ReactNode } from "react";

export function SettingsTabBar({ children }: { children: ReactNode }) {
  return <div className="ls-settings-tabs flex min-w-0 overflow-x-auto overflow-y-hidden border-b border-[var(--ls-border-subtle)] shrink-0">{children}</div>;
}

export function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`ls-button ${[
        "shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px focus-visible:outline-offset-[-2px]",
        active
          ? "text-[var(--ls-accent)] border-[var(--ls-accent)]"
          : "text-[var(--ls-text-secondary)] border-transparent hover:text-[var(--ls-text)]",
      ].join(" ")}`}
    >
      {children}
    </button>
  );
}
