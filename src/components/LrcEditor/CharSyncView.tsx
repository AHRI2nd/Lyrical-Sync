import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { tokenizeText, isStampable, formatTimestamp, clampToNeighbors } from "../../utils/lrcParser";
import { anyModalOpen } from "../../utils/modalGuard";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import type { LrcLine, LrcSyllable } from "../../types/lrc";

// 줄 타임스탬프가 없을 때 글자를 펼칠 기본 시간 창(초)
const DEFAULT_SPAN = 8;

// 찍힌 글자 아래 시간 마커(점선+시각) 레이아웃
const MARK_STEP = 13;        // 단계당 점선 길이 증가(px)
const MARK_LEVELS = 5;       // 라벨을 배치할 최대 단계 수
const MARK_GAP = 8;          // 라벨 간 최소 간격(px)
const MARK_LABEL_H = 14;     // 라벨 높이(px)
const MARK_TICK = 5;         // 라벨 없는(겹쳐서 생략된) 글자의 짧은 틱 길이(px)

// label=false: 라벨 들어갈 자리가 없어 틱만 표시
type TimeMark = { index: number; x: number; level: number; time: string; label: boolean };

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

  // 레인 줌: 창을 1/zoom 너비로 좁혀 재생헤드 중심으로 표시 → 밀집 구간 정밀도↑
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setZoom(1); }, [activeLineId]);
  let viewStart = winStart;
  let viewEnd = winEnd;
  if (zoom > 1) {
    const vw = (winEnd - winStart) / zoom;
    const center = Math.min(Math.max(currentTime, winStart), winEnd);
    viewStart = Math.max(winStart, Math.min(center - vw / 2, winEnd - vw));
    viewEnd = viewStart + vw;
  }
  const pct = (time: number) =>
    `${Math.max(0, Math.min(1, (time - viewStart) / (viewEnd - viewStart))) * 100}%`;

  // 레인 파형: 전체 트랙 peaks에서 표시 창(view) 구간만 잘라 막대로
  const peaks = useMemo(() => audioControls.getPeaks(), [audioPath, duration]);
  const waveBars = useMemo(() => {
    if (!peaks || duration <= 0 || viewEnd <= viewStart) return null;
    const i0 = Math.max(0, Math.floor((viewStart / duration) * peaks.length));
    const i1 = Math.min(peaks.length, Math.ceil((viewEnd / duration) * peaks.length));
    if (i1 <= i0) return null;
    return peaks.slice(i0, i1).map((v) => Math.min(1, Math.abs(v)));
  }, [peaks, duration, viewStart, viewEnd]);

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

  // 찍힌 글자 아래 시간 마커(점선+시각). 글자 위치·라벨 폭을 측정해 겹치지 않게 배치.
  const textRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [marks, setMarks] = useState<TimeMark[]>([]);
  const [marksHeight, setMarksHeight] = useState(0);
  const [measureKey, setMeasureKey] = useState(0);

  useEffect(() => {
    const onResize = () => setMeasureKey((k) => k + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const root = textRef.current;
    if (!root) { setMarks([]); setMarksHeight(0); return; }
    // 실제 라벨 폭 측정(폰트 의존). 실패 시 보수적 기본값.
    const labelW = (measureRef.current?.offsetWidth ?? 56) + MARK_GAP;
    const levelRight: number[] = []; // 단계별 마지막 라벨 우측 끝
    const out: TimeMark[] = [];
    let maxLabelLevel = 0;
    for (let i = 0; i < syllables.length; i++) {
      const s = syllables[i];
      if (s.time === null || !isStampable(s)) continue;
      const el = root.querySelector<HTMLElement>(`[data-glyph="${i}"]`);
      if (!el) continue;
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const left = cx - labelW / 2;
      const right = cx + labelW / 2;
      // 겹치지 않는 가장 낮은 단계 찾기. 없으면 라벨 생략(틱만) → 겹침 0 보장.
      let level = -1;
      for (let L = 0; L < MARK_LEVELS; L++) {
        if (levelRight[L] === undefined || levelRight[L] <= left) { level = L; break; }
      }
      const hasLabel = level !== -1;
      if (hasLabel) {
        levelRight[level] = right;
        maxLabelLevel = Math.max(maxLabelLevel, level);
      }
      out.push({ index: i, x: cx, level: hasLabel ? level : 0, time: formatTimestamp(s.time), label: hasLabel });
    }
    const anyLabel = out.some((m) => m.label);
    setMarks(out);
    setMarksHeight(out.length ? (anyLabel ? maxLabelLevel * MARK_STEP + MARK_LABEL_H + 6 : MARK_TICK + 4) : 0);
  }, [syllables, activeLineId, syncUnit, measureKey]);

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
      // 모달이 열려 있으면 글자 모드 키가 모달 뒤에서 동작하지 않게 차단
      if (anyModalOpen()) return;
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

  const laneRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // 드래그 도중 언마운트되면 window 리스너 정리
  useEffect(() => () => dragCleanupRef.current?.(), []);

  // 글자를 "현재 재생 시간"으로 찍고 다음 글자를 준비(활성)로. 재생헤드는 건드리지 않음.
  // recordHistory=false면 히스토리 미기록(칠하기 드래그 도중 글자들을 1회 undo로 묶기 위함).
  const stampGlyphAt = (index: number, recordHistory = true) => {
    const { line: ln, syllables: syl, stampableIdx: sidx } = stateRef.current;
    if (!ln || !syl[index] || !isStampable(syl[index])) return;
    const time = clampToNeighbors(syl, index, useLrcStore.getState().currentTime);
    commitSyllables(ln.id, syl.map((s, i) => (i === index ? { ...s, time } : s)), recordHistory);
    const pos = sidx.indexOf(index);
    const nextIdx = sidx[pos + 1];
    if (nextIdx != null) setActiveSyllable(nextIdx);
  };

  // 글자 위 드래그 = 칠하기: 재생 중 글자 위를 끌면 지나는 글자가 현재 재생 시간으로 찍히고
  // 다음 글자가 준비됨(재생헤드 이동/스크럽 없음). 단순 클릭 = 그 글자를 활성(준비)으로 선택만.
  const beginDrag = (index: number, e: React.MouseEvent) => {
    if (!line || e.button !== 0) return; // 좌클릭만 (우클릭은 글자 지우기)
    e.preventDefault();
    const startX = e.clientX;
    let painting = false;
    let lastIdx = -1;
    let advancedViaEnd = false;

    const move = (ev: MouseEvent) => {
      if (!painting) {
        if (Math.abs(ev.clientX - startX) <= 5) return;
        painting = true;
        stampGlyphAt(index, true); // 칠하기 시작 = 히스토리 1회 기록
        lastIdx = index;
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      // 마지막 공백 셀까지 칠이 이어지면 다음 줄로 (드래그 1회당 한 번만)
      if (el?.getAttribute?.("data-glyph-end") != null) {
        if (!advancedViaEnd) {
          advancedViaEnd = true;
          gotoLine(stateRef.current.lineIdx + 1);
          lastIdx = -1;
        }
        return;
      }
      // 커서 아래 글자 판별 → 새 글자에 진입하면 현재 재생 시간으로 찍기 (히스토리 미기록=배치)
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

  // 레인 = 탐색(내비게이션) 전용. 누르거나 끌어서 재생 위치 이동(글자 시각엔 영향 없음).
  const beginLaneDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const seekAt = (clientX: number) => {
      const el = laneRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      controls.seekTo(viewStart + ratio * (viewEnd - viewStart));
    };
    let raf: number | null = null;
    seekAt(e.clientX);
    const move = (ev: MouseEvent) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => seekAt(ev.clientX));
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (raf) cancelAnimationFrame(raf);
      dragCleanupRef.current = null;
    };
    const up = () => cleanup();
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

  // readout: 현재 활성 글자
  const readoutSyl = syllables[activeSyllableIndex];
  const readoutText = readoutSyl && isStampable(readoutSyl) ? readoutSyl.text.trim() : "—";
  const readoutTime = readoutSyl && readoutSyl.time !== null ? formatTimestamp(readoutSyl.time) : "--:--.--";

  // 활성 줄 글자 진행도
  const glyphTotal = stampableIdx.length;
  const glyphDone = stampableIdx.filter((i) => syllables[i].time !== null).length;

  const ZOOM_LEVELS = [1, 2, 4, 8];
  const setZoomStep = (dir: number) =>
    setZoom((z) => {
      const i = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + dir));
      return ZOOM_LEVELS[i];
    });

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
          {glyphTotal > 0 && (
            <span
              className={`ml-1.5 ${glyphDone === glyphTotal ? "text-emerald-400" : "text-amber-400"}`}
              title={t.charSync.glyphProgress}
            >
              {glyphDone}/{glyphTotal}
            </span>
          )}
        </span>
        <LineDots lines={lines} activeIdx={lineIdx} onSelect={setActiveLineId} />
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

      {/* 활성 줄 — 한 줄 흐름 텍스트 + 글자별 시간 마커 (가로 스크롤) */}
      <div className="overflow-x-auto mb-3">
      <div ref={textRef} className="relative inline-block" style={{ minWidth: "100%" }}>
      <div
        className="text-3xl leading-relaxed select-none"
        style={{ whiteSpace: "pre" }}
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
              data-glyph={i}
              onMouseDown={(e) => beginDrag(i, e)}
              onContextMenu={(e) => { e.preventDefault(); clearGlyph(i); }}
              className={`cursor-pointer transition-colors ${cls}`}
            >
              {s.text}
            </span>
          );
        })}
        {/* 마지막 공백 셀: 여기까지 칠하면(또는 클릭하면) 다음 줄로 */}
        <span
          data-glyph-end="1"
          onClick={() => gotoLine(lineIdx + 1)}
          title={t.charSync.endCell}
          className="inline-block align-middle ml-1 w-8 text-center rounded border border-dashed border-zinc-700 text-zinc-600 text-base cursor-pointer hover:border-indigo-500 hover:text-indigo-300 select-none"
        >
          ↵
        </span>
      </div>

      {/* 글자별 시간 마커: 점선 + 싱크 시각. 겹치면 단계적으로 내리고, 자리가 없으면 라벨 생략(틱만) */}
      {marksHeight > 0 && (
        <div className="relative pointer-events-none" style={{ height: marksHeight }}>
          {marks.map((m) => (
            <div key={m.index} className="absolute top-0" style={{ left: m.x }}>
              <div
                className={`absolute top-0 border-l border-dashed ${m.label ? "border-indigo-400/70" : "border-indigo-400/35"}`}
                style={{ height: m.label ? m.level * MARK_STEP + 4 : MARK_TICK }}
              />
              {m.label && (
                <div
                  className="absolute font-mono text-[10px] text-indigo-300 whitespace-nowrap"
                  style={{ top: m.level * MARK_STEP + 4, transform: "translateX(-50%)" }}
                >
                  {m.time}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 라벨 폭 측정용(숨김) */}
      <span
        ref={measureRef}
        aria-hidden
        className="font-mono text-[10px] whitespace-nowrap"
        style={{ position: "absolute", visibility: "hidden", left: -9999, top: 0 }}
      >
        00:00.00
      </span>

      </div>
      </div>

      {/* 현재 글자 readout + 레인 줌 */}
      <div className="flex items-center justify-between gap-2 text-xs mb-2 px-1">
        <span className="font-mono text-indigo-300">
          {t.charSync.current}: 「{readoutText}」 → {readoutTime}
        </span>
        <div className="flex items-center gap-1 shrink-0 text-zinc-500">
          <span>{t.zoom}</span>
          <button
            onClick={(e) => { setZoomStep(-1); e.currentTarget.blur(); }}
            disabled={zoom <= 1}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-800 hover:text-white disabled:opacity-30 transition-colors"
          >
            −
          </button>
          <span className="font-mono text-zinc-400 w-6 text-center">{zoom}×</span>
          <button
            onClick={(e) => { setZoomStep(1); e.currentTarget.blur(); }}
            disabled={zoom >= 8}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-800 hover:text-white disabled:opacity-30 transition-colors"
          >
            +
          </button>
        </div>
      </div>
      </div>

      {/* 스크럽 레인 */}
      <div
        ref={laneRef}
        onMouseDown={beginLaneDrag}
        className="relative h-10 rounded-lg bg-zinc-950/60 border border-zinc-800 overflow-hidden cursor-pointer mb-1"
      >
        <LaneWaveform bars={waveBars} />
        {syllables.map((s, i) =>
          s.time !== null && isStampable(s) && s.time >= viewStart && s.time <= viewEnd ? (
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
          {formatTimestamp(viewStart)}
        </span>
        <span className="absolute right-1.5 bottom-0.5 text-[10px] text-zinc-600 font-mono pointer-events-none">
          {formatTimestamp(viewEnd)}
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

// 줄 점 네비게이터: lines/활성 줄이 바뀔 때만 갱신 → 재생 중 매 프레임 재렌더 방지
const LineDots = memo(function LineDots({
  lines, activeIdx, onSelect,
}: {
  lines: LrcLine[];
  activeIdx: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-1">
      {lines.map((l, i) => {
        const st = lineSyncState(l);
        const active = i === activeIdx;
        const color =
          st === "done" ? "bg-emerald-500" : st === "partial" ? "bg-amber-500" : "bg-zinc-600";
        return (
          <button
            key={l.id}
            onClick={() => onSelect(l.id)}
            title={`${i + 1}. ${l.text}`}
            className={`shrink-0 rounded-full transition-all ${color} ${
              active ? "w-2.5 h-2.5 ring-2 ring-indigo-400/60" : "w-2 h-2 opacity-70 hover:opacity-100"
            }`}
          />
        );
      })}
    </div>
  );
});

// 파형 막대는 시간 창(window)이 바뀔 때만 갱신 → 재생 중 매 프레임 재렌더 방지
const LaneWaveform = memo(function LaneWaveform({ bars }: { bars: number[] | null }) {
  if (!bars) return null;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${bars.length} 100`}
      preserveAspectRatio="none"
    >
      {bars.map((v, k) => {
        const h = Math.max(1, v * 88);
        return <rect key={k} x={k + 0.1} width={0.8} y={(100 - h) / 2} height={h} fill="#3f3f46" />;
      })}
    </svg>
  );
});
