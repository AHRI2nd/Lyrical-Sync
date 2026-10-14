import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { decodeAudioSamples } from "../../utils/decodeAudioSamples";
import { detectBpm } from "../../utils/bpmDetect";

export function BpmSnapModal({ onClose, selectedIds }: { onClose: () => void; selectedIds: string[] }) {
  const { t } = useI18nStore();
  const audioPath = useLrcStore((s) => s.audioPath);
  const audioBookmark = useLrcStore((s) => s.audioBookmark);
  const session = useLrcStore((s) => s._documentSession);
  const selection = useLrcStore((s) => s._audioSelection);
  const [loading, setLoading] = useState(Boolean(audioPath));
  const [error, setError] = useState<string | null>(null);
  const [bpmStr, setBpmStr] = useState("");
  const [offsetStr, setOffsetStr] = useState("0.00");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [snappedCount, setSnappedCount] = useState<number | null>(null);
  const tapTimesRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const dismissedRef = useRef(false);
  const ownerRef = useRef({ session, selection, path: audioPath, bookmark: audioBookmark });

  const isCurrent = () => {
    const state = useLrcStore.getState();
    const owner = ownerRef.current;
    return !dismissedRef.current && owner.session === state._documentSession &&
      owner.selection === state._audioSelection && owner.path === state.audioPath &&
      owner.bookmark === state.audioBookmark;
  };
  const close = () => {
    dismissedRef.current = true;
    abortRef.current?.abort();
    onClose();
  };

  useEffect(() => {
    const state = useLrcStore.getState();
    const owner = { session, selection, path: state.audioPath, bookmark: state.audioBookmark };
    ownerRef.current = owner;
    const controller = new AbortController();
    abortRef.current = controller;
    setBpmStr("");
    setOffsetStr("0.00");
    setConfidence(null);
    setSnappedCount(null);
    setError(null);
    tapTimesRef.current = [];
    setLoading(Boolean(owner.path));
    if (owner.path) {
      decodeAudioSamples(owner.path, owner.bookmark, controller.signal)
        .then(({ samples, sampleRate, file }) => {
          if (controller.signal.aborted || !isCurrent()) return;
          const result = detectBpm(samples, sampleRate);
          if (controller.signal.aborted || !isCurrent()) return;
          useLrcStore.getState().refreshFileReference("audio", {
            path: owner.path!, bookmark: owner.bookmark,
          }, file, { session, selection });
          // A bookmark refresh belongs to this analysis, not a new selection.
          owner.path = file.path;
          owner.bookmark = file.bookmark;
          if (!isCurrent()) return;
          if (result) {
            setBpmStr(String(result.bpm));
            setOffsetStr(result.offsetSec.toFixed(2));
            setConfidence(result.confidence);
          } else setError(t.bpmDetectFailed);
        })
        .catch(() => {
          if (!controller.signal.aborted && isCurrent()) setError(t.bpmDecodeError);
        })
        .finally(() => {
          if (!controller.signal.aborted && isCurrent()) setLoading(false);
        });
    }
    return () => controller.abort();
    // Audio selection/session generations change even for same-path replacements.
    // FileRef refreshes retain those generations and must preserve the estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selection]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const bpm = Number(bpmStr);
  const offsetSec = Number(offsetStr);
  const sourceCurrent = !dismissedRef.current && ownerRef.current.session === session &&
    ownerRef.current.selection === selection && ownerRef.current.path === audioPath &&
    ownerRef.current.bookmark === audioBookmark;
  const valid = sourceCurrent && bpmStr.trim() !== "" && offsetStr.trim() !== "" &&
    Number.isFinite(bpm) && bpm > 0 && Number.isFinite(60 / bpm) &&
    60 / bpm > 0 && Number.isFinite(offsetSec);

  const handleTapTempo = () => {
    if (!isCurrent()) return;
    const now = performance.now();
    const taps = tapTimesRef.current;
    // Reset after a long pause; duplicate or reversed clocks cannot form intervals.
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0;
    if (!Number.isFinite(now) || (taps.length > 0 && now <= taps[taps.length - 1])) return;
    taps.push(now);
    if (taps.length > 16) taps.shift();
    setSnappedCount(null);
    if (taps.length < 2) return;
    const avgMs = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    const tempo = 60000 / avgMs;
    if (Number.isFinite(tempo) && tempo > 0) setBpmStr(tempo.toFixed(1));
    setConfidence(null);
  };

  const handleApply = () => {
    if (!valid || !isCurrent()) return;
    useLrcStore.getState().snapLinesToBeatGrid(selectedIds, bpm, offsetSec);
    setSnappedCount(selectedIds.length > 0 ? selectedIds.length : -1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100 text-sm">{t.bpmTitle}</span>
          <button
            onClick={close}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {loading || !sourceCurrent ? (
            <p className="text-sm text-zinc-400">{t.bpmDetecting}</p>
          ) : (
            <>
              {!audioPath && <p className="text-sm text-amber-400">{t.bpmManualHint}</p>}
              <p className="text-[11px] leading-relaxed text-zinc-500">{t.bpmHint}</p>
              {error && <p className="text-xs text-amber-400">{error}</p>}

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-300">{t.bpmLabel}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    aria-label={t.bpmLabel}
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
                    aria-label={t.bpmOffset}
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
              onClick={close}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              {t.cancelLabel}
            </button>
            {sourceCurrent && !loading && (
              <button
                onClick={handleApply}
                disabled={!valid}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {t.applyLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
