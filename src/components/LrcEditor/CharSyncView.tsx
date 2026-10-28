import { LineNavigator as LineDots } from "./LineNavigator";
import { ClearGlyphTimings } from "./ClearGlyphTimings";
import { WaveformViewMenu } from "./WaveformViewMenu";
import { getLinePlaybackRange } from "../../utils/linePlaybackRange";
import { CharWaveformPanel } from "./CharWaveformPanel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useDeviceStore } from "../../stores/useDeviceStore";
import { tokenizeText, isStampable, formatTimestamp, clampToNeighbors } from "../../utils/lrcParser";
import { anyModalOpen } from "../../utils/modalGuard";
import { isInteractiveKeyTarget, keyLabel, matchAction, normalizeKeybindings } from "../../utils/keybindings";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import { deviceControls } from "../../utils/deviceControls";
import type { LrcLine, LrcSyllable } from "../../types/lrc";

// 줄 타임스탬프가 없을 때 글자를 펼칠 기본 시간 창(초)
const DEFAULT_SPAN = 8;

const MIN_LANE_SPAN = 2;

type LaneContext = {
  audioPath: string | null;
  activeLineId: string | null;
  lines: LrcLine[];
  duration: number;
  controlSource: string;
  controlIdentity: string;
  zoom: number;
};
type LanePreview = LaneContext & { time: number; start: number; end: number };
type LaneDrag = LanePreview & {
  pointerId: number;
  clientX: number;
  seekTo: (seconds: number) => void;
  raf: number | null;
};


function getLaneViewRange(
  start: number,
  end: number,
  duration: number,
  currentTime: number,
  zoom: number,
) {
  const trackEnd = duration > 0 ? duration : Infinity;
  const rangeStart = Math.min(trackEnd, Math.max(0, start));
  const rangeEnd = Math.min(trackEnd, Math.max(rangeStart, end));
  const rangeSpan = rangeEnd - rangeStart;
  const displaySpan = Math.min(trackEnd, Math.max(MIN_LANE_SPAN, rangeSpan));
  const zoomSpan = displaySpan / Math.max(1, zoom);
  // Only track boundaries stop scrolling; lyric boundaries define width, not position.
  const maxZoomStart = Number.isFinite(trackEnd) ? Math.max(0, trackEnd - zoomSpan) : Infinity;
  const viewStart = Math.min(maxZoomStart, Math.max(0, currentTime - zoomSpan / 2));
  return { start: viewStart, end: viewStart + zoomSpan };
}

