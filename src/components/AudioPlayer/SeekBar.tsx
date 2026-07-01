import { useCallback, useEffect, useRef, useState } from "react";
import { formatDisplayTime } from "../../utils/lrcParser";

// 파형 대신 표시하는 "재생바" 뷰(viewMode="bar")에서 쓰는 얇은 탐색 바.
interface SeekBarProps {
  position: number; // seconds
  duration: number; // seconds
  onSeek: (seconds: number) => void;
  accentClass: string; // 진행 바 채우기 색상, 예: "bg-indigo-500"
}

export function SeekBar({ position, duration, onSeek, accentClass }: SeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const progress = duration > 0 ? position / duration : 0;

  const seekToClientX = useCallback((clientX: number) => {
    if (!trackRef.current || duration <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  }, [duration, onSeek]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (isDragging.current) seekToClientX(e.clientX); };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [seekToClientX]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={trackRef}
        className="relative h-1.5 bg-zinc-800 rounded-full cursor-pointer group"
        onMouseDown={(e) => { e.preventDefault(); isDragging.current = true; seekToClientX(e.clientX); }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
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
        <span>{formatDisplayTime(position)}</span>
        <button
          onClick={() => setShowRemaining((p) => !p)}
          className="hover:text-zinc-300 transition-colors"
        >
          {duration > 0
            ? showRemaining
              ? `−${formatDisplayTime(Math.max(0, duration - position))}`
              : formatDisplayTime(duration)
            : "—"}
        </button>
      </div>
    </div>
  );
}
