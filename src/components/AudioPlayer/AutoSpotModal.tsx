import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { decodeAudioSamples } from "../../utils/decodeAudioSamples";
import { detectSpeechSegments, parseThresholdDb } from "../../utils/autoSpot";
import { useModalFocus } from "../../hooks/useModalFocus";

export function AutoSpotModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const fieldIdPrefix = useId();
  const audioPath = useLrcStore((s) => s.audioPath);
  const audioBookmark = useLrcStore((s) => s.audioBookmark);
  const addLinesFromSpeechSegments = useLrcStore((s) => s.addLinesFromSpeechSegments);

  const documentSession = useLrcStore((s) => s._documentSession);
  const audioSelection = useLrcStore((s) => s._audioSelection);
  const activeControllerRef = useRef<AbortController | null>(null);
  const completedOwnerRef = useRef<{ session: number; selection: number } | null>(null);
  const [samples, setSamples] = useState<Float32Array | null>(null);
  const [sampleRate, setSampleRate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [thresholdDb, setThresholdDb] = useState("-35");
  const [minSilenceMs, setMinSilenceMs] = useState("300");
  const [minSpeechMs, setMinSpeechMs] = useState("300");
  const [paddingMs, setPaddingMs] = useState("100");
  const [addedCount, setAddedCount] = useState<number | null>(null);

  const close = useCallback(() => {
    activeControllerRef.current?.abort();
    onClose();
  }, [onClose]);
  useModalFocus(dialog, close, true, 60);

  useEffect(() => {
    if (!audioPath) return;
    const completedOwner = completedOwnerRef.current;
    if (completedOwner?.session === documentSession && completedOwner.selection === audioSelection) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setLoading(true);
    setError(null);
    decodeAudioSamples(audioPath, audioBookmark, controller.signal)
      .then(({ samples: s, sampleRate: sr, file }) => {
        if (cancelled || useLrcStore.getState()._documentSession !== documentSession || useLrcStore.getState()._audioSelection !== audioSelection) return;
        completedOwnerRef.current = { session: documentSession, selection: audioSelection };
        useLrcStore.getState().refreshFileReference("audio", { path: audioPath, bookmark: audioBookmark }, file, { session: documentSession, selection: audioSelection });
        setSamples(s);
        setSampleRate(sr);
      })
      .catch((failure: unknown) => {
        if (!cancelled && !(failure instanceof Error && failure.name === "AbortError")) setError(t.autoSpotDecodeError);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      controller.abort();
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPath, audioBookmark, documentSession, audioSelection]);

  const preview = useMemo(() => {
    if (!samples) return [];
    return detectSpeechSegments(
      samples,
      sampleRate,
      parseThresholdDb(thresholdDb),
      Math.max(0, Number(minSilenceMs) || 0) / 1000,
      Math.max(0, Number(minSpeechMs) || 0) / 1000,
      Math.max(0, Number(paddingMs) || 0) / 1000
    );
  }, [samples, sampleRate, thresholdDb, minSilenceMs, minSpeechMs, paddingMs]);

  const handleApply = () => {
    if (preview.length === 0) return;
    setAddedCount(addLinesFromSpeechSegments(preview));
  };

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, suffix: string) => (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-xs text-[var(--ls-text-secondary)]">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setAddedCount(null);
            onChange(e.target.value);
          }}
          className="ls-field w-16 text-white text-xs text-right transition-colors"
        />
        <span className="text-[11px] text-[var(--ls-text-secondary)] w-6">{suffix}</span>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-sm mx-4 max-h-[calc(100%-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)]">
          <span id={titleId} className="font-semibold text-[var(--ls-text)] text-sm">{t.autoSpotTitle}</span>
          <button
            onClick={close}
            aria-label={t.close}
            className="ls-button hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {!audioPath ? (
            <p className="text-sm text-[var(--ls-playhead)]">{t.autoSpotNeedsAudio}</p>
          ) : loading ? (
            <p className="text-sm text-[var(--ls-text-secondary)]">{t.autoSpotDecoding}</p>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-[var(--ls-text-secondary)]">{t.autoSpotHint}</p>

              {field(`${fieldIdPrefix}-threshold`, t.autoSpotThreshold, thresholdDb, setThresholdDb, "dB")}
              {field(`${fieldIdPrefix}-min-silence`, t.autoSpotMinSilence, minSilenceMs, setMinSilenceMs, "ms")}
              {field(`${fieldIdPrefix}-min-speech`, t.autoSpotMinSpeech, minSpeechMs, setMinSpeechMs, "ms")}
              {field(`${fieldIdPrefix}-padding`, t.autoSpotPadding, paddingMs, setPaddingMs, "ms")}

              <div className="border-t border-[var(--ls-border-subtle)] pt-3 flex items-center justify-between text-xs">
                <span className={preview.length > 0 ? "text-[var(--ls-accent)]" : "text-[var(--ls-text-secondary)]"}>
                  {preview.length} {t.autoSpotSegmentsFound}
                </span>
                {addedCount !== null && (
                  <span className="text-emerald-400">{addedCount} {t.autoSpotAddedLabel}</span>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="ls-button text-sm transition-colors"
            >
              {t.autoSpotCancel}
            </button>
            {audioPath && !loading && !error && (
              <button
                onClick={handleApply}
                disabled={preview.length === 0}
                className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ls-button--primary"
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
