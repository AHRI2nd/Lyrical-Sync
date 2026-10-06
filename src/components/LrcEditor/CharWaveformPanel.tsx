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
  const markerGroups = useMemo(() => {
    const visible = syllables.map((syllable, index) => ({ syllable, index }))
      .filter(item => item.syllable.time !== null && isStampable(item.syllable) && item.syllable.time >= start && item.syllable.time <= end)
      .sort((a, b) => a.syllable.time! - b.syllable.time!);
    const groups: typeof visible[] = [];
    for (const item of visible) {
      const group = groups[groups.length - 1];
      if (group && (item.syllable.time! - group[group.length - 1].syllable.time!) / Math.max(.001, end - start) * width < 12) group.push(item);
      else groups.push([item]);
    }
    return groups;
  }, [syllables, start, end, width]);
  const selected = syllables[activeIndex];
  const selectedVisible = selected && selected.time !== null && isStampable(selected) && selected.time >= start && selected.time <= end;
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
        {markerGroups.flatMap(group => group.map(({ syllable: s, index }) => <div key={index}
          style={{ left: `${pct(s.time!)}%` }} className={`absolute inset-y-0 w-px pointer-events-none ${index === activeIndex ? 'bg-indigo-300 z-10' : 'bg-indigo-500/50'}`} />))}
        {markerGroups.map(group => {
          const first = group[0].syllable.time!;
          const last = group[group.length - 1].syllable.time!;
          const position = group.findIndex(item => item.index === activeIndex);
          const label = group.map(item => `${item.syllable.text.trim()} ${formatTimestamp(item.syllable.time!)}`).join(' / ');
          return <button key={group[0].index} type="button" aria-label={label} aria-pressed={position >= 0}
            onPointerDown={e => e.stopPropagation()} onClick={e => {
              e.stopPropagation(); onSelect(group[(position + 1) % group.length].index); e.currentTarget.blur();
            }} title={group.length > 1 ? `${label} · ${t.charSync.markerGroupHint}` : label}
            style={{ left: `${pct((first + last) / 2)}%`, width: Math.max(12, (last - first) / Math.max(.001, end - start) * width + 12), transform: 'translateX(-50%)' }}
            className="absolute inset-y-0 z-20 focus-visible:outline focus-visible:outline-indigo-300">
            {group.length > 1 && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] px-1 rounded bg-zinc-800 text-indigo-200">{group.length}</span>}
          </button>;
        })}
        {selectedVisible && <span data-testid="selected-waveform-glyph" style={{ left: `${Math.min(85, pct(selected.time!))}%` }}
          className="absolute top-1 z-30 px-1 rounded bg-zinc-900 text-indigo-200 text-xs max-w-[15%] truncate pointer-events-none">{selected.text.trim()}</span>}
        {playhead >= start && playhead <= end && <div data-testid="glyph-playhead"
          style={{ left: `${pct(playhead)}%`, transform: `translateX(-${pct(playhead)}%)` }}
          className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none" />}
      </div>
      {markerGroups.some(group => group.length > 1) && <p className="mt-1 text-[11px] text-zinc-400">{t.charSync.markerGroupHint}</p>}
      <div className="flex justify-between gap-1 pt-1 text-[11px] text-zinc-400 font-mono" aria-label={t.charSync.timeRuler}>
        {[0, .25, .5, .75, 1].map((fraction, i) => <span key={i} className={i % 2 ? 'hidden sm:inline' : ''}>{formatTimestamp(start + (end - start) * fraction)}</span>)}
      </div>
    </div>
  );
});