export function CharSyncView({ onOpenShortcuts }: { onOpenShortcuts?: () => void } = {}) {
  const doc = useLrcStore((s) => s.doc);
  const activeLineId = useLrcStore((s) => s.activeLineId);
  const setActiveLineId = useLrcStore((s) => s.setActiveLineId);
  const localCurrentTime = useLrcStore((s) => s.currentTime);
  const localIsPlaying = useLrcStore((s) => s.isPlaying);
  const localDuration = useLrcStore((s) => s.duration);
  const loopLineId = useLrcStore((s) => s.loopLineId);
  const setLoopLine = useLrcStore((s) => s.setLoopLine);
  const audioPath = useLrcStore((s) => s.audioPath);
  const syncUnit = useLrcStore((s) => s.syncUnit);
  const syncMode = useLrcStore((s) => s.syncMode);
  const documentSession = useLrcStore((s) => s._documentSession);
  const activeSyllableIndex = useLrcStore((s) => s.activeSyllableIndex);
  const setActiveSyllable = useLrcStore((s) => s.setActiveSyllable);
  const commitSyllables = useLrcStore((s) => s.commitSyllables);
  const { t } = useI18nStore();
  const spotifyMode = useSettingsStore((s) => s.spotifyMode);
  const lyricsFontScale = useSettingsStore((s) => s.lyricsFontScale);
  const showGlyphTimeMarkers = useSettingsStore((s) => s.showGlyphTimeMarkers);
  const deviceMode = useSettingsStore((s) => s.deviceMode);
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  const serviceTrackUri = useServiceStore((s) => s.trackUri);
  const serviceDeviceId = useServiceStore((s) => s.deviceId);
  const servicePosition = useServiceStore((s) => s.positionMs / 1000);
  const serviceIsPlaying = useServiceStore((s) => s.isPlaying);
  const serviceDuration = useServiceStore((s) => s.durationMs / 1000);
  const deviceCurrentTime = useDeviceStore((s) => s.positionMs / 1000);
  const deviceIsPlaying = useDeviceStore((s) => s.isPlaying);
  const deviceDuration = useDeviceStore((s) => s.durationMs / 1000);
  const deviceIdentity = useDeviceStore((s) => JSON.stringify([
    s.hasSession, s.sourceApp, s.trackName, s.artistName, s.albumName,
  ]));
  const waveformHeight = useSettingsStore(s => s.glyphWaveformHeight);
  const waveformStyle = useSettingsStore(s => s.glyphWaveformStyle);
  const stampKey = keyLabel(normalizeKeybindings(useSettingsStore(s => s.keybindings)).stamp);
  const controls = serviceLoggedIn && spotifyMode ? serviceControls : deviceMode ? deviceControls : audioControls;
  const controlSource = serviceLoggedIn && spotifyMode ? "spotify" : deviceMode ? "device" : "local";
  const currentTime = controlSource === "spotify" ? servicePosition : controlSource === "device" ? deviceCurrentTime : localCurrentTime;
  const isPlaying = controlSource === "spotify" ? serviceIsPlaying : controlSource === "device" ? deviceIsPlaying : localIsPlaying;
  const duration = controlSource === "spotify" ? serviceDuration : controlSource === "device" ? deviceDuration : localDuration;
  const audioSelection = useLrcStore(s => s._audioSelection);
  const controlIdentity = controlSource === "spotify"
    ? `${serviceTrackUri ?? ""}:${serviceDeviceId ?? ""}`
    : controlSource === "device" ? deviceIdentity : `${audioPath ?? ""}:${audioSelection}`;

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
      if (lines[i].timestamp !== null && (line?.timestamp == null || lines[i].timestamp! > line.timestamp)) return lines[i].timestamp;
    }
    return null;
  })();
  const winStart = line?.timestamp ?? prevLineTs ?? 0;
  let winEnd =
    nextLineTs ??
    Math.min(winStart + DEFAULT_SPAN, duration > 0 ? duration : winStart + DEFAULT_SPAN);
  if (winEnd <= winStart) winEnd = winStart + DEFAULT_SPAN;

  const repeatRange = getLinePlaybackRange(lines, activeLineId, duration);
  const canRepeat = !!audioPath && controlSource === "local" && repeatRange !== null;
  const repeatContext = useRef({ audioPath, document: doc.extraTags });
  useEffect(() => {
    const changed = repeatContext.current.audioPath !== audioPath || repeatContext.current.document !== doc.extraTags;
    repeatContext.current = { audioPath, document: doc.extraTags };
    if (loopLineId && (changed || loopLineId !== activeLineId || !canRepeat)) setLoopLine(null);
  }, [audioPath, doc.extraTags, loopLineId, activeLineId, canRepeat, setLoopLine]);

  // Extra tags retain their object identity while glyph stamps update the document.
  // New/imported documents provide a fresh object, so their viewing scale resets.
  const viewSpan = useMemo(() => Math.max(MIN_LANE_SPAN, winEnd - winStart),
    [doc.extraTags, activeLineId, audioPath, duration, controlIdentity, controlSource]);

  // 레인 줌: 창을 1/zoom 너비로 좁혀 재생헤드 중심으로 표시 → 밀집 구간 정밀도↑
  const [zoom, setZoom] = useState(1);
  const [viewAnchor, setViewAnchor] = useState(currentTime);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [lanePreview, setLanePreview] = useState<LanePreview | null>(null);
  const laneDragRef = useRef<LaneDrag | null>(null);
  const laneSeekPendingRef = useRef(false);
  const lanePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousCurrentTimeRef = useRef(currentTime);
  useEffect(() => {
    const anchor = controlSource === "spotify" ? useServiceStore.getState().positionMs / 1000
      : controlSource === "device" ? useDeviceStore.getState().positionMs / 1000
      : useLrcStore.getState().currentTime;
    setZoom(1);
    setViewAnchor(anchor);
  }, [doc.extraTags, activeLineId, audioPath, controlIdentity, controlSource]);
  // Derive the following window in the same render as the playhead to avoid a frame of drift.
  const { start: viewStart, end: viewEnd } = getLaneViewRange(
    0, viewSpan, duration, followPlayback ? currentTime : viewAnchor, zoom,
  );
  const visibleViewStart = lanePreview?.start ?? viewStart;
  const visibleViewEnd = lanePreview?.end ?? viewEnd;


  const discardLanePreview = () => {
    const drag = laneDragRef.current;
    if (drag?.raf != null) cancelAnimationFrame(drag.raf);
    laneDragRef.current = null;
    laneSeekPendingRef.current = false;
    if (lanePreviewTimerRef.current) clearTimeout(lanePreviewTimerRef.current);
    lanePreviewTimerRef.current = null;
    setLanePreview(null);
  };
  const seekWithAnchor = (seconds: number, controller = controls) => {
    discardLanePreview();
    setViewAnchor(seconds);
    controller.seekTo(seconds);
  };

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

  const textRef = useRef<HTMLDivElement>(null);
  const focusGlyphEditor = useCallback(() => textRef.current?.focus({ preventScroll: true }), []);

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

  const glyphGestureContextRef = useRef({
    documentSession, audioSelection, syncUnit, syncMode, controlSource, controlIdentity,
  });
  glyphGestureContextRef.current = {
    documentSession, audioSelection, syncUnit, syncMode, controlSource, controlIdentity,
  };

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
    const settings = useSettingsStore.getState();
    const ctrl = useServiceStore.getState().isLoggedIn && settings.spotifyMode
      ? serviceControls : settings.deviceMode ? deviceControls : audioControls;
    seekWithAnchor(nt, ctrl);
  };

  // ←→=글자 이동(Shift=미세조정, 고정) · stamp/prevLine=사용자 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (isInteractiveKeyTarget(e.target) || isInteractiveKeyTarget(document.activeElement)) return;
      // 모달이 열려 있으면 글자 모드 키가 모달 뒤에서 동작하지 않게 차단
      if (anyModalOpen()) return;
      // 글자 이동/미세조정(고정)
      if (e.code === "ArrowLeft" && e.shiftKey) { e.preventDefault(); nudge(-0.05); return; }
      if (e.code === "ArrowRight" && e.shiftKey) { e.preventDefault(); nudge(0.05); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); moveActive(-1); return; }
      if (e.code === "ArrowRight") { e.preventDefault(); moveActive(1); return; }
      // 사용자 단축키(stamp/prevLine). 수식자 조합 제외.
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

  useEffect(() => () => dragCleanupRef.current?.(), [
    documentSession, audioSelection, syncUnit, syncMode, controlSource, controlIdentity,
  ]);

  useEffect(() => {
    const previewFor = (drag: LaneDrag, time: number): LanePreview => ({
      time,
      start: drag.start,
      end: drag.end,
      audioPath: drag.audioPath,
      activeLineId: drag.activeLineId,
      lines: drag.lines,
      duration: drag.duration,
      controlSource: drag.controlSource,
      controlIdentity: drag.controlIdentity,
      zoom: drag.zoom,
    });
    const positionAt = (drag: LaneDrag, clientX: number) => {
      const lane = laneRef.current;
      if (!lane) return null;
      const rect = lane.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return drag.start + ratio * (drag.end - drag.start);
    };

    const cancelDrag = () => {
      const drag = laneDragRef.current;
      if (drag?.raf !== null && drag?.raf !== undefined) cancelAnimationFrame(drag.raf);
      laneDragRef.current = null;
      laneSeekPendingRef.current = false;
      setLanePreview(null);
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = laneDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.clientX = e.clientX;
      if (drag.raf !== null) return;
      drag.raf = requestAnimationFrame(() => {
        const latest = laneDragRef.current;
        if (!latest || latest.pointerId !== e.pointerId) return;
        latest.raf = null;
        const time = positionAt(latest, latest.clientX);
        if (time !== null) setLanePreview(previewFor(latest, time));
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = laneDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.raf !== null) cancelAnimationFrame(drag.raf);
      const time = positionAt(drag, e.clientX);
      laneDragRef.current = null;
      if (time === null) {
        setLanePreview(null);
        return;
      }

      laneSeekPendingRef.current = true;
      setLanePreview(previewFor(drag, time));
      if (lanePreviewTimerRef.current) clearTimeout(lanePreviewTimerRef.current);
      lanePreviewTimerRef.current = setTimeout(() => {
        lanePreviewTimerRef.current = null;
        laneSeekPendingRef.current = false;
        setLanePreview(null);
      }, 750);
      drag.seekTo(time);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (laneDragRef.current?.pointerId !== e.pointerId) return;
      cancelDrag();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      cancelDrag();
      if (lanePreviewTimerRef.current) clearTimeout(lanePreviewTimerRef.current);
      lanePreviewTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const changed = previousCurrentTimeRef.current !== currentTime;
    previousCurrentTimeRef.current = currentTime;
    if (!laneSeekPendingRef.current || !changed) return;
    setViewAnchor(currentTime);
    laneSeekPendingRef.current = false;
    if (lanePreviewTimerRef.current) clearTimeout(lanePreviewTimerRef.current);
    lanePreviewTimerRef.current = null;
    setLanePreview(null);
  }, [currentTime]);

  useEffect(() => {
    const drag = laneDragRef.current;
    const contextChanged = (item: LaneContext) => (
      item.audioPath !== audioPath ||
      item.activeLineId !== activeLineId ||
      item.lines !== lines ||
      item.duration !== duration ||
      item.controlSource !== controlSource ||
      item.controlIdentity !== controlIdentity ||
      item.zoom !== zoom
    );
    if (drag && contextChanged(drag)) {
      if (drag.raf !== null) cancelAnimationFrame(drag.raf);
      laneDragRef.current = null;
      laneSeekPendingRef.current = false;
      setLanePreview(null);
    } else if (laneSeekPendingRef.current && lanePreview && contextChanged(lanePreview)) {
      laneSeekPendingRef.current = false;
      if (lanePreviewTimerRef.current) clearTimeout(lanePreviewTimerRef.current);
      lanePreviewTimerRef.current = null;
      setLanePreview(null);
    }
  }, [audioPath, activeLineId, lines, duration, controlSource, controlIdentity, zoom, lanePreview]);

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
    if (!line || e.button !== 0 || anyModalOpen()) return; // 좌클릭만 (우클릭은 글자 지우기)
    e.preventDefault();
    textRef.current?.focus({ preventScroll: true });
    const context = { ...glyphGestureContextRef.current, startButton: e.button };
    const startX = e.clientX;
    const startY = e.clientY;
    let painting = false;
    let lastIdx = -1;
    let advancedViaEnd = false;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", onBlur);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const contextIsCurrent = () => {
      const store = useLrcStore.getState();
      const current = glyphGestureContextRef.current;
      return !anyModalOpen() &&
        context.startButton === 0 &&
        store._documentSession === context.documentSession &&
        store._audioSelection === context.audioSelection &&
        store.syncUnit === context.syncUnit &&
        store.syncMode === context.syncMode &&
        current.controlSource === context.controlSource &&
        current.controlIdentity === context.controlIdentity;
    };
    const move = (ev: MouseEvent) => {
      if (ev.buttons === 0 || !contextIsCurrent()) {
        cleanup();
        return;
      }
      if (!painting) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 5) return;
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
    const up = () => {
      if (!contextIsCurrent()) {
        cleanup();
        return;
      }
      cleanup();
      if (!painting) setActiveSyllable(index); // 단순 클릭 = 선택만(찍지 않음)
    };
    const onBlur = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", onBlur);
  };

  // 레인 = 탐색 전용. 드래그 중 미리보기만 움직이고 포인터를 놓을 때 한 번 탐색한다.
  const beginLaneDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.isPrimary === false || e.defaultPrevented || laneDragRef.current) return;
    if (controlSource === "local" && !audioPath) return;
    const lane = laneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(e.clientX)) return;
    e.preventDefault();
    focusGlyphEditor();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = visibleViewStart + ratio * (visibleViewEnd - visibleViewStart);
    if (lanePreviewTimerRef.current) clearTimeout(lanePreviewTimerRef.current);
    lanePreviewTimerRef.current = null;
    laneSeekPendingRef.current = false;
    const drag: LaneDrag = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      time,
      start: visibleViewStart,
      end: visibleViewEnd,
      audioPath,
      activeLineId,
      lines,
      duration,
      controlSource,
      controlIdentity,
      zoom,
      seekTo: controls.seekTo,
      raf: null,
    };
    laneDragRef.current = drag;
    setLanePreview({
      time,
      start: visibleViewStart,
      end: visibleViewEnd,
      audioPath,
      activeLineId,
      lines,
      duration,
      controlSource,
      controlIdentity,
      zoom,
    });
  };

  const replayLine = () => {
    seekWithAnchor(winStart);
    if (!isPlaying) controls.togglePlay();
  };

  // 우클릭: 그 글자의 시각만 제거
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

  // readout: 현재 활성 글자
  const readoutSyl = syllables[activeSyllableIndex];
  const readoutText = readoutSyl && isStampable(readoutSyl) ? readoutSyl.text.trim() : "—";
  const readoutTime = readoutSyl && readoutSyl.time !== null ? formatTimestamp(readoutSyl.time) : "--:--.--";

  // 활성 줄 글자 진행도
  const glyphTotal = stampableIdx.length;
  const glyphDone = stampableIdx.filter((i) => syllables[i].time !== null).length;

  const ZOOM_LEVELS = [1, 2, 4, 8];
  const setZoomStep = (dir: number) => {
    discardLanePreview();
    if (!followPlayback) setViewAnchor(readoutSyl?.time ?? viewAnchor);
    setZoom((z) => {
      const i = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + dir));
      return ZOOM_LEVELS[i];
    });
  };

  const pan = (dir: number) => {
    discardLanePreview();
    setFollowPlayback(false);
    setViewAnchor((visibleViewStart + visibleViewEnd) / 2 + dir * (visibleViewEnd - visibleViewStart) / 2);
  };

  return <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-4 pr-1">
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-[var(--ls-border-subtle)] shrink-0">
      <span className="text-sm text-[var(--ls-text)] shrink-0">{t.charSync.modeChar}</span>
      {onOpenShortcuts && <button type="button" onClick={onOpenShortcuts} className="ls-button ls-button--compact text-xs">{t.charSync.shortcuts}</button>}
      <LineDots lines={lines} activeIdx={lineIdx} onSelect={setActiveLineId} onPointerSelect={focusGlyphEditor} />
      <button type="button" onClick={e => { gotoLine(lineIdx - 1); e.currentTarget.blur(); }} aria-label={t.charSync.prevLine} disabled={lineIdx <= 0}
        className="ls-button ls-button--compact hover:text-white disabled:opacity-30">‹</button>
      <span className="text-xs text-[var(--ls-text-secondary)] font-mono shrink-0">{lineIdx + 1}/{lines.length}</span>
      <button type="button" onClick={e => { gotoLine(lineIdx + 1); e.currentTarget.blur(); }} aria-label={t.charSync.nextLine} disabled={lineIdx >= lines.length - 1}
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
          className={`ls-glyph cursor-pointer px-0.5 transition-colors ${i === activeSyllableIndex ? "ls-glyph--selected" : i === playingIdx ? "ls-glyph--playing" : s.time !== null ? "ls-glyph--timed text-[var(--ls-text)]" : "text-[var(--ls-text-secondary)] hover:text-[var(--ls-text-secondary)]"}`}>
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
        <span className="text-[var(--ls-text-secondary)] font-mono tabular-nums">{t.charSync.displaySpan.replace("{seconds}", String(Number((visibleViewEnd - visibleViewStart).toFixed(2))))}</span>
        <div className="flex items-center flex-wrap gap-1.5">
          <button type="button" aria-label={t.charSync.prevWindow} onClick={e => { pan(-1); e.currentTarget.blur(); }} disabled={visibleViewStart <= 0}
            className="ls-button ls-button--compact disabled:opacity-30">‹</button>
          <button type="button" aria-label={t.zoomOut} onClick={e => { setZoomStep(-1); e.currentTarget.blur(); }} disabled={zoom <= 1}
            className="ls-button ls-button--compact disabled:opacity-30">−</button>
          <span className="text-[var(--ls-text-secondary)] font-mono">{zoom}×</span>
          <button type="button" aria-label={t.zoomIn} onClick={e => { setZoomStep(1); e.currentTarget.blur(); }} disabled={zoom >= 8}
            className="ls-button ls-button--compact disabled:opacity-30">+</button>
          <button type="button" aria-label={t.charSync.nextWindow} onClick={e => { pan(1); e.currentTarget.blur(); }} disabled={duration > 0 && visibleViewEnd >= duration}
            className="ls-button ls-button--compact disabled:opacity-30">›</button>
          <button type="button" aria-pressed={followPlayback} onClick={e => { discardLanePreview(); setFollowPlayback(v => !v); setViewAnchor((visibleViewStart + visibleViewEnd) / 2); e.currentTarget.blur(); }}
            className={`ls-button ls-button--compact ${`  rounded border border-[var(--ls-border-subtle)] ${followPlayback ? "bg-[var(--ls-selection)]/15 text-[var(--ls-accent)]" : "text-[var(--ls-text-secondary)]"}`}`}>{t.charSync.followPlayback}</button>
          <WaveformViewMenu />
        </div>
      </div>
      <CharWaveformPanel laneRef={laneRef} onPointerDown={beginLaneDrag} audioPath={audioPath}
        start={visibleViewStart} end={visibleViewEnd} lineStart={winStart} lineEnd={repeatRange?.end ?? winEnd} playhead={lanePreview?.time ?? currentTime}
        syllables={syllables} activeIndex={activeSyllableIndex} onSelect={index => { setActiveSyllable(index); textRef.current?.focus({ preventScroll: true }); }}
        available={controlSource === "local"} height={waveformHeight} style={waveformStyle} showMarkers={showGlyphTimeMarkers} repeating={loopLineId === line.id && canRepeat} />
      <div className="flex gap-x-3 gap-y-1 flex-wrap justify-between text-xs text-[var(--ls-text-secondary)] mt-2">
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
            else if (canRepeat && repeatRange) { setLoopLine(line.id); seekWithAnchor(repeatRange.start); }
            e.currentTarget.blur();
          }} className={`ls-button ls-button--compact ${`  text-xs rounded-md border border-[var(--ls-border-subtle)] disabled:opacity-30 ${loopLineId === line.id ? "bg-[var(--ls-selection)]/15 text-[var(--ls-accent)]" : "text-[var(--ls-text-secondary)] hover:bg-[var(--ls-control)]"}`}`}>
          {t.charSync.repeatLine} · {loopLineId === line.id ? t.charSync.repeatOn : t.charSync.repeatOff}
        </button>
      </div>
      <button type="button" aria-label={t.charSync.stampHint} onClick={e => { stampActive(); e.currentTarget.blur(); textRef.current?.focus({ preventScroll: true }); }}
        className="ls-button ls-button--primary flex items-center justify-center gap-2 font-medium">
        {t.charSync.stampHint}<kbd className="px-1 py-0.5 border border-white/50 rounded font-mono text-xs">{stampKey}</kbd>
      </button>
    </div>

  </div>;
}
