import { useState } from "react";
import { usePointerScrub } from "../../hooks/usePointerScrub";
import { useI18nStore } from "../../stores/useI18nStore";
import { formatDisplayTime } from "../../utils/lrcParser";

// 파형 대신 표시하는 "재생바" 뷰(viewMode="bar")에서 쓰는 얇은 탐색 바.
interface SeekBarProps {
  position: number; // seconds
  duration: number; // seconds
  seekContextKey?: string;
  onSeek: (seconds: number) => void;
  accentClass: string; // 진행 바 채우기 색상, 예: "bg-indigo-500"
}

export function SeekBar({ position, duration, seekContextKey = "", onSeek, accentClass }: SeekBarProps) {
  const { t } = useI18nStore();
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const scrub = usePointerScrub({ contextKey: JSON.stringify([seekContextKey, duration]), start: 0, end: duration, onCommit: onSeek });
  const displayPosition = scrub.preview ?? position;
  const progress = duration > 0 ? Math.max(0, Math.min(1, displayPosition / duration)) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="slider" tabIndex={0} aria-label={t.tooltipViewSeekBar}
        aria-valuemin={0} aria-valuemax={duration} aria-valuenow={displayPosition}
        style={{ touchAction: "none" }}
        onPointerDown={scrub.begin}
        onKeyDown={(e) => {
          const target = e.key === "Home" ? 0 : e.key === "End" ? duration :
            e.key === "ArrowLeft" ? position - 1 : e.key === "ArrowRight" ? position + 1 : null;
          if (target === null || duration <= 0) return;
          e.preventDefault(); scrub.cancel(); onSeek(Math.max(0, Math.min(duration, target)));
        }}
        className="relative h-1.5 bg-zinc-800 rounded-full cursor-pointer group"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          setHoverRatio(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
        }}
        onMouseLeave={() => setHoverRatio(null)}
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${accentClass}`} style={{ width: `${progress * 100}%` }} />
        {hoverRatio !== null && duration > 0 && (
          <div
            className="absolute -top-6 -translate-x-1/2 text-[10px] text-zinc-300 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 pointer-events-none whitespace-nowrap"
            style={{ left: `${hoverRatio * 100}%` }}
          >
            {formatDisplayTime(hoverRatio * duration)}
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500 tabular-nums px-0.5">
        <span>{formatDisplayTime(displayPosition)}</span>
        <button
          onClick={() => setShowRemaining((p) => !p)}
          className="hover:text-zinc-300 transition-colors"
        >
          {duration > 0
            ? showRemaining
              ? `−${formatDisplayTime(Math.max(0, duration - displayPosition))}`
              : formatDisplayTime(duration)
            : "—"}
        </button>
      </div>
    </div>
  );
}
