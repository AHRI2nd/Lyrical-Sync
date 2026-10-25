import { type Translations } from "../../i18n/translations";
import { LoopIcon, MarkerIcon, SpectrogramIcon } from "./icons";

// 재생 컨트롤 "더보기" 팝오버 내용: 파일 전체 반복·가사 마커·스펙트로그램 토글 + 배속 조절.
export function MorePopover({
  t, isLooping, onToggleLoop, showMarkers, onToggleMarkers, showSpectrogram, onToggleSpectrogram,
  playbackRate, speedMin, speedMax, onSpeedDown, onSpeedUp,
}: {
  t: Translations;
  isLooping: boolean;
  onToggleLoop: () => void;
  showMarkers: boolean;
  onToggleMarkers: () => void;
  showSpectrogram: boolean;
  onToggleSpectrogram: () => void;
  playbackRate: number;
  speedMin: number;
  speedMax: number;
  onSpeedDown: () => void;
  onSpeedUp: () => void;
}) {
  return (
    <div className="absolute right-0 top-full mt-2 z-40 w-56 bg-[var(--ls-control)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ls-text-secondary)]">{t.tooltipLoop}</span>
        <button onClick={onToggleLoop} className={`ls-button ls-button--compact ls-button--icon-compact ${popToggleCls(isLooping)}`} title={t.tooltipLoop} aria-label={t.tooltipLoop} aria-pressed={isLooping}>
          <LoopIcon />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ls-text-secondary)]">{t.tooltipMarkers}</span>
        <button onClick={onToggleMarkers} className={`ls-button ls-button--compact ls-button--icon-compact ${popToggleCls(showMarkers)}`} title={t.tooltipMarkers} aria-label={t.tooltipMarkers} aria-pressed={showMarkers}>
          <MarkerIcon />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ls-text-secondary)]">{t.tooltipSpectrogram}</span>
        <button onClick={onToggleSpectrogram} className={`ls-button ls-button--compact ls-button--icon-compact ${popToggleCls(showSpectrogram)}`} title={t.tooltipSpectrogram} aria-label={t.tooltipSpectrogram} aria-pressed={showSpectrogram}>
          <SpectrogramIcon />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ls-text-secondary)]">{t.playerSpeed}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onSpeedDown}
            disabled={playbackRate <= speedMin}
            className="ls-button ls-button--compact ls-button--icon-compact w-6 h-6 flex items-center justify-center disabled:opacity-30 text-sm font-bold leading-none transition-colors"
          >−</button>
          <span className="w-12 text-center text-xs font-mono text-[var(--ls-text)] tabular-nums">{playbackRate.toFixed(2)}×</span>
          <button
            onClick={onSpeedUp}
            disabled={playbackRate >= speedMax}
            className="ls-button ls-button--compact ls-button--icon-compact w-6 h-6 flex items-center justify-center disabled:opacity-30 text-sm font-bold leading-none transition-colors"
          >+</button>
        </div>
      </div>
    </div>
  );
}

// 팝오버 내 토글 버튼 스타일
function popToggleCls(active: boolean): string {
  return [
    "w-6 h-6 flex items-center justify-center rounded-lg transition-colors",
    active ? "ls-button--selected" : "bg-[var(--ls-control)] text-[var(--ls-text)] hover:bg-[var(--ls-control)]",
  ].join(" ");
}
