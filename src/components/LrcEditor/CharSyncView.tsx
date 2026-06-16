import { useEffect, useMemo, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { tokenizeText, isStampable, formatTimestamp } from "../../utils/lrcParser";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import type { LrcLine, LrcSyllable } from "../../types/lrc";

// 줄 타임스탬프가 없을 때 글자를 펼칠 기본 시간 창(초)
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

export function CharSyncView() {
  const doc = useLrcStore((s) => s.doc);
  const activeLineId = useLrcStore((s) => s.activeLineId);
  const setActiveLineId = useLrcStore((s) => s.setActiveLineId);
  const currentTime = useLrcStore((s) => s.currentTime);
  const isPlaying = useLrcStore((s) => s.isPlaying);
  const duration = useLrcStore((s) => s.duration);
  const audioPath = useLrcStore((s) => s.audioPath);
  const syncUnit = useLrcStore((s) => s.syncUnit);
  const activeSyllableIndex = useLrcStore((s) => s.activeSyllableIndex);
  const setActiveSyllable = useLrcStore((s) => s.setActiveSyllable);
  const commitSyllables = useLrcStore((s) => s.commitSyllables);
  const clearLineSyllables = useLrcStore((s) => s.clearLineSyllables);
  const { t } = useI18nStore();
  const spotifyMode = useSettingsStore((s) => s.spotifyMode);
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  const controls = serviceLoggedIn && spotifyMode ? serviceControls : audioControls;

  const lines = doc.lines;
  const lineIdx = activeLineId ? lines.findIndex((l) => l.id === activeLineId) : 0;
  const line: LrcLine | null = lines[lineIdx] ?? null;

  // 표시용 토큰: 저장된 글자 동기화가 있으면 그대로, 없으면 현재 단위로 즉석 토큰화
  const syllables = useMemo<LrcSyllable[]>(() => {
    if (!line) return [];
    return line.syllables ?? tokenizeText(line.text, syncUnit);
  }, [line, syncUnit]);

  const stampableIdx = useMemo(
    () => syllables.map((s, i) => (isStampable(s) ? i : -1)).filter((i) => i >= 0),
    [syllables]
  );

  // 시간 창 계산
  const prevLineTs = lineIdx > 0 ? lines[lineIdx - 1].timestamp : null;
  const nextLineTs = (() => {
    for (let i = lineIdx + 1; i < lines.length; i++) {
      if (lines[i].timestamp !== null) return lines[i].timestamp;
    }
    return null;
  })();
  const winStart = line?.timestamp ?? prevLineTs ?? 0;
  let winEnd =
    nextLineTs ??
    Math.min(winStart + DEFAULT_SPAN, duration > 0 ? duration : winStart + DEFAULT_SPAN);
  if (winEnd <= winStart) winEnd = winStart + DEFAULT_SPAN;
  const pct = (time: number) =>
    `${Math.max(0, Math.min(1, (time - winStart) / (winEnd - winStart))) * 100}%`;

  // 레인 파형: 전체 트랙 peaks에서 현재 시간 창 구간만 잘라 막대로
  const peaks = useMemo(() => audioControls.getPeaks(), [audioPath, duration]);
  const waveBars = useMemo(() => {
    if (!peaks || duration <= 0 || winEnd <= winStart) return null;
    const i0 = Math.max(0, Math.floor((winStart / duration) * peaks.length));
    const i1 = Math.min(peaks.length, Math.ceil((winEnd / duration) * peaks.length));
    if (i1 <= i0) return null;
    return peaks.slice(i0, i1).map((v) => Math.min(1, Math.abs(v)));
  }, [peaks, duration, winStart, winEnd]);

  // 재생 위치에서 지금 불리는 글자(편집 커서와 별개). 창 밖이면 -1.
  const playingIdx = useMemo(() => {
    if (currentTime < winStart || currentTime > winEnd) return -1;
    let idx = -1;
    for (let i = 0; i < syllables.length; i++) {
      const tt = syllables[i].time;
      if (tt !== null && isStampable(syllables[i]) && tt <= currentTime) idx = i;
    }
    return idx;
  }, [syllables, currentTime, winStart, winEnd]);

  // 활성 줄이 바뀌면 활성 글자를 첫 미입력(없으면 첫 글자)으로
  useEffect(() => {
    if (stampableIdx.length === 0) {
      setActiveSyllable(0);
      return;
    }
    const firstUnstamped = stampableIdx.find((i) => syllables[i].time === null);
    setActiveSyllable(firstUnstamped ?? stampableIdx[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLineId, syncUnit, stampableIdx.length]);

  // keydown 핸들러가 1회 캡처되므로 lines는 클로저 대신 최신 상태에서 읽는다
  const gotoLine = (i: number) => {
    const l = useLrcStore.getState().doc.lines[i];
    if (l) setActiveLineId(l.id);
  };

  // 활성 줄이 없으면 첫 줄로 (글자 모드 진입 시 선택 보장)
  useEffect(() => {
    if (!activeLineId && lines.length > 0) setActiveLineId(lines[0].id);
  }, [activeLineId, lines, setActiveLineId]);

  // 최신 상태 스냅샷 (키 핸들러에서 참조)
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
    // 스탬프할 글자가 없는 줄(빈 구분선)이면 다음 줄로 건너뜀
    if (sidx.length === 0) { gotoLine(li + 1); return; }
    const idx = useLrcStore.getState().activeSyllableIndex;
    if (!syl[idx] || !isStampable(syl[idx])) return;
    const time = useLrcStore.getState().currentTime;
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

  // 현재 글자 시각 미세조정 (Shift+←/→). 이웃 글자 시각 사이로 클램프 + 탐색.
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
    const ctrl = useServiceStore.getState().isLoggedIn && useSettingsStore.getState().spotifyMode
      ? serviceControls : audioControls;
    ctrl.seekTo(nt);
  };

  // Space=찍기, Backspace/←→=이동
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (inInput) return;
      if (e.code === "Space") {
        e.preventDefault();
        stampActive();
      } else if (e.code === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        nudge(-0.05);
      } else if (e.code === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        nudge(0.05);
      } else if (e.code === "Backspace") {
        e.preventDefault();
        moveActive(-1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        moveActive(-1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        moveActive(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 드래그 스크럽: 글자를 누른 채 좌우로 → 오디오 탐색 + 놓는 시각에 스탬프
  const laneRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [dragPreview, setDragPreview] = useState<{ index: number; time: number } | null>(null);

  // 드래그 도중 언마운트되면 window 리스너/rAF 정리
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const beginDrag = (index: number, e: React.MouseEvent) => {
    if (!line || e.button !== 0) return; // 좌클릭만 (우클릭은 글자 지우기)
    e.preventDefault();
    const startX = e.clientX;
    let moved = false;
    // 이웃 토큰 시각으로 단조성 보장
    let lo = winStart;
    let hi = winEnd;
    for (let i = index - 1; i >= 0; i--) {
      if (syllables[i].time !== null) { lo = syllables[i].time as number; break; }
    }
    for (let i = index + 1; i < syllables.length; i++) {
      if (syllables[i].time !== null) { hi = syllables[i].time as number; break; }
    }

    const timeAt = (clientX: number) => {
      const el = laneRef.current;
      if (!el) return winStart;
      const r = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const tt = winStart + ratio * (winEnd - winStart);
      return Math.max(lo, Math.min(hi, tt));
    };

    let raf: number | null = null;
    const move = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      const tt = timeAt(ev.clientX);
      setDragPreview({ index, time: tt });
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => controls.seekTo(tt));
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (raf) cancelAnimationFrame(raf);
      dragCleanupRef.current = null;
    };
    const up = (ev: MouseEvent) => {
      cleanup();
      if (moved) {
        const tt = timeAt(ev.clientX);
        const next = syllables.map((s, i) => (i === index ? { ...s, time: tt } : s));
        commitSyllables(line.id, next);
        setActiveSyllable(index);
      } else {
        // 단순 클릭 = 글자 선택 + (시각 있으면) 탐색
        setActiveSyllable(index);
        const ts = syllables[index].time;
        if (ts !== null) controls.seekTo(ts);
      }
      setDragPreview(null);
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const replayLine = () => {
    controls.seekTo(winStart);
    if (!isPlaying) controls.togglePlay();
  };

  const clearLine = () => {
    if (line) clearLineSyllables(line.id);
  };

  // 우클릭: 그 글자의 시각만 제거
  const clearGlyph = (index: number) => {
    if (!line || syllables[index].time === null) return;
    commitSyllables(line.id, syllables.map((s, i) => (i === index ? { ...s, time: null } : s)));
  };

  if (!line) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-500 text-sm text-center">{t.charSync.empty}</p>
      </div>
    );
  }

  // readout: 드래그 중이면 끌고 있는 글자, 아니면 현재 활성 글자
  const readoutSyl = dragPreview ? syllables[dragPreview.index] : syllables[activeSyllableIndex];
  const readoutText = readoutSyl && isStampable(readoutSyl) ? readoutSyl.text.trim() : "—";
  const readoutTime = dragPreview
    ? formatTimestamp(dragPreview.time)
    : readoutSyl && readoutSyl.time !== null
    ? formatTimestamp(readoutSyl.time)
    : "--:--.--";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 줄 네비게이터 */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-800/60 rounded-lg mb-4">
        <button
          onClick={(e) => { gotoLine(lineIdx - 1); e.currentTarget.blur(); }}
          disabled={lineIdx <= 0}
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors"
        >
          ‹
        </button>
        <span className="text-xs text-zinc-500 font-mono shrink-0">
          {lineIdx + 1} / {lines.length}
        </span>
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-1">
          {lines.map((l, i) => {
            const st = lineSyncState(l);
            const active = i === lineIdx;
            const color =
              st === "done"
                ? "bg-emerald-500"
                : st === "partial"
                ? "bg-amber-500"
                : "bg-zinc-600";
            return (
              <button
                key={l.id}
                onClick={() => setActiveLineId(l.id)}
                title={`${i + 1}. ${l.text}`}
                className={`shrink-0 rounded-full transition-all ${color} ${
                  active ? "w-2.5 h-2.5 ring-2 ring-indigo-400/60" : "w-2 h-2 opacity-70 hover:opacity-100"
                }`}
              />
            );
          })}
        </div>
        <button
          onClick={(e) => { gotoLine(lineIdx + 1); e.currentTarget.blur(); }}
          disabled={lineIdx >= lines.length - 1}
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors"
        >
          ›
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      <p className="text-xs text-zinc-500 mb-2 px-1">{t.charSync.hint}</p>

      {/* 활성 줄 — 한 줄 흐름 텍스트 */}
      <div
        className="text-3xl leading-relaxed mb-3 px-1 select-none"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {syllables.map((s, i) => {
          if (!isStampable(s)) return <span key={i}>{s.text}</span>;
          const isCurrent = i === activeSyllableIndex;
          const isSinging = i === playingIdx && !isCurrent;
          const stamped = s.time !== null;
          const cls = isCurrent
            ? "bg-indigo-500 text-white rounded px-0.5"
            : isSinging
            ? "bg-amber-500/20 text-amber-200 rounded px-0.5"
            : stamped
            ? "text-zinc-100 border-b-2 border-indigo-500/60"
            : "text-zinc-600 hover:text-zinc-400";
          return (
            <span
              key={i}
              onMouseDown={(e) => beginDrag(i, e)}
              onContextMenu={(e) => { e.preventDefault(); clearGlyph(i); }}
              className={`cursor-grab transition-colors ${cls}`}
            >
              {s.text}
            </span>
          );
        })}
      </div>

      {/* 현재 글자 readout */}
      <div className="flex items-center gap-2 text-xs mb-2 px-1">
        <span className="font-mono text-indigo-300">
          {t.charSync.current}: 「{readoutText}」 → {readoutTime}
        </span>
      </div>
      </div>

      {/* 스크럽 레인 */}
      <div
        ref={laneRef}
        onMouseDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          controls.seekTo(winStart + ratio * (winEnd - winStart));
        }}
        className="relative h-10 rounded-lg bg-zinc-950/60 border border-zinc-800 overflow-hidden cursor-pointer mb-1"
      >
        {waveBars && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${waveBars.length} 100`}
            preserveAspectRatio="none"
          >
            {waveBars.map((v, k) => {
              const h = Math.max(1, v * 88);
              return <rect key={k} x={k + 0.1} width={0.8} y={(100 - h) / 2} height={h} fill="#3f3f46" />;
            })}
          </svg>
        )}
        {syllables.map((s, i) =>
          s.time !== null && isStampable(s) ? (
            <div
              key={i}
              style={{ left: pct(s.time) }}
              className="absolute top-0 bottom-0 w-px bg-indigo-500/50"
            />
          ) : null
        )}
        <div
          style={{ left: pct(currentTime) }}
          className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none"
        />
        <span className="absolute left-1.5 bottom-0.5 text-[10px] text-zinc-600 font-mono pointer-events-none">
          {formatTimestamp(winStart)}
        </span>
        <span className="absolute right-1.5 bottom-0.5 text-[10px] text-zinc-600 font-mono pointer-events-none">
          {formatTimestamp(winEnd)}
        </span>
      </div>

      {/* 하단 컨트롤 */}
      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium">
          <kbd className="px-1.5 py-0.5 rounded bg-indigo-700/70 text-xs font-mono">Space</kbd>
          {t.charSync.stampHint}
        </div>
        <button
          onClick={(e) => { replayLine(); e.currentTarget.blur(); }}
          className="px-3 py-2 text-xs rounded-lg text-zinc-300 border border-zinc-700 hover:bg-zinc-800 hover:text-white transition-colors whitespace-nowrap"
        >
          ↺ {t.charSync.replayLine}
        </button>
        <button
          onClick={(e) => { clearLine(); e.currentTarget.blur(); }}
          className="px-3 py-2 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-rose-300 transition-colors whitespace-nowrap"
        >
          {t.charSync.clearLine}
        </button>
      </div>
    </div>
  );
}
