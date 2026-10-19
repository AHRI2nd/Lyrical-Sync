import { ClearGlyphTimings } from "./ClearGlyphTimings";
import { WaveformViewMenu } from "./WaveformViewMenu";
import { getCenteredView } from "../../utils/waveformTimeline";
import { getLinePlaybackRange } from "../../utils/linePlaybackRange";
import { CharWaveformPanel } from "./CharWaveformPanel";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { tokenizeText, isStampable, formatTimestamp, clampToNeighbors } from "../../utils/lrcParser";
import { anyModalOpen } from "../../utils/modalGuard";
import { isComposingKeyEvent, isInteractiveKeyTarget, keyLabel, matchAction, normalizeKeybindings } from "../../utils/keybindings";
import { usePointerScrub } from "../../hooks/usePointerScrub";
import { audioControls } from "../../utils/audioControls";
import type { LrcLine, LrcSyllable } from "../../types/lrc";
const DEFAULT_SPAN = 8;

type LineState = "none" | "partial" | "done";

function lineSyncState(line: LrcLine): LineState {
  const syl = line.syllables;
  if (!syl) return "none";
  const stampable = syl.filter(isStampable);
  if (stampable.length === 0) return "none";
  const timed = stampable.filter((s) => s.time !== null).length;
  if (timed === 0) return "none";
  return timed < stampable.length ? "partial" : "done";
}

