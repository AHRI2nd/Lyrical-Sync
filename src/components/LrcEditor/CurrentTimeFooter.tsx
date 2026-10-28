import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { formatDisplayTime } from "../../utils/lrcParser";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useDeviceStore } from "../../stores/useDeviceStore";

// currentTime만 구독하는 푸터 → 재생 중 이 작은 컴포넌트만 리렌더(줄 목록 영향 없음)
export function CurrentTimeFooter() {
  const localTime = useLrcStore((s) => s.currentTime);
  const spotifyMode = useSettingsStore((s) => s.spotifyMode);
  const deviceMode = useSettingsStore((s) => s.deviceMode);
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  const serviceTime = useServiceStore((s) => s.positionMs / 1000);
  const deviceTime = useDeviceStore((s) => s.positionMs / 1000);
  const currentTime = serviceLoggedIn && spotifyMode ? serviceTime : deviceMode ? deviceTime : localTime;
  const { t } = useI18nStore();
  return (
    <div className="text-xs text-[var(--ls-text-secondary)] text-right font-mono">
      {t.currentTimeLabel}{formatDisplayTime(currentTime)}
    </div>
  );
}
