import { useEffect, useMemo, useRef } from "react";
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

  // Space=찍기, Backspace/←→=이동
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (inInput) return;
      if (e.code === "Space") {
        e.preventDefault();
        stampActive();
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
  const dragPreviewRef = useRef<HTMLSpanElement | null>(null);

  const beginDrag = (index: number, e: React.MouseEvent) => {
    if (!line) return;
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
      if (dragPreviewRef.current) dragPreviewRef.current.textContent = formatTimestamp(tt);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => controls.seekTo(tt));
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (raf) cancelAnimationFrame(raf);
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
    };
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

  if (!line) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-500 text-sm text-center">{t.charSync.empty}</p>
      </div>
    );
  }

  const cur = syllables[activeSyllableIndex];
  const curText = cur && isStampable(cur) ? cur.text.trim() : "—";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 줄 네비게이터 */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-800/60 rounded-lg mb-4">
        <button
          onClick={() => gotoLine(lineIdx - 1)}
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
          onClick={() => gotoLine(lineIdx + 1)}
          disabled={lineIdx >= lines.length - 1}
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors"
        >
          ›
        </button>
      </div>

      <p className="text-xs text-zinc-500 mb-2 px-1">{t.charSync.hint}</p>

      {/* 활성 줄 — 한 줄 흐름 텍스트 */}
      <div
        className="text-3xl leading-relaxed mb-3 px-1 select-none"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {syllables.map((s, i) => {
          if (!isStampable(s)) return <span key={i}>{s.text}</span>;
          const isCurrent = i === activeSyllableIndex;
          const stamped = s.time !== null;
          const cls = isCurrent
            ? "bg-indigo-500 text-white rounded px-0.5"
            : stamped
            ? "text-zinc-100 border-b-2 border-indigo-500/60"
            : "text-zinc-600 hover:text-zinc-400";
          return (
            <span
              key={i}
              onMouseDown={(e) => beginDrag(i, e)}
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
          {t.charSync.current}: 「{curText}」 →{" "}
          <span ref={dragPreviewRef}>
            {cur && cur.time !== null ? formatTimestamp(cur.time) : "--:--.--"}
          </span>
        </span>
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
          onClick={replayLine}
          className="px-3 py-2 text-xs rounded-lg text-zinc-300 border border-zinc-700 hover:bg-zinc-800 hover:text-white transition-colors whitespace-nowrap"
        >
          ↺ {t.charSync.replayLine}
        </button>
        <button
          onClick={clearLine}
          className="px-3 py-2 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-rose-300 transition-colors whitespace-nowrap"
        >
          {t.charSync.clearLine}
        </button>
      </div>
    </div>
  );
}
