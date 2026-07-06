import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { formatDisplayTime } from "../../utils/lrcParser";

// currentTime만 구독하는 푸터 → 재생 중 이 작은 컴포넌트만 리렌더(줄 목록 영향 없음)
export function CurrentTimeFooter() {
  const currentTime = useLrcStore((s) => s.currentTime);
  const { t } = useI18nStore();
  return (
    <div className="text-xs text-zinc-500 text-right font-mono">
      {t.currentTimeLabel}{formatDisplayTime(currentTime)}
    </div>
  );
}
