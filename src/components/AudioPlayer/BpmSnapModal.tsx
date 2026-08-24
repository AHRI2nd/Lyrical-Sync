import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { decodeAudioSamples } from "../../utils/decodeAudioSamples";
import { detectBpm } from "../../utils/bpmDetect";

export function BpmSnapModal({ onClose, selectedIds }: { onClose: () => void; selectedIds: string[] }) {
  const { t } = useI18nStore();
  const audioPath = useLrcStore((s) => s.audioPath);
  const snapLinesToBeatGrid = useLrcStore((s) => s.snapLinesToBeatGrid);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bpmStr, setBpmStr] = useState("");
  const [offsetStr, setOffsetStr] = useState("0.00");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [snappedCount, setSnappedCount] = useState<number | null>(null);

  const tapTimesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!audioPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    decodeAudioSamples(audioPath)
      .then(({ samples, sampleRate }) => {
        if (cancelled) return;
        const result = detectBpm(samples, sampleRate);
        if (result) {
          setBpmStr(String(result.bpm));
          setOffsetStr(result.offsetSec.toFixed(2));
          setConfidence(result.confidence);
        } else {
          setError(t.bpmDetectFailed);
        }
      })
      .catch(() => { if (!cancelled) setError(t.bpmDecodeError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPath]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const bpm = Number(bpmStr) || 0;
  const offsetSec = Number(offsetStr) || 0;
  const valid = bpm > 0;

  const handleTapTempo = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    // 마지막 탭에서 2초 넘게 지나면 새 시퀀스로 리셋
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    setSnappedCount(null);
    if (taps.length < 2) return;
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    setBpmStr((60000 / avgMs).toFixed(1));
    setConfidence(null); // 탭 템포로 직접 보정 → 자동 감지 신뢰도 표시는 더 이상 유효하지 않음
  };

  const handleApply = () => {
    if (!valid) return;
    snapLinesToBeatGrid(selectedIds, bpm, offsetSec);
    setSnappedCount(selectedIds.length > 0 ? selectedIds.length : -1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100 text-sm">{t.bpmTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {!audioPath ? (
            <p className="text-sm text-amber-400">{t.autoSpotNeedsAudio}</p>
          ) : loading ? (
            <p className="text-sm text-zinc-400">{t.bpmDetecting}</p>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-zinc-500">{t.bpmHint}</p>
              {error && <p className="text-xs text-amber-400">{error}</p>}

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-300">{t.bpmLabel}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bpmStr}
                    onChange={(e) => { setBpmStr(e.target.value); setSnappedCount(null); }}
                    className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs text-right focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <span className="text-[11px] text-zinc-500 w-9">BPM</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-300">{t.bpmOffset}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={offsetStr}
                    onChange={(e) => { setOffsetStr(e.target.value); setSnappedCount(null); }}
                    className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs text-right focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <span className="text-[11px] text-zinc-500 w-9">s</span>
                </div>
              </div>

              <button
                onClick={handleTapTempo}
                className="w-full py-2.5 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition-colors"
              >
                {t.bpmTapTempo}
              </button>

              <div className="border-t border-zinc-800 pt-3 flex items-center justify-between text-xs">
                <span className="text-zinc-500">
                  {selectedIds.length > 0
                    ? `${t.bpmScopeSelected} (${selectedIds.length})`
                    : t.bpmScopeAll}
                </span>
                {confidence !== null && (
                  <span className="text-zinc-500">{t.bpmConfidence}: {Math.round(confidence * 100)}%</span>
                )}
              </div>
              {snappedCount !== null && (
                <p className="text-xs text-emerald-400">
                  {snappedCount === -1 ? t.bpmAppliedAll : `${snappedCount} ${t.bpmAppliedCount}`}
                </p>
              )}
            </>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              {t.autoSpotCancel}
            </button>
            {audioPath && !loading && (
              <button
                onClick={handleApply}
                disabled={!valid}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {t.autoSpotApply}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
