import { forwardRef } from "react";

// 재생 컨트롤 버튼 — AudioPlayer(파일)/ServicePlayerPanel(Spotify)/DevicePlayerPanel(기기 감지)
// 세 곳에서 색상·크기만 다르게 재사용. 색상/크기는 각 호출부가 정확한 기존 클래스를 넘긴다.
export const CtrlBtn = forwardRef<HTMLButtonElement, {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
  accentClass?: string;
  activeClass?: string;
  baseClass?: string;
}>(function CtrlBtn({
  onClick, title, children, active, accent, disabled, ariaExpanded, ariaControls,
  accentClass = "ls-button--play",
  activeClass = "ls-button--selected h-9 px-2",
  baseClass = "h-9 px-2",
}, ref) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      className={`ls-button ${[
        "flex items-center justify-center text-sm transition-colors",
        "disabled:cursor-not-allowed",
        accent ? accentClass : active ? activeClass : baseClass,
      ].join(" ")}`}
    >
      {children}
    </button>
  );
});