export function CharSyncView({ onOpenShortcuts }: { onOpenShortcuts?: () => void } = {}) {
  const audioSelection = useLrcStore((s) => s._audioSelection);
  const documentSession = useLrcStore((s) => s._documentSession);
  const doc = useLrcStore((s) => s.doc);
  const activeLineId = useLrcStore((s) => s.activeLineId);
  const setActiveLineId = useLrcStore((s) => s.setActiveLineId);
  const currentTime = useLrcStore((s) => s.currentTime);
  const isPlaying = useLrcStore((s) => s.isPlaying);
  const duration = useLrcStore((s) => s.duration);
  const loopLineId = useLrcStore(s => s.loopLineId);
  const setLoopLine = useLrcStore(s => s.setLoopLine);
  const audioPath = useLrcStore((s) => s.audioPath);
  const syncUnit = useLrcStore((s) => s.syncUnit);
  const activeSyllableIndex = useLrcStore((s) => s.activeSyllableIndex);
  const setActiveSyllable = useLrcStore((s) => s.setActiveSyllable);
  const commitSyllables = useLrcStore((s) => s.commitSyllables);
  const { t } = useI18nStore();
  const lyricsFontScale = useSettingsStore((s) => s.lyricsFontScale);
  const showGlyphTimeMarkers = useSettingsStore((s) => s.showGlyphTimeMarkers);
  const controls = audioControls;
  const stampKey = keyLabel(normalizeKeybindings(useSettingsStore((s) => s.keybindings)).stamp);

  const lines = doc.lines;
  const lineIdx = activeLineId ? lines.findIndex((l) => l.id === activeLineId) : 0;
  const line: LrcLine | null = lines[lineIdx] ?? null;
  const syllables = useMemo<LrcSyllable[]>(() => {
    if (!line) return [];
    return line.syllables ?? tokenizeText(line.text, syncUnit);
  }, [line, syncUnit]);

  const stampableIdx = useMemo(
    () => syllables.map((s, i) => (isStampable(s) ? i : -1)).filter((i) => i >= 0),
    [syllables]
  );
  const prevLineTs = lineIdx > 0 ? lines[lineIdx - 1].timestamp : null;
  const nextLineTs = (() => {
    for (let i = lineIdx + 1; i < lines.length; i++) {
      if (lines[i].timestamp !== null && (line?.timestamp == null || lines[i].timestamp! > line.timestamp)) return lines[i].timestamp;
    }
    return null;
  })();
  const winStart = line?.timestamp ?? prevLineTs ?? 0;
  const repeatRange = getLinePlaybackRange(lines, activeLineId, duration);
  const canRepeat = !!audioPath && repeatRange !== null;
  const previousAudio = useRef({ audioPath, audioSelection });
  useEffect(() => {
    const changed = previousAudio.current.audioPath !== audioPath || previousAudio.current.audioSelection !== audioSelection;
    previousAudio.current = { audioPath, audioSelection };
    if (loopLineId && (changed || loopLineId !== activeLineId || !canRepeat)) setLoopLine(null);
  }, [audioPath, audioSelection, activeLineId, loopLineId, canRepeat, setLoopLine]);
  let winEnd =
    nextLineTs ??
    Math.min(winStart + DEFAULT_SPAN, duration > 0 ? duration : winStart + DEFAULT_SPAN);
  if (winEnd <= winStart) winEnd = winStart + DEFAULT_SPAN;

  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(true);
  const [anchor, setAnchor] = useState(currentTime);
  const waveformHeight = useSettingsStore(s => s.glyphWaveformHeight);
  const waveformStyle = useSettingsStore(s => s.glyphWaveformStyle);
  // Keep the viewing scale stable while stamps change the lyric's start timestamp.
  const baseSpan = useMemo(() => Math.max(2, winEnd - winStart), [documentSession, audioSelection, activeLineId, duration]);
  useEffect(() => { setZoom(1); setFollow(true); setAnchor(useLrcStore.getState().currentTime); }, [documentSession, audioSelection, activeLineId]);
  let { start: viewStart, end: viewEnd } = getCenteredView(follow ? currentTime : anchor, baseSpan / zoom, duration);
  const contextKey = JSON.stringify([documentSession, audioSelection, audioPath, activeLineId, zoom, winStart, winEnd, duration]);
  const displayRange = useRef({ start: viewStart, end: viewEnd });
  const [pendingSeek, setPendingSeek] = useState<{ start: number; end: number; time: number; fromTime: number; context: string } | null>(null);
  const laneScrub = usePointerScrub({
    contextKey, start: pendingSeek?.context === contextKey ? pendingSeek.start : viewStart,
    end: pendingSeek?.context === contextKey ? pendingSeek.end : viewEnd, enabled: !!audioPath && duration > 0,
    onCommit: seconds => {
      setPendingSeek({ ...displayRange.current, time: seconds, fromTime: useLrcStore.getState().currentTime, context: contextKey });
      setFollow(true); setAnchor(seconds); controls.seekTo(seconds);
    },
  });
  useEffect(() => {
    if (!pendingSeek) return;
    if (pendingSeek.context !== contextKey || currentTime !== pendingSeek.fromTime) { setPendingSeek(null); return; }
    const timer = setTimeout(() => setPendingSeek(null), 750);
    return () => clearTimeout(timer);
  }, [pendingSeek, currentTime, contextKey]);
  const frozen = laneScrub.range ?? (pendingSeek?.context === contextKey ? pendingSeek : null);
  if (frozen) { viewStart = frozen.start; viewEnd = frozen.end; }
  displayRange.current = { start: viewStart, end: viewEnd };
  const visiblePlayhead = laneScrub.preview ?? (pendingSeek?.context === contextKey ? pendingSeek.time : currentTime);
  const seekWithFollow = (seconds: number) => {
    setFollow(true); setAnchor(seconds); setPendingSeek(null); controls.seekTo(seconds);
  };
  const playingIdx = useMemo(() => {
    if (currentTime < winStart || currentTime > winEnd) return -1;
    let idx = -1;
    for (let i = 0; i < syllables.length; i++) {
      const tt = syllables[i].time;
      if (tt !== null && isStampable(syllables[i]) && tt <= currentTime) idx = i;
    }
    return idx;
  }, [syllables, currentTime, winStart, winEnd]);

  const textRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stampableIdx.length === 0) {
      setActiveSyllable(0);
      return;
    }
    const firstUnstamped = stampableIdx.find((i) => syllables[i].time === null);
    setActiveSyllable(firstUnstamped ?? stampableIdx[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLineId, syncUnit, stampableIdx.length]);
  const gotoLine = (i: number) => {
    const l = useLrcStore.getState().doc.lines[i];
    if (l) setActiveLineId(l.id);
  };
  useEffect(() => {
    if (!activeLineId && lines.length > 0) setActiveLineId(lines[0].id);
  }, [activeLineId, lines, setActiveLineId]);
  const stateRef = useRef({
    line,
    syllables,
    stampableIdx,
    lineIdx,
    linesLen: lines.length,
  });
  stateRef.current = { line, syllables, stampableIdx, lineIdx, linesLen: lines.length };

  const stampActive = () => {
    const { line: ln, syllables: syl, stampableIdx: sidx, lineIdx: li } = stateRef.current;
    if (!ln) return;
    if (sidx.length === 0) { gotoLine(li + 1); return; }
    const idx = useLrcStore.getState().activeSyllableIndex;
    if (!syl[idx] || !isStampable(syl[idx])) return;
    const time = clampToNeighbors(syl, idx, useLrcStore.getState().currentTime);
    const next = syl.map((s, i) => (i === idx ? { ...s, time } : s));
    commitSyllables(ln.id, next);
    const pos = sidx.indexOf(idx);
    const nextIdx = sidx[pos + 1];
    if (nextIdx != null) setActiveSyllable(nextIdx);
    else gotoLine(li + 1); // 마지막 글자면 다음 줄로
  };

  const moveActive = (dir: number) => {
    const { stampableIdx: sidx, lineIdx: li } = stateRef.current;
    const idx = useLrcStore.getState().activeSyllableIndex;
    const pos = sidx.indexOf(idx);
    const np = pos + dir;
    if (np >= 0 && np < sidx.length) setActiveSyllable(sidx[np]);
    else if (dir < 0) gotoLine(li - 1);
    else gotoLine(li + 1);
  };
  const nudge = (delta: number) => {
    const { line: ln, syllables: syl } = stateRef.current;
    if (!ln) return;
    const idx = useLrcStore.getState().activeSyllableIndex;
    const s = syl[idx];
    if (!s || !isStampable(s) || s.time === null) return;
    let lo = 0;
    let hi = Infinity;
    for (let i = idx - 1; i >= 0; i--) { if (syl[i].time !== null) { lo = syl[i].time as number; break; } }
    for (let i = idx + 1; i < syl.length; i++) { if (syl[i].time !== null) { hi = syl[i].time as number; break; } }
    const nt = Math.max(lo, Math.min(hi, Math.max(0, (s.time as number) + delta)));
    commitSyllables(ln.id, syl.map((x, i) => (i === idx ? { ...x, time: nt } : x)));
    seekWithFollow(nt);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (isInteractiveKeyTarget(e.target) || isInteractiveKeyTarget(document.activeElement)) return;
      if (anyModalOpen()) return;
      if (e.code === "ArrowLeft" && e.shiftKey) { e.preventDefault(); nudge(-0.05); return; }
      if (e.code === "ArrowRight" && e.shiftKey) { e.preventDefault(); nudge(0.05); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); moveActive(-1); return; }
      if (e.code === "ArrowRight") { e.preventDefault(); moveActive(1); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const kb = normalizeKeybindings(useSettingsStore.getState().keybindings);
      const action = matchAction(e.code, kb);
      if (action === "stamp") { e.preventDefault(); stampActive(); }
      else if (action === "prevLine") { e.preventDefault(); moveActive(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const laneRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const stampGlyphAt = (index: number, recordHistory = true) => {
    const { line: ln, syllables: syl, stampableIdx: sidx } = stateRef.current;
    if (!ln || !syl[index] || !isStampable(syl[index])) return;
    const time = clampToNeighbors(syl, index, useLrcStore.getState().currentTime);
    commitSyllables(ln.id, syl.map((s, i) => (i === index ? { ...s, time } : s)), recordHistory);
    const pos = sidx.indexOf(index);
    const nextIdx = sidx[pos + 1];
    if (nextIdx != null) setActiveSyllable(nextIdx);
  };
  const beginDrag = (index: number, e: React.MouseEvent) => {
    if (!line || e.button !== 0) return; // 좌클릭만 (우클릭은 글자 지우기)
    e.preventDefault();
    // Return shortcut focus to the glyph editor after using a toolbar control.
    textRef.current?.focus({ preventScroll: true });
    const startX = e.clientX;
    const startY = e.clientY;
    let painting = false;
    let lastIdx = -1;
    let advancedViaEnd = false;

    const move = (ev: MouseEvent) => {
      if (!painting) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 5) return;
        painting = true;
        stampGlyphAt(index, true); // 칠하기 시작 = 히스토리 1회 기록
        lastIdx = index;
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (el?.getAttribute?.("data-glyph-end") != null) {
        if (!advancedViaEnd) {
          advancedViaEnd = true;
          gotoLine(stateRef.current.lineIdx + 1);
          lastIdx = -1;
        }
        return;
      }
      const attr = el?.getAttribute?.("data-glyph");
      if (attr == null) return;
      advancedViaEnd = false;
      const gi = parseInt(attr, 10);
      if (Number.isNaN(gi) || gi === lastIdx) return;
      lastIdx = gi;
      stampGlyphAt(gi, false);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      dragCleanupRef.current = null;
    };
    const up = () => {
      cleanup();
      if (!painting) setActiveSyllable(index); // 단순 클릭 = 선택만(찍지 않음)
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const replayLine = () => {
    seekWithFollow(winStart);
    if (!isPlaying) controls.togglePlay();
  };

  const clearGlyph = (index: number) => {
    if (!line || syllables[index].time === null) return;
    commitSyllables(line.id, syllables.map((s, i) => (i === index ? { ...s, time: null } : s)));
  };

  if (!line) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--ls-text-secondary)] text-sm text-center">{t.charSync.empty}</p>
      </div>
    );
  }
  const readoutSyl = syllables[activeSyllableIndex];
  const readoutText = readoutSyl && isStampable(readoutSyl) ? readoutSyl.text.trim() : "—";
  const readoutTime = readoutSyl && readoutSyl.time !== null ? formatTimestamp(readoutSyl.time) : "--:--.--";
  const glyphTotal = stampableIdx.length;
  const glyphDone = stampableIdx.filter((i) => syllables[i].time !== null).length;

  const ZOOM_LEVELS = [1, 2, 4, 8];
  const setZoomStep = (dir: number) => {
    if (!follow) setAnchor(readoutSyl?.time ?? anchor);
    setPendingSeek(null);
    setZoom(z => ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + dir))]);
  };
  const pan = (dir: number) => { setFollow(false); setPendingSeek(null); setAnchor((viewStart + viewEnd) / 2 + dir * (viewEnd - viewStart) / 2); };

  return <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-4 pr-1">
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-[var(--ls-border-subtle)] shrink-0">
      <span className="text-sm text-[var(--ls-text)] shrink-0">{t.charSync.modeChar}</span>
      {onOpenShortcuts && <button type="button" onClick={onOpenShortcuts} className="ls-button ls-button--compact text-xs">{t.charSync.shortcuts}</button>}
      <LineDots lines={lines} activeIdx={lineIdx} onSelect={setActiveLineId} />
      <button type="button" onClick={e => { gotoLine(lineIdx - 1); e.currentTarget.blur(); }} disabled={lineIdx <= 0}
        className="ls-button ls-button--compact hover:text-white disabled:opacity-30">‹</button>
      <span className="text-xs text-[var(--ls-text-secondary)] font-mono shrink-0">{lineIdx + 1}/{lines.length}</span>
      <button type="button" onClick={e => { gotoLine(lineIdx + 1); e.currentTarget.blur(); }} disabled={lineIdx >= lines.length - 1}
        className="ls-button ls-button--compact hover:text-white disabled:opacity-30">›</button>
    </div>
    <div className="shrink-0 min-w-0">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ls-text-secondary)] mb-3">
        <span>{t.charSync.currentLine}</span><span title={t.charSync.glyphProgress} className="font-mono tabular-nums">{glyphDone}/{glyphTotal}</span>
        <div className="ml-auto"><ClearGlyphTimings lineId={line.id} /></div>
      </div>
      <div ref={textRef} tabIndex={-1} className="min-h-16 leading-relaxed select-none break-words"
        style={{ whiteSpace: "pre-wrap", fontSize: `${1.875 * lyricsFontScale}rem` }}>
        {syllables.map((s, i) => !isStampable(s) ? <span key={i}>{s.text}</span> : <span key={i} data-glyph={i}
          onMouseDown={e => beginDrag(i, e)} onContextMenu={e => { e.preventDefault(); clearGlyph(i); }}
          className={`ls-glyph cursor-pointer px-0.5 transition-colors ${i === activeSyllableIndex ? "ls-glyph--selected" : i === playingIdx ? "ls-glyph--playing" : s.time !== null ? "ls-glyph--timed text-[var(--ls-text)]" : "text-[var(--ls-text-secondary)] hover:text-[var(--ls-text)]"}`}>
          {s.text}
        </span>)}
        <button type="button" data-glyph-end="1" onClick={e => { gotoLine(lineIdx + 1); e.currentTarget.blur(); }}
          title={t.charSync.endCell} className="align-middle ml-2 px-1.5 rounded border border-dashed border-[var(--ls-border-subtle)] text-[var(--ls-text-secondary)] text-sm hover:text-[var(--ls-accent)]">↵</button>
      </div>
    </div>
    <div className="shrink-0 min-w-0">
      <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1 border-t border-[var(--ls-border-subtle)] pt-3 pb-3 text-xs">
        <span className="text-[var(--ls-text-secondary)]">{t.charSync.selectedGlyph}</span>
        <span className="text-[var(--ls-accent)] font-medium break-all">{readoutText}</span>
        <span className="font-mono tabular-nums text-[var(--ls-text)]">{readoutTime}</span>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3 text-xs">
        <span className="text-[var(--ls-text-secondary)] font-mono tabular-nums">{t.charSync.displaySpan.replace("{seconds}", String(Number((viewEnd - viewStart).toFixed(2))))}</span>
        <div className="flex items-center flex-wrap gap-1.5">
          <button type="button" aria-label={t.charSync.prevWindow} onClick={e => { pan(-1); e.currentTarget.blur(); }} disabled={viewStart <= 0}
            className="ls-button ls-button--compact disabled:opacity-30">‹</button>
          <button type="button" aria-label={t.zoom} onClick={e => { setZoomStep(-1); e.currentTarget.blur(); }} disabled={zoom <= 1}
            className="ls-button ls-button--compact disabled:opacity-30">−</button>
          <span className="text-[var(--ls-text-secondary)] font-mono">{zoom}×</span>
          <button type="button" aria-label={`${t.zoom} +`} onClick={e => { setZoomStep(1); e.currentTarget.blur(); }} disabled={zoom >= 8}
            className="ls-button ls-button--compact disabled:opacity-30">+</button>
          <button type="button" aria-label={t.charSync.nextWindow} onClick={e => { pan(1); e.currentTarget.blur(); }} disabled={duration > 0 && viewEnd >= duration}
            className="ls-button ls-button--compact disabled:opacity-30">›</button>
          <button type="button" aria-pressed={follow} onClick={e => { setFollow(v => !v); setAnchor((viewStart + viewEnd) / 2); e.currentTarget.blur(); }}
            className={`ls-button ls-button--compact ${`rounded border border-[var(--ls-border-subtle)] ${follow ? "bg-[var(--ls-selection)]/15 text-[var(--ls-accent)]" : "text-[var(--ls-text-secondary)]"}`}`}>{t.charSync.followPlayback}</button>
          <WaveformViewMenu />
        </div>
      </div>
      <CharWaveformPanel laneRef={laneRef} onPointerDown={laneScrub.begin} audioPath={audioPath}
        start={viewStart} end={viewEnd} lineStart={winStart} lineEnd={repeatRange?.end ?? winEnd} playhead={visiblePlayhead}
        syllables={syllables} activeIndex={activeSyllableIndex} onSelect={index => { setActiveSyllable(index); textRef.current?.focus({ preventScroll: true }); }}
        height={waveformHeight} style={waveformStyle} showMarkers={showGlyphTimeMarkers} repeating={loopLineId === line.id && canRepeat} />
      <div className="flex gap-x-3 gap-y-1 flex-wrap justify-between text-[11px] text-[var(--ls-text-secondary)] mt-2">
        <div className="flex gap-3"><span className="inline-flex gap-1 items-center"><span className="w-0.5 h-2.5 bg-[var(--ls-accent)]" aria-hidden />{t.charSync.selectedGlyph}</span>
          <span className="inline-flex gap-1 items-center"><span className="w-0.5 h-2.5 bg-[var(--ls-playhead)]" aria-hidden />{t.charSync.playhead}</span></div>
        <span className="font-mono tabular-nums">{loopLineId === line.id ? t.charSync.repeatLine : t.charSync.currentLine} {formatTimestamp(winStart)} — {formatTimestamp(repeatRange?.end ?? winEnd)}</span>
      </div>
    </div>
    <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={e => { replayLine(); e.currentTarget.blur(); }} className="ls-button ls-button--compact text-xs">↺ {t.charSync.replayLine}</button>
        <button type="button" aria-label={t.charSync.repeatLine} aria-pressed={loopLineId === line.id} disabled={!canRepeat}
          title={canRepeat ? t.charSync.repeatLine : t.charSync.repeatUnavailable}
          onClick={e => {
            if (loopLineId === line.id) setLoopLine(null);
            else if (canRepeat && repeatRange) { setLoopLine(line.id); setFollow(true); controls.seekTo(repeatRange.start); }
            e.currentTarget.blur();
          }} className={`ls-button ls-button--compact ${`text-xs rounded-md border border-[var(--ls-border-subtle)] disabled:opacity-30 ${loopLineId === line.id ? "bg-[var(--ls-selection)]/15 text-[var(--ls-accent)]" : "text-[var(--ls-text-secondary)] hover:bg-[var(--ls-control)]"}`}`}>
          {t.charSync.repeatLine} · {loopLineId === line.id ? t.charSync.repeatOn : t.charSync.repeatOff}
        </button>
      </div>
      <button type="button" aria-label={t.charSync.stampHint} onClick={e => { stampActive(); e.currentTarget.blur(); textRef.current?.focus({ preventScroll: true }); }}
        className="ls-button ls-button--primary flex items-center justify-center gap-2 text-xs font-medium">
        {t.charSync.stampHint}<kbd className="px-1 py-0.5 border border-white/50 rounded font-mono text-[11px]">{stampKey}</kbd>
      </button>
    </div>

  </div>;
}
const LineDots = memo(function LineDots({
  lines, activeIdx, onSelect,
}: {
  lines: LrcLine[];
  activeIdx: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1">
      {lines.map((l, i) => {
        const st = lineSyncState(l);
        const active = i === activeIdx;
        const color =
          st === "done" ? "bg-emerald-500" : st === "partial" ? "bg-[var(--ls-playhead)]" : "bg-transparent border border-[var(--ls-border-control)]";
        return (
          <button
            key={l.id}
            onClick={() => onSelect(l.id)}
            title={`${i + 1}. ${l.text}`}
            className={`shrink-0 rounded-full transition-all ${color} ${
              active ? "w-2.5 h-2.5 ring-2 ring-[var(--ls-accent)]/60" : `w-2 h-2 ${st === "none" ? "opacity-100" : "opacity-70 hover:opacity-100"}`
            }`}
          />
        );
      })}
    </div>
  );
});
