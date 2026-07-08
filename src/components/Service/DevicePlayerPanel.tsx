import { useDeviceStore } from "../../stores/useDeviceStore";
import { deviceControls } from "../../utils/deviceControls";
import { useI18nStore } from "../../stores/useI18nStore";
import { TrackInfoHeader } from "../AudioPlayer/TrackInfoHeader";
import { SeekBar } from "../AudioPlayer/SeekBar";
import { CtrlBtn } from "../AudioPlayer/CtrlBtn";
import { PlayIcon, PauseIcon, SkipBackIcon, SkipFwdIcon } from "../AudioPlayer/icons";

// Device 패널의 컴팩트 컨트롤(원형 accent 없이 h-8 사각 버튼)로 고정한 CtrlBtn.
function DeviceCtrlBtn(props: Omit<React.ComponentProps<typeof CtrlBtn>, "accentClass" | "baseClass">) {
  return (
    <CtrlBtn
      {...props}
      accentClass="h-8 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
      baseClass="h-8 px-2.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
    />
  );
}

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
        <DeviceCtrlBtn onClick={() => deviceControls.skip(-5)} title={t.tooltipSkipBack5}>
          <SkipBackIcon size={12} /><span className="text-[10px] font-bold ml-0.5">5</span>
        </DeviceCtrlBtn>
        <DeviceCtrlBtn onClick={() => deviceControls.skip(-1)} title={t.tooltipSkipBack1}>
          <SkipBackIcon size={12} /><span className="text-[10px] font-bold ml-0.5">1</span>
        </DeviceCtrlBtn>
        <DeviceCtrlBtn onClick={deviceControls.togglePlay} title={t.tooltipPlayPause} accent>
          {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </DeviceCtrlBtn>
        <DeviceCtrlBtn onClick={() => deviceControls.skip(1)} title={t.tooltipSkipFwd1}>
          <span className="text-[10px] font-bold mr-0.5">1</span><SkipFwdIcon size={12} />
        </DeviceCtrlBtn>
        <DeviceCtrlBtn onClick={() => deviceControls.skip(5)} title={t.tooltipSkipFwd5}>
          <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon size={12} />
        </DeviceCtrlBtn>
      </div>
    </div>
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
