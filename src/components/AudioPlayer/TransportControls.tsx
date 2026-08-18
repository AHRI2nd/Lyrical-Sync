import { useEffect, useRef, useState } from "react";
import { type Translations } from "../../i18n/translations";
import { CtrlBtn } from "./CtrlBtn";
import { MorePopover } from "./MorePopover";
import {
  PlayIcon, PauseIcon, StopIcon, SkipBackIcon, SkipFwdIcon, TriLeftIcon, TriRightIcon, MoreIcon,
} from "./icons";

// 재생 컨트롤 한 줄: 정지(좌) · 스킵/재생(중앙) · 더보기(우, 반복·마커·스펙트로그램·배속).
// "더보기" 팝오버 열림 상태와 바깥 클릭 감지는 이 컴포넌트가 자체 소유.
export function TransportControls({
  t, audioPath, isPlaying, togglePlay, skip, stopAndReset,
  isLooping, onToggleLoop, showMarkers, onToggleMarkers, showSpectrogram, onToggleSpectrogram,
  playbackRate, speedMin, speedMax, onSpeedDown, onSpeedUp,
}: {
  t: Translations;
  audioPath: string | null;
  isPlaying: boolean;
  togglePlay: () => void;
  skip: (delta: number) => void;
  stopAndReset: () => void;
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
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // 더보기 팝오버 바깥 클릭 시 닫기
  useEffect(() => {
    if (!showMore) return;
    const h = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showMore]);

  return (
    // relative를 행 전체에 두어 팝오버가 좁은 카드 폭(우측 정렬) 안에 들어오게 함
    <div className="relative flex items-center gap-0.5" ref={moreRef}>
      <CtrlBtn onClick={stopAndReset} title={t.tooltipStop}>
        <StopIcon />
      </CtrlBtn>

      <div className="flex-1 flex items-center justify-center gap-0.5">
        <CtrlBtn onClick={() => skip(-5)} title={t.tooltipSkipBack5}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(-1)} title={t.tooltipSkipBack1}>
          <TriLeftIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
        </CtrlBtn>
        <CtrlBtn onClick={togglePlay} disabled={!audioPath} title={t.tooltipPlayPause} accent>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(1)} title={t.tooltipSkipFwd1}>
          <span className="text-[10px] font-bold mr-0.5">1</span><TriRightIcon />
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(5)} title={t.tooltipSkipFwd5}>
          <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
        </CtrlBtn>
      </div>

      <CtrlBtn
        onClick={() => setShowMore((v) => !v)}
        title={t.playerMore}
        active={showMore || isLooping || playbackRate !== 1.0 || showSpectrogram}
      >
        <MoreIcon />
      </CtrlBtn>
      {showMore && (
        <MorePopover
          t={t}
          isLooping={isLooping} onToggleLoop={onToggleLoop}
          showMarkers={showMarkers} onToggleMarkers={onToggleMarkers}
          showSpectrogram={showSpectrogram} onToggleSpectrogram={onToggleSpectrogram}
          playbackRate={playbackRate} speedMin={speedMin} speedMax={speedMax}
          onSpeedDown={onSpeedDown} onSpeedUp={onSpeedUp}
        />
      )}
    </div>
  );
}
