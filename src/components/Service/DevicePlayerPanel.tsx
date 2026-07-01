import { useDeviceStore } from "../../stores/useDeviceStore";
import { deviceControls } from "../../utils/deviceControls";
import { useI18nStore } from "../../stores/useI18nStore";
import { TrackInfoHeader } from "../AudioPlayer/TrackInfoHeader";
import { SeekBar } from "../AudioPlayer/SeekBar";

// Windows SMTC로 감지한 로컬 재생 정보 패널. Spotify 원격 제어와 달리 임의의 다른 앱
// 세션을 다루므로(Spotify 데스크톱, Apple Music, 브라우저 등) 소스 앱을 표시하고,
// 일부 세션은 seek를 지원하지 않을 수 있음을 감안해 조작은 낙관적으로만 반영한다.
export function DevicePlayerPanel() {
  const { t } = useI18nStore();
  const { isPlaying, positionMs, durationMs, trackName, artistName, albumName, sourceApp, hasSession } = useDeviceStore();

  const positionSec = positionMs / 1000;
  const durationSec = durationMs / 1000;

  return (
    <div className="flex flex-col gap-3 min-h-[80px] justify-center">
      <TrackInfoHeader
        icon={<DeviceGlyph />}
        iconBgClass="bg-indigo-500/15 text-indigo-300"
        title={hasSession ? trackName : ""}
        subtitle={artistName + (albumName ? ` · ${albumName}` : "")}
        extraLine={sourceApp ? `${t.deviceSourceApp}: ${sourceApp}` : undefined}
        emptyMessage={t.deviceWaiting}
      />

      <SeekBar
        position={positionSec}
        duration={durationSec}
        onSeek={(s) => deviceControls.seekTo(s)}
        accentClass="bg-indigo-500"
      />

      {/* 컨트롤 */}
      <div className="flex items-center justify-center gap-0.5">
        <CtrlBtn onClick={() => deviceControls.skip(-5)} title={t.tooltipSkipBack5}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
        </CtrlBtn>
        <CtrlBtn onClick={() => deviceControls.skip(-1)} title={t.tooltipSkipBack1}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
        </CtrlBtn>
        <CtrlBtn onClick={deviceControls.togglePlay} title={t.tooltipPlayPause} accent>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </CtrlBtn>
        <CtrlBtn onClick={() => deviceControls.skip(1)} title={t.tooltipSkipFwd1}>
          <span className="text-[10px] font-bold mr-0.5">1</span><SkipFwdIcon />
        </CtrlBtn>
        <CtrlBtn onClick={() => deviceControls.skip(5)} title={t.tooltipSkipFwd5}>
          <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
        </CtrlBtn>
      </div>
    </div>
  );
}

function CtrlBtn({
  onClick, title, accent, children,
}: {
  onClick: () => void;
  title: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center h-8 px-2.5 rounded-lg transition-colors ${
        accent ? "bg-indigo-600 hover:bg-indigo-500 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function DeviceGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function PlayIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>;
}
function SkipBackIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11 6 L11 18 L4 12 Z M18 6 L18 18 L11 12 Z" /></svg>;
}
function SkipFwdIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6 L6 18 L13 12 Z M13 6 L13 18 L20 12 Z" /></svg>;
}
