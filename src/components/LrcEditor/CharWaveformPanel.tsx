import { memo, useEffect, useMemo, useState, type PointerEventHandler, type RefObject } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useWaveformStore } from "../../stores/useWaveformStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { getWaveformTiles, type WaveformEnvelope } from "../../utils/waveformEnvelope";
import { getTimeTicks, layoutGlyphMarkers } from "../../utils/waveformTimeline";
import { formatTimestamp, isStampable } from "../../utils/lrcParser";
import type { LrcSyllable } from "../../types/lrc";

interface Props {
  laneRef: RefObject<HTMLDivElement | null>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  audioPath: string | null;
  start: number; end: number; lineStart: number; lineEnd: number; playhead: number;
  syllables: LrcSyllable[]; activeIndex: number; onSelect: (index: number) => void;
  available: boolean;
  height?: number; style?: "continuous" | "bars"; showMarkers?: boolean; repeating?: boolean;
}

export const CharWaveformPanel = memo(function CharWaveformPanel({ laneRef, onPointerDown, audioPath,
  start, end, lineStart, lineEnd, playhead, syllables, activeIndex, onSelect,
  available, height: suppliedHeight, style: suppliedStyle, showMarkers = true, repeating = false,
}: Props) {
  const { t } = useI18nStore();
  const savedHeight = useSettingsStore(s => s.glyphWaveformHeight);
  const savedStyle = useSettingsStore(s => s.glyphWaveformStyle);
  const height = suppliedHeight ?? savedHeight;
  const style = suppliedStyle ?? savedStyle;
  const setHeight = useSettingsStore(s => s.setGlyphWaveformHeight);
  const setStyle = useSettingsStore(s => s.setGlyphWaveformStyle);
  const source = useWaveformStore(s => s.source);
  const path = useWaveformStore(s => s.path);
  const preparing = useWaveformStore(s => s.preparing);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const update = () => { if (lane.clientWidth > 0) setWidth(lane.clientWidth); };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update); observer.observe(lane);
    return () => observer.disconnect();
  }, [laneRef]);
  const tiles = useMemo(() => available && source && path === audioPath
    ? getWaveformTiles(source, start, end, width) : [], [available, source, path, audioPath, start, end, width]);
  const ticks = useMemo(() => getTimeTicks(start, end, width), [start, end, width]);
  const cell = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches ? 44 : 32;
  const groups = useMemo(() => layoutGlyphMarkers(syllables, start, end, width, cell), [syllables, start, end, width, cell]);
  const pct = (time: number) => Math.max(0, Math.min(100, (time - start) / Math.max(.001, end - start) * 100));
  const timed = syllables.map((s, index) => ({ s, index }))
    .filter(({ s }) => s.time !== null && Number.isFinite(s.time) && isStampable(s) && s.time >= start && s.time <= end);
  return <div className="shrink-0 min-w-0">
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
    <div className="shrink-0 min-w-0 overflow-hidden rounded-lg border border-zinc-700/70 bg-zinc-950">
    <div aria-label={t.charSync.timeRuler} className="relative h-8 border-b border-zinc-800 text-[11px] text-zinc-400 font-mono tabular-nums">
      {ticks.map(tick => <span key={tick.time} style={{ left: `${tick.percent}%`, transform: "translateX(-50%)" }}
        className="absolute top-1.5 whitespace-nowrap">{formatTimestamp(tick.time)}</span>)}
    </div>
    <div ref={laneRef} onPointerDown={onPointerDown} data-testid="glyph-seek-lane" data-start={start} data-end={end}
      style={{ height, touchAction: "none" }} className="relative overflow-hidden cursor-pointer">
      <div data-testid="glyph-line-region" data-repeating={repeating} className={`absolute inset-y-0 pointer-events-none ${repeating ? "bg-indigo-400/10" : "bg-indigo-400/5"}`}
        style={{ left: `${pct(lineStart)}%`, width: `${Math.max(0, pct(lineEnd) - pct(lineStart))}%` }} />
      {ticks.map(tick => <div key={tick.time} style={{ left: `${tick.percent}%` }} className="absolute inset-y-0 w-px bg-zinc-800/70 pointer-events-none" />)}
      {tiles.map(tile => <WaveformTile key={tile.start} envelope={tile} style={style}
        left={(tile.start - start) / (end - start) * 100} width={(tile.end - tile.start) / (end - start) * 100} />)}
      {!tiles.length && <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-zinc-400 pointer-events-none">
        {!available ? t.charSync.waveformUnavailable : preparing && path === audioPath ? t.charSync.waveformPreparing : t.charSync.waveformNoAudio}
      </div>}
      {showMarkers && timed.map(({ s, index }) => <div key={index} data-testid={index === activeIndex ? "glyph-selected-marker" : undefined}
        style={{ left: `${pct(s.time!)}%` }} className={`absolute inset-y-0 w-px pointer-events-none ${index === activeIndex ? "bg-indigo-300 z-10" : "bg-indigo-500/30"}`} />)}
      {playhead >= start && playhead <= end && <div data-testid="glyph-playhead"
        style={{ left: `${pct(playhead)}%`, transform: `translateX(-${pct(playhead)}%)` }}
        className="absolute inset-y-0 w-0.5 bg-amber-400 pointer-events-none z-10" />}
    </div>
    <div data-testid="glyph-marker-lane" aria-label={t.charSync.glyphMarkerLane} style={{ height: cell * 2 }}
      className="relative border-t border-zinc-800 bg-zinc-900/70">
      {showMarkers && groups.map(group => {
        const selected = group.indices.indexOf(activeIndex);
        const current = group.indices[selected >= 0 ? selected : 0];
        const label = group.indices.map(i => `${syllables[i].text.trim()} ${formatTimestamp(syllables[i].time!)}`).join(" / ");
        return <button key={group.indices[0]} type="button" aria-label={label} aria-pressed={selected >= 0} title={label}
          onPointerDown={e => e.stopPropagation()} onClick={e => { onSelect(group.indices[(selected + 1) % group.indices.length]); e.currentTarget.blur(); }}
          style={{ left: `${group.x / width * 100}%`, top: group.row * cell, width: cell, height: cell, transform: "translateX(-50%)" }}
          className={`absolute flex items-center justify-center rounded text-xs focus-visible:outline focus-visible:outline-indigo-300 ${selected >= 0 ? "bg-indigo-400/15 text-indigo-200" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}>
          <span data-testid={selected >= 0 ? "selected-waveform-glyph" : undefined} className="max-w-full truncate px-1">{syllables[current].text.trim()}</span>
          {group.indices.length > 1 && <span className="absolute top-0 right-0 rounded bg-zinc-800 px-0.5 text-[10px] text-indigo-200">{group.indices.length}</span>}
        </button>;
      })}
    </div>
  </div></div>;
});

const WaveformTile = memo(function WaveformTile({ envelope, style, left, width }: {
  envelope: WaveformEnvelope; style: "continuous" | "bars"; left: number; width: number;
}) {
  const geometry = useMemo(() => {
    if (style === "bars") return Array.from(envelope.min, (lo, i) => <rect key={i} x={i + .1} width={.8}
      y={50 - envelope.max[i] * 36} height={Math.max(1, (envelope.max[i] - lo) * 36)} fill="#a1a1aa" />);
    const top = Array.from(envelope.max, (v, i) => `${i + .5},${50 - v * 36}`).join(" L ");
    const bottom = Array.from(envelope.min, (v, i) => `${i + .5},${50 - v * 36}`).reverse().join(" L ");
    return <path d={`M ${top} L ${bottom} Z`} fill="#a1a1aa" />;
  }, [envelope, style]);
  return <svg className="absolute inset-y-0 h-full pointer-events-none" style={{ left: `${left}%`, width: `${width}%` }}
    viewBox={`0 0 ${envelope.min.length} 100`} preserveAspectRatio="none" aria-hidden>{geometry}</svg>;
});
