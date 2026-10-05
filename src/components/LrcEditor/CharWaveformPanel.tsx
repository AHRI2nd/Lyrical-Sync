import { memo, useEffect, useMemo, useState, type PointerEventHandler, type RefObject } from 'react';
import { useWaveformStore } from '../../stores/useWaveformStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useI18nStore } from '../../stores/useI18nStore';
import { formatTimestamp, isStampable } from '../../utils/lrcParser';
import type { LrcSyllable } from '../../types/lrc';

interface Props {
  laneRef: RefObject<HTMLDivElement | null>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  audioPath: string | null;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  playhead: number;
  syllables: LrcSyllable[];
  activeIndex: number;
  onSelect: (index: number) => void;
  available: boolean;
}

export const CharWaveformPanel = memo(function CharWaveformPanel({
  laneRef, onPointerDown, audioPath, start, end, lineStart, lineEnd, playhead,
  syllables, activeIndex, onSelect, available,
}: Props) {
  const height = useSettingsStore(s => s.glyphWaveformHeight);
  const style = useSettingsStore(s => s.glyphWaveformStyle);
  const setHeight = useSettingsStore(s => s.setGlyphWaveformHeight);
  const setStyle = useSettingsStore(s => s.setGlyphWaveformStyle);
  const { t } = useI18nStore();
  const pct = (time: number) => Math.max(0, Math.min(100, (time - start) / Math.max(0.001, end - start) * 100));
  const source = useWaveformStore(s => s.source);
  const sourcePath = useWaveformStore(s => s.path);
  const preparing = useWaveformStore(s => s.preparing);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const update = () => { if (lane.clientWidth > 0) setWidth(lane.clientWidth); };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(lane);
    return () => observer.disconnect();
  }, [laneRef]);
  const envelope = useMemo(() => available && sourcePath === audioPath
    ? source?.getEnvelope(start, end, width) ?? null : null,
  [available, sourcePath, audioPath, source, start, end, width]);
  const path = useMemo(() => {
    if (!envelope) return '';
    const top = Array.from(envelope.max, (v, i) => `${i + .5},${50 - v * 36}`).join(' L ');
    const bottom = Array.from(envelope.min, (v, i) => `${i + .5},${50 - v * 36}`).reverse().join(' L ');
    return `M ${top} L ${bottom} Z`;
  }, [envelope]);
  return (
    <div className="shrink-0 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-zinc-400 mb-2">
        <label className="flex items-center gap-2">
          {t.charSync.waveformHeight}
          <input type="range" min={64} max={160} step={8} value={height} aria-label={t.charSync.waveformHeight}
            onChange={e => setHeight(Number(e.target.value))} className="w-24 accent-indigo-400" />
          <span className="font-mono w-10">{height}px</span>
        </label>
        <select value={style} aria-label={t.charSync.waveformStyle} onChange={e => setStyle(e.target.value as 'continuous' | 'bars')}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
          <option value="continuous">{t.charSync.waveformContinuous}</option>
          <option value="bars">{t.charSync.waveformBars}</option>
        </select>
      </div>
      <div ref={laneRef} onPointerDown={onPointerDown} data-testid="glyph-seek-lane" data-start={start} data-end={end}
        style={{ height }} className="relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden cursor-pointer touch-none">
        <div className="absolute inset-y-0 bg-indigo-400/5 pointer-events-none" style={{ left: `${pct(lineStart)}%`, width: `${Math.max(0, pct(lineEnd) - pct(lineStart))}%` }} />
        {envelope && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${envelope.min.length} 100`} preserveAspectRatio="none" aria-hidden>
            {style === 'continuous'
              ? <path d={path} fill="#a1a1aa" />
              : Array.from(envelope.min, (lo, i) => <rect key={i} x={i + .1} width={.8}
                  y={50 - envelope.max[i] * 36} height={Math.max(1, (envelope.max[i] - lo) * 36)} fill="#a1a1aa" />)}
          </svg>
        )}
        {!envelope && <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-zinc-400 pointer-events-none">
          {!available ? t.charSync.waveformUnavailable : preparing && sourcePath === audioPath ? t.charSync.waveformPreparing : t.charSync.waveformNoAudio}
        </div>}
        {syllables.map((s, i) => s.time !== null && isStampable(s) && s.time >= start && s.time <= end ? (
          <button key={i} type="button" aria-label={`${s.text.trim()} ${formatTimestamp(s.time)}`} aria-pressed={i === activeIndex}
            onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSelect(i); e.currentTarget.blur(); }}
            title={`${s.text.trim()} ${formatTimestamp(s.time)}`} style={{ left: `${pct(s.time)}%`, transform: 'translateX(-50%)' }}
            className="absolute inset-y-0 w-3 group focus-visible:outline focus-visible:outline-indigo-300">
            <span className={`absolute inset-y-0 left-1/2 w-px ${i === activeIndex ? 'bg-indigo-300' : 'bg-indigo-500/50 group-hover:bg-indigo-300'}`} />
          </button>
        ) : null)}
        {playhead >= start && playhead <= end && <div data-testid="glyph-playhead" style={{ left: `${pct(playhead)}%` }} className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none" />}
      </div>
      <div className="flex justify-between gap-1 pt-1 text-[11px] text-zinc-400 font-mono" aria-label={t.charSync.timeRuler}>
        {[0, .25, .5, .75, 1].map((fraction, i) => <span key={i} className={i % 2 ? 'hidden sm:inline' : ''}>{formatTimestamp(start + (end - start) * fraction)}</span>)}
      </div>
    </div>
  );
});
