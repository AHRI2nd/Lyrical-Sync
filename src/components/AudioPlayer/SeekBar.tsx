import { useEffect, useRef, useState } from "react";
import { formatDisplayTime } from "../../utils/lrcParser";

// 파일/Spotify/YouTube/기기 감지 모드가 공유하는 얇은 탐색 바(기기 감지 모드 스타일을 그대로 일반화).
interface SeekBarProps {
  position: number; // seconds
  duration: number; // seconds
  seekContextKey?: string;
  onSeek: (seconds: number) => void;
  accentClass: string; // 진행 바 채우기 색상, 예: "bg-indigo-500"
}

export function SeekBar({ position, duration, seekContextKey = "", onSeek, accentClass }: SeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<{ id: number; duration: number } | null>(null);
  const onSeekRef = useRef(onSeek);
  const observedPositionRef = useRef(position);
  const observedDurationRef = useRef(duration);
  const observedContextKeyRef = useRef(seekContextKey);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [pendingPosition, setPendingPosition] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  onSeekRef.current = onSeek;

  const getPosition = (clientX: number, scrubDuration: number) => {
    const track = trackRef.current;
    if (!track || scrubDuration <= 0) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * scrubDuration;
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const pointer = activePointerRef.current;
      if (!pointer || e.pointerId !== pointer.id) return;
      const time = getPosition(e.clientX, pointer.duration);
      if (time !== null) setScrubPosition(time);
    };

    const onPointerUp = (e: PointerEvent) => {
      const pointer = activePointerRef.current;
      if (!pointer || e.pointerId !== pointer.id) return;
      const time = getPosition(e.clientX, pointer.duration);
      activePointerRef.current = null;
      setScrubPosition(null);
      if (time === null) return;

      setPendingPosition(time);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      // Keep the thumb at the committed target until the controlled playback position
      // catches up. Clear it if a remote/device seek does not publish a position update.
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        setPendingPosition(null);
      }, 750);
      onSeekRef.current(time);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (activePointerRef.current?.id !== e.pointerId) return;
      activePointerRef.current = null;
      setScrubPosition(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      activePointerRef.current = null;
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (observedPositionRef.current !== position) {
      observedPositionRef.current = position;
      if (pendingPosition !== null) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
        setPendingPosition(null);
      }
    }
  }, [position, pendingPosition]);

  useEffect(() => {
    if (observedDurationRef.current === duration) return;
    observedDurationRef.current = duration;
    activePointerRef.current = null;
    setScrubPosition(null);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    setPendingPosition(null);
  }, [duration]);

  useEffect(() => {
    if (observedContextKeyRef.current === seekContextKey) return;
    observedContextKeyRef.current = seekContextKey;
    activePointerRef.current = null;
    setScrubPosition(null);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    setPendingPosition(null);
  }, [seekContextKey]);

  const beginScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration <= 0 || activePointerRef.current) return;
    const time = getPosition(e.clientX, duration);
    if (time === null) return;
    e.preventDefault();
    activePointerRef.current = { id: e.pointerId, duration };
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    setPendingPosition(null);
    setScrubPosition(time);
  };

  const displayPosition = scrubPosition ?? pendingPosition ?? position;
  const progress = duration > 0 ? displayPosition / duration : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={trackRef}
        className="relative h-1.5 bg-zinc-800 rounded-full cursor-pointer group"
        onPointerDown={beginScrub}
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
