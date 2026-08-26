import { create } from "zustand";
import { LrcDocument, LrcLine, LrcMetadata, LrcSyllable, defaultDocument } from "../types/lrc";
import { type HistoryEntry, type HistoryLabel } from "../types/history";
import { parseLrc, serializeLrc, type SyncUnit } from "../utils/lrcParser";
import { nearestBeat } from "../utils/bpmDetect";
import { serializeSrt, parseSrt } from "../utils/srtConverter";
import { serializeVtt, serializeAss } from "../utils/exportFormats";
import { toast } from "./useToastStore";
import { useI18nStore } from "./useI18nStore";
import { useSettingsStore } from "./useSettingsStore";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

type AiSyncStatus = "idle" | "running" | "done" | "error";

interface AlignmentResult {
  index: number;
  start: number;
  end: number;
  confidence: number;
}

interface AlignmentProgressEvent {
  status: string;
  message: string;
  percent: number;
}

interface LrcStore {
  doc: LrcDocument;
  _history: HistoryEntry[];
  _future: HistoryEntry[];
  /** 연속된 텍스트/메타데이터 편집을 하나의 undo 단위로 묶기 위한 내부 키.
   *  updateLine/setMetadata만 읽고 쓴다 — 다른 모든 액션은 pushHistory를 통해 null로 리셋된다. */
  _lastEditKey: string | null;
  undo: () => void;
  redo: () => void;
  /** 과거(_history)·현재·미래(_future)를 하나의 타임라인으로 보고 임의 시점으로 이동.
   *  index === _history.length면 현재(무동작), 작으면 undo N회, 크면 redo N회와 동등 */
  jumpToHistory: (index: number) => void;
  audioPath: string | null;
  lrcPath: string | null;
  currentTime: number;
  isDirty: boolean;
  activeLineId: string | null;

  isPlaying: boolean;
  duration: number;
  setIsPlaying: (v: boolean) => void;
  setDuration: (d: number) => void;
  setCurrentTime: (t: number) => void;
  setActiveLineId: (id: string | null) => void;
  stampAndAdvance: () => void;
  goToPreviousLine: () => void;

  // 줄 반복 재생: 재생 위치가 해당 줄 구간(다음 스탬프 줄 또는 끝까지) 끝에 닿으면
  // 줄 시작으로 되돌아감(AudioPlayer의 audioprocess 핸들러에서 처리)
  loopLineId: string | null;
  setLoopLine: (id: string | null) => void;

  // 글자/단어 동기화 (Enhanced LRC) 편집 모드
  syncMode: "line" | "char";
  syncUnit: SyncUnit;
  activeSyllableIndex: number;
  setSyncMode: (m: "line" | "char") => void;
  setSyncUnit: (u: SyncUnit) => void;
  setActiveSyllable: (i: number) => void;
  // 줄의 토큰 전체를 교체. line.timestamp는 최소 토큰 시각으로 동기화.
  // recordHistory=false면 히스토리를 쌓지 않음(칠하기 드래그를 1회 undo로 묶기 위함).
  commitSyllables: (lineId: string, syllables: LrcSyllable[], recordHistory?: boolean) => void;
  // 줄의 글자 동기화 제거(일반 줄로 복귀). line.timestamp는 유지.
  clearLineSyllables: (lineId: string) => void;

  setMetadata: (meta: Partial<LrcMetadata>, silent?: boolean) => void;
  setLines: (lines: LrcLine[]) => void;
  addLine: (text?: string) => void;
  insertLinesAfter: (afterId: string, texts: string[]) => string;
  /** 무음 기반 자동 스팟팅: 감지된 구간마다 빈 텍스트 stamped line을 시간순으로 삽입.
   *  타임스탬프 없는(=아직 안 찍은) 기존 줄은 정렬 기준에서 제외되어 위치가 바뀌지 않음.
   *  반환값: 삽입된 줄 수 */
  addLinesFromSpeechSegments: (segments: { start: number; end: number }[]) => number;
  updateLine: (id: string, patch: Partial<Omit<LrcLine, "id">>) => void;
  deleteLine: (id: string) => void;
  /** 줄 복제(텍스트만, 타임스탬프 없이 바로 아래에). 새 줄 id 반환 */
  duplicateLine: (id: string) => string;
  /** 줄을 이전 줄과 병합(텍스트 결합, 이전 줄 타임스탬프 유지). 병합된 줄 id, 첫 줄이면 null */
  mergeLineUp: (id: string) => string | null;
  /** 커서 위치에서 줄을 둘로 분할. 새(뒤) 줄 id 반환 */
  splitLine: (id: string, caretPos: number) => string;
  /** 줄 순서 이동(드래그 재정렬) */
  moveLine: (fromIndex: number, toIndex: number) => void;
  /** 모든 타임스탬프(+글자 동기화)를 배율로 스케일 — 템포/버전 불일치 보정 */
  scaleTimestamps: (factor: number) => void;
  /** 여러 줄 일괄 삭제 */
  deleteLines: (ids: string[]) => void;
  /** 여러 줄의 타임스탬프(+글자 동기화)를 delta초만큼 이동 */
  shiftLines: (ids: string[], delta: number) => void;
  /** 여러 줄의 타임스탬프·글자 동기화 제거(텍스트 유지) */
  clearTimestamps: (ids: string[]) => void;
  /** ids(비어있으면 전체)의 타임스탬프를 bpm/offsetSec 비트 그리드로 스냅.
   *  스냅으로 실제 이동한 줄은 글자 동기화가 균일 이동이 아니게 되므로 함께 제거 */
  snapLinesToBeatGrid: (ids: string[], bpm: number, offsetSec: number) => void;
  stampCurrentLine: (id: string) => void;
  applyOffset: () => void;
  loadFromRawText: (raw: string) => void;
  /** 자동 복구: 스냅샷 문서·경로를 통째로 복원(미저장 상태로) */
  restoreDoc: (doc: LrcDocument, lrcPath: string | null, audioPath: string | null) => void;

  setAudioPath: (path: string | null) => void;
  openAudio: () => Promise<void>;
  openLrc: () => Promise<void>;
  loadLyricsPath: (path: string) => Promise<void>;
  applyFetchedLyrics: (lrcText: string, meta?: { title: string; artist: string; album: string }) => void;
  // 반환값: 실제로 파일을 썼으면 true, 사용자가 저장 다이얼로그를 취소하면 false
  saveLrc: () => Promise<boolean>;
  // enhanced: 이번 저장에만 적용하는 일회성 override(미지정 시 글자 데이터 있으면 E-LRC)
  saveLrcAs: (format: "lrc" | "srt" | "vtt" | "ass", enhanced?: boolean) => Promise<boolean>;
  newLrc: () => void;
  replaceInLines: (find: string, replace: string, caseSensitive: boolean) => number;
  shiftTimeRange: (fromIdx: number, toIdx: number, deltaSeconds: number) => void;

  // AI Auto Sync
  aiSyncStatus: AiSyncStatus;
  aiSyncMessage: string;
  /** Python progress status code (e.g. "loading_model", "analyzing", "error") */
  aiSyncProgressStatus: string;
  /** lineId → confidence (0–1). null = no AI draft active */
  aiDraftConfidence: Record<string, number> | null;
  runAiSync: (language: string, blankLineOffset: number, useSeparation: boolean, useVad: boolean) => Promise<void>;
  cancelAiSync: () => void;
  clearAiDraft: () => void;
}

let nextId = 1;
const genId = () => String(nextId++);

// 저장 경로의 확장자에 따라 LRC 또는 SRT로 직렬화
function serializeForPath(path: string, doc: LrcDocument, duration: number): string {
  const p = path.toLowerCase();
  const end = duration > 0 ? duration : undefined;
  if (p.endsWith(".srt")) return serializeSrt(doc, end);
  if (p.endsWith(".vtt")) return serializeVtt(doc, end);
  if (p.endsWith(".ass")) return serializeAss(doc, end);
  // 글자/단어 동기화가 있으면 보존(자동 E-LRC), 없으면 일반 LRC로 출력
  return serializeLrc(doc, true);
}

const MAX_HISTORY = 50;

export const useLrcStore = create<LrcStore>((set, get) => {
  // 현재 doc을 히스토리 엔트리로 만들어 _history에 쌓고 _future를 비움.
  // 각 mutating 액션이 실제로 doc을 바꾸기 "직전"에 호출 — pushHistory 이후의 set()으로 새 doc을 반영한다.
  const pushHistory = (label: HistoryLabel, count?: number) => {
    const { doc, _history } = get();
    const entry: HistoryEntry = { doc, timestamp: Date.now(), label, count };
    // 어떤 액션이든 새 히스토리 엔트리를 쌓으면 진행 중이던 텍스트 편집 묶음은 끝난 것으로 침 —
    // updateLine/setMetadata가 자신의 set() 호출로 다시 값을 채워 넣지 않는 한 null로 남는다.
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), entry], _future: [], _lastEditKey: null });
  };

  return {
  doc: defaultDocument(),
  _history: [],
  _future: [],
  _lastEditKey: null,
  audioPath: null,
  lrcPath: null,
  currentTime: 0,
  isDirty: false,
  activeLineId: null,
  isPlaying: false,
  duration: 0,
  loopLineId: null,
  setLoopLine: (id) => set({ loopLineId: id }),

  aiSyncStatus: "idle",
  aiSyncMessage: "",
  aiSyncProgressStatus: "",
  aiDraftConfidence: null,

  syncMode: "line",
  syncUnit: "char",
  activeSyllableIndex: 0,

  setSyncMode: (m) => set({ syncMode: m }),
  setSyncUnit: (u) => set({ syncUnit: u }),
  setActiveSyllable: (i) => set({ activeSyllableIndex: i }),

  commitSyllables: (lineId, syllables, recordHistory = true) => {
    if (recordHistory) pushHistory("commitSyllables");
    const { doc } = get();
    const times = syllables.filter((s) => s.time !== null).map((s) => s.time as number);
    const lineTs = times.length > 0 ? Math.min(...times) : null;
    const lines = doc.lines.map((l) =>
      l.id === lineId
        ? { ...l, syllables, timestamp: lineTs !== null ? lineTs : l.timestamp }
        : l
    );
    set({
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  clearLineSyllables: (lineId) => {
    pushHistory("clearSyllables");
    const { doc } = get();
    const lines = doc.lines.map((l) =>
      l.id === lineId ? { ...l, syllables: undefined } : l
    );
    set({
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  undo: () => {
    const { doc, _history, _future } = get();
    if (_history.length === 0) return;
    const prevEntry = _history[_history.length - 1];
    const futureEntry: HistoryEntry = { doc, timestamp: Date.now(), label: prevEntry.label, count: prevEntry.count };
    set({
      doc: prevEntry.doc,
      _history: _history.slice(0, -1),
      _future: [futureEntry, ..._future].slice(0, MAX_HISTORY),
      isDirty: true,
      _lastEditKey: null,
    });
  },

  redo: () => {
    const { doc, _history, _future } = get();
    if (_future.length === 0) return;
    const nextEntry = _future[0];
    const historyEntry: HistoryEntry = { doc, timestamp: Date.now(), label: nextEntry.label, count: nextEntry.count };
    set({
      doc: nextEntry.doc,
      _history: [..._history, historyEntry].slice(-MAX_HISTORY),
      _future: _future.slice(1),
      isDirty: true,
      _lastEditKey: null,
    });
  },

  jumpToHistory: (index) => {
    const { _history } = get();
    const cur = _history.length;
    if (index === cur) return;
    if (index < cur) {
      for (let i = 0; i < cur - index; i++) get().undo();
    } else {
      for (let i = 0; i < index - cur; i++) get().redo();
    }
  },

  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
  setCurrentTime: (t) => set({ currentTime: t }),

  setActiveLineId: (id) => set({ activeLineId: id }),

  stampAndAdvance: () => {
    const { activeLineId, currentTime, doc, aiDraftConfidence } = get();
    const lines = doc.lines;
    if (lines.length === 0) return;

    // 활성 줄이 없으면 선택만(문서 변경 없음 → 히스토리 기록 안 함)
    if (!activeLineId) {
      set({ activeLineId: lines[0].id });
      return;
    }

    const idx = lines.findIndex((l) => l.id === activeLineId);
    const stamped = lines.map((l) =>
      l.id === activeLineId ? { ...l, timestamp: currentTime } : l
    );
    const next = stamped[idx + 1];

    // Remove AI confidence for manually stamped line
    let newConfidence = aiDraftConfidence;
    if (newConfidence && activeLineId in newConfidence) {
      newConfidence = { ...newConfidence };
      delete newConfidence[activeLineId];
    }

    // 실제 스탬프할 때만 히스토리 기록
    pushHistory("stampLine");
    set({
      doc: { ...doc, lines: stamped },
      activeLineId: next ? next.id : activeLineId,
      aiDraftConfidence: newConfidence,
      isDirty: true,
    });
  },

  goToPreviousLine: () => {
    const { activeLineId, doc } = get();
    const lines = doc.lines;
    if (lines.length === 0) return;
    if (!activeLineId) {
      set({ activeLineId: lines[0].id });
      return;
    }
    const idx = lines.findIndex((l) => l.id === activeLineId);
    if (idx > 0) set({ activeLineId: lines[idx - 1].id });
  },

  setMetadata: (meta, silent = false) => {
    // silent 갱신(서비스 자동 동기화 등)은 사용자 편집이 아니므로 undo 대상에서 제외.
    // 사용자 입력은 같은 필드 조합을 연속으로 수정하는 동안(다른 액션이 끼어들기 전까지)
    // 한 번의 undo 단위로 묶는다 — updateLine과 동일한 _lastEditKey 코얼레싱 패턴.
    if (!silent) {
      const key = `meta:${Object.keys(meta).sort().join(",")}`;
      if (get()._lastEditKey !== key) pushHistory("editMetadata");
      set((s) => ({
        doc: { ...s.doc, metadata: { ...s.doc.metadata, ...meta } },
        isDirty: true,
        _lastEditKey: key,
      }));
    } else {
      set((s) => ({ doc: { ...s.doc, metadata: { ...s.doc.metadata, ...meta } } }));
    }
  },

  setLines: (lines) => {
    pushHistory("setLines");
    const { doc } = get();
    set({ doc: { ...doc, lines }, isDirty: true });
  },

  addLine: (text = "") => {
    pushHistory("addLine");
    const { doc } = get();
    set({
      doc: { ...doc, lines: [...doc.lines, { id: genId(), timestamp: null, text }] },
      isDirty: true,
    });
  },

  insertLinesAfter: (afterId, texts) => {
    const newLines = texts.map((t) => ({ id: genId(), timestamp: null as null, text: t }));
    const lastId = newLines[newLines.length - 1].id;
    pushHistory("insertLines");
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === afterId);
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, ...newLines);
    set({ doc: { ...doc, lines }, isDirty: true });
    return lastId;
  },

  addLinesFromSpeechSegments: (segments) => {
    if (segments.length === 0) return 0;
    pushHistory("addLinesFromSpeech");
    const { doc } = get();
    let lines = doc.lines;
    for (const seg of segments) {
      const ts = Math.round(seg.start * 1000) / 1000;
      const newLine: LrcLine = { id: genId(), timestamp: ts, text: "" };
      // 이미 타임스탬프가 찍힌 줄만 정렬 기준으로 삼음 — 미입력 줄은 건너뛰어 위치 유지
      const idx = lines.findIndex((l) => l.timestamp !== null && (l.timestamp as number) > ts);
      const insertAt = idx === -1 ? lines.length : idx;
      lines = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
    }
    set({ doc: { ...doc, lines }, isDirty: true });
    return segments.length;
  },

  updateLine: (id, patch) => {
    // 매 키 입력마다 호출되므로, 같은 줄의 같은 필드를 연속으로 고치는 동안은(다른 액션이
    // 끼어들기 전까지) 한 번의 undo 단위로 묶는다 — 글자 하나마다 undo가 쌓이는 걸 방지.
    const key = `${id}:${Object.keys(patch).sort().join(",")}`;
    if (get()._lastEditKey !== key) pushHistory("editText");
    set((s) => ({
      doc: {
        ...s.doc,
        lines: s.doc.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      },
      isDirty: true,
      _lastEditKey: key,
    }));
  },

  deleteLine: (id) => {
    pushHistory("deleteLine");
    const { doc, activeLineId, loopLineId } = get();
    const lines = doc.lines.filter((l) => l.id !== id);
    const newActiveLineId = activeLineId === id ? (lines[0]?.id ?? null) : activeLineId;
    set({
      doc: { ...doc, lines },
      activeLineId: newActiveLineId, loopLineId: loopLineId === id ? null : loopLineId, isDirty: true,
    });
  },

  duplicateLine: (id) => {
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    pushHistory("duplicateLine");
    const newId = genId();
    // 텍스트만 복제 — 타임스탬프/글자 동기화는 비워 중복 시각을 만들지 않음
    const copy: LrcLine = { id: newId, timestamp: null, text: doc.lines[idx].text };
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, copy);
    set({ doc: { ...doc, lines }, isDirty: true });
    return newId;
  },

  mergeLineUp: (id) => {
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx <= 0) return null;
    pushHistory("mergeLine");
    const prev = doc.lines[idx - 1];
    const cur = doc.lines[idx];
    const sep = prev.text && cur.text ? " " : "";
    // 이전 줄 타임스탬프 유지, 텍스트 결합, 글자 동기화는 무효화(텍스트 변경)
    const merged: LrcLine = { ...prev, text: prev.text + sep + cur.text, syllables: undefined };
    const lines = [...doc.lines];
    lines.splice(idx - 1, 2, merged);
    set({ doc: { ...doc, lines }, activeLineId: prev.id, isDirty: true });
    return prev.id;
  },

  splitLine: (id, caretPos) => {
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    pushHistory("splitLine");
    const cur = doc.lines[idx];
    const newId = genId();
    // 앞부분: 타임스탬프 유지 / 뒷부분: 새 줄(타임스탬프 없음). 둘 다 글자 동기화 무효화
    const first: LrcLine = { ...cur, text: cur.text.slice(0, caretPos), syllables: undefined };
    const second: LrcLine = { id: newId, timestamp: null, text: cur.text.slice(caretPos) };
    const lines = [...doc.lines];
    lines.splice(idx, 1, first, second);
    set({ doc: { ...doc, lines }, activeLineId: newId, isDirty: true });
    return newId;
  },

  moveLine: (fromIndex, toIndex) => {
    const { doc } = get();
    const n = doc.lines.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) return;
    pushHistory("moveLine");
    const lines = [...doc.lines];
    const [moved] = lines.splice(fromIndex, 1);
    lines.splice(toIndex, 0, moved);
    set({ doc: { ...doc, lines }, isDirty: true });
  },

  scaleTimestamps: (factor) => {
    if (!(factor > 0) || factor === 1) return;
    pushHistory("scaleTimestamps");
    const { doc } = get();
    const sc = (t: number | null) => (t !== null ? Math.max(0, Math.round(t * factor * 1000) / 1000) : null);
    const lines = doc.lines.map((l) => ({
      ...l,
      timestamp: sc(l.timestamp),
      syllables: l.syllables?.map((s) => ({ ...s, time: sc(s.time) })),
    }));
    set({ doc: { ...doc, lines }, isDirty: true });
  },

  deleteLines: (ids) => {
    if (ids.length === 0) return;
    pushHistory("deleteLines");
    const idSet = new Set(ids);
    const { doc, activeLineId, loopLineId } = get();
    const lines = doc.lines.filter((l) => !idSet.has(l.id));
    const newActiveLineId = activeLineId && idSet.has(activeLineId) ? (lines[0]?.id ?? null) : activeLineId;
    set({
      doc: { ...doc, lines },
      activeLineId: newActiveLineId, loopLineId: loopLineId && idSet.has(loopLineId) ? null : loopLineId, isDirty: true,
    });
  },

  shiftLines: (ids, delta) => {
    if (delta === 0 || ids.length === 0) return;
    pushHistory("shiftLines");
    const idSet = new Set(ids);
    const { doc } = get();
    const sh = (t: number | null) => (t !== null ? Math.max(0, Math.round((t + delta) * 1000) / 1000) : null);
    const lines = doc.lines.map((l) =>
      idSet.has(l.id)
        ? { ...l, timestamp: sh(l.timestamp), syllables: l.syllables?.map((s) => ({ ...s, time: sh(s.time) })) }
        : l
    );
    set({ doc: { ...doc, lines }, isDirty: true });
  },

  clearTimestamps: (ids) => {
    if (ids.length === 0) return;
    pushHistory("clearTimestamps");
    const idSet = new Set(ids);
    const { doc } = get();
    const lines = doc.lines.map((l) => (idSet.has(l.id) ? { ...l, timestamp: null, syllables: undefined } : l));
    set({ doc: { ...doc, lines }, isDirty: true });
  },

  snapLinesToBeatGrid: (ids, bpm, offsetSec) => {
    if (!(bpm > 0)) return;
    const { doc } = get();
    const idSet = ids.length > 0 ? new Set(ids) : null;
    let changed = false;
    const lines = doc.lines.map((l) => {
      if (l.timestamp === null) return l;
      if (idSet && !idSet.has(l.id)) return l;
      const snapped = nearestBeat(l.timestamp, bpm, offsetSec);
      if (snapped === l.timestamp) return l;
      changed = true;
      // 스냅은 줄마다 비균일하게 이동하므로 기존 글자 동기화 토큰 시각은 더 이상 유효하지 않음
      return { ...l, timestamp: snapped, syllables: undefined };
    });
    if (!changed) return;
    pushHistory("snapBeatGrid");
    set({ doc: { ...doc, lines }, isDirty: true });
  },

  stampCurrentLine: (id) => {
    pushHistory("stampLine");
    const { currentTime, doc, aiDraftConfidence } = get();
    let newConfidence = aiDraftConfidence;
    if (newConfidence && id in newConfidence) {
      newConfidence = { ...newConfidence };
      delete newConfidence[id];
    }
    set({
      doc: {
        ...doc,
        lines: doc.lines.map((l) =>
          l.id === id ? { ...l, timestamp: currentTime } : l
        ),
      },
      aiDraftConfidence: newConfidence,
      isDirty: true,
    });
  },

  loadFromRawText: (raw) => {
    pushHistory("loadDoc");
    const parsed = parseLrc(raw);
    let id = nextId;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = parsed.lines[0]?.id ?? null;
    set({ doc: parsed, activeLineId: firstId, loopLineId: null, isDirty: true, _lastEditKey: null });
  },

  restoreDoc: (doc, lrcPath, audioPath) => {
    // 줄 id를 새로 부여해 nextId 카운터와 충돌 없게 함
    let id = 1;
    const lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    set({
      doc: { ...doc, lines },
      lrcPath,
      audioPath,
      activeLineId: lines[0]?.id ?? null,
      loopLineId: null,
      isDirty: true, // 복구된 작업은 아직 미저장
      _history: [],
      _future: [],
      _lastEditKey: null,
    });
  },

  applyOffset: () => {
    const { doc } = get();
    const deltaSeconds = doc.metadata.offset / 1000;
    if (deltaSeconds === 0) return; // 변화 없음 → 히스토리 기록 안 함(빈 undo 방지)
    pushHistory("applyOffset");
    set({
      doc: {
        ...doc,
        metadata: { ...doc.metadata, offset: 0 },
        lines: doc.lines.map((l) => ({
          ...l,
          timestamp: l.timestamp !== null
            ? Math.max(0, l.timestamp + deltaSeconds)
            : null,
          // 글자 동기화 토큰 시각도 함께 이동
          syllables: l.syllables?.map((s) => ({
            ...s,
            time: s.time !== null ? Math.max(0, s.time + deltaSeconds) : null,
          })),
        })),
      },
      isDirty: true,
    });
  },

  setAudioPath: (path) => {
    set({ audioPath: path });
    if (path) useSettingsStore.getState().addRecentFile({ audioPath: path, lrcPath: get().lrcPath });
  },

  openAudio: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"] }],
    });
    if (typeof selected === "string") get().setAudioPath(selected);
  },

  // 경로로 가사 로드 (확장자로 LRC/SRT 분기). 다이얼로그/드래그앤드롭 공용.
  loadLyricsPath: async (path) => {
    const content: string = await invoke("read_lrc_file", { path });
    const isSrt = path.split(".").pop()?.toLowerCase() === "srt";
    const doc = isSrt ? parseSrt(content) : parseLrc(content);
    let id = 1;
    doc.lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = doc.lines[0]?.id ?? null;
    set({ doc, lrcPath: path, isDirty: false, activeLineId: firstId, loopLineId: null, _history: [], _future: [], _lastEditKey: null });
    useSettingsStore.getState().addRecentFile({ lrcPath: path, audioPath: get().audioPath });
  },

  // LRCLIB 등 외부에서 가져온 가사 적용. 라인은 교체하되 메타데이터는 보존:
  // 이미 입력된 title/artist/album은 그대로 두고, 비어 있는 필드만 결과로 채운다.
  // (by/offset도 보존). 로컬 파일 무관 → lrcPath 비움.
  applyFetchedLyrics: (lrcText, meta) => {
    const parsed = parseLrc(lrcText);
    let id = 1;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const current = get().doc.metadata;
    const metadata = meta
      ? {
          ...current,
          title: current.title.trim() || meta.title,
          artist: current.artist.trim() || meta.artist,
          album: current.album.trim() || meta.album,
        }
      : current;
    const firstId = parsed.lines[0]?.id ?? null;
    set({
      doc: { ...parsed, metadata },
      lrcPath: null,
      isDirty: true,
      activeLineId: firstId,
      loopLineId: null,
      _history: [],
      _future: [],
      _lastEditKey: null,
    });
  },

  // 가사 열기: LRC·SRT 모두 지원.
  openLrc: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Lyrics", extensions: ["lrc", "srt"] }],
    });
    if (typeof selected === "string") await get().loadLyricsPath(selected);
  },

  saveLrc: async () => {
    const { lrcPath, doc, duration } = get();
    if (!lrcPath) return get().saveLrcAs("lrc");
    await invoke("write_lrc_file", { path: lrcPath, content: serializeForPath(lrcPath, doc, duration) });
    set({ isDirty: false });
    return true;
  },

  saveLrcAs: async (format, enhanced) => {
    const { doc, duration } = get();
    const FILTERS: Record<string, { name: string; extensions: string[] }> = {
      lrc: { name: "LRC", extensions: ["lrc"] },
      srt: { name: "SubRip", extensions: ["srt"] },
      vtt: { name: "WebVTT", extensions: ["vtt"] },
      ass: { name: "Advanced SubStation Alpha", extensions: ["ass"] },
    };
    const path = await save({
      filters: [FILTERS[format]],
      defaultPath: doc.metadata.title || "untitled",
    });
    if (path) {
      const end = duration > 0 ? duration : undefined;
      const content =
        format === "srt" ? serializeSrt(doc, end)
        : format === "vtt" ? serializeVtt(doc, end)
        : format === "ass" ? serializeAss(doc, end)
        : serializeLrc(doc, enhanced ?? true);
      await invoke("write_lrc_file", { path, content });
      // 보조 포맷 저장 시엔 작업 파일 경로(lrcPath)·dirty 상태를 바꾸지 않음
      if (format === "lrc" || format === "srt") set({ lrcPath: path, isDirty: false });
      return true;
    }
    return false; // 사용자가 저장 다이얼로그 취소
  },

  newLrc: () =>
    set({ doc: defaultDocument(), lrcPath: null, isDirty: false, activeLineId: null, loopLineId: null, _history: [], _future: [], _lastEditKey: null }),

  shiftTimeRange: (fromIdx, toIdx, deltaSeconds) => {
    if (deltaSeconds === 0) return;
    pushHistory("shiftTimeRange");
    const { doc } = get();
    const newLines = doc.lines.map((l, i) => {
      if (i < fromIdx || i > toIdx || l.timestamp === null) return l;
      return {
        ...l,
        timestamp: Math.max(0, l.timestamp + deltaSeconds),
        syllables: l.syllables?.map((s) => ({
          ...s,
          time: s.time !== null ? Math.max(0, s.time + deltaSeconds) : null,
        })),
      };
    });
    set({ doc: { ...doc, lines: newLines }, isDirty: true });
  },

  replaceInLines: (find, replace, caseSensitive) => {
    if (!find) return 0;
    const { doc } = get();
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, caseSensitive ? "g" : "gi");
    let count = 0;
    const newLines = doc.lines.map((l) => {
      const matches = l.text.match(re);
      if (!matches) return l;
      count += matches.length;
      // 텍스트가 바뀌면 옛 토큰 경계가 무효 → 글자 동기화 해제
      return { ...l, text: l.text.replace(re, replace), syllables: undefined };
    });
    if (count === 0) return 0;
    pushHistory("replaceAll", count);
    set({ doc: { ...doc, lines: newLines }, isDirty: true });
    return count;
  },

  runAiSync: async (language, blankLineOffset, useSeparation, useVad) => {
    const { audioPath, doc } = get();
    if (!audioPath) return;

    set({ aiSyncStatus: "running", aiSyncMessage: "" });

    const unlisten = await listen<AlignmentProgressEvent>("alignment-progress", (e) => {
      set({ aiSyncProgressStatus: e.payload.status, aiSyncMessage: e.payload.message });
    });

    try {
      // Only pass non-empty lines to Python; track their original indices
      const nonBlank = doc.lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => line.text.trim() !== "");

      const linesInput = nonBlank.map(({ line, idx }) => ({
        index: idx,
        text: line.text,
      }));

      const resultJson = await invoke<string>("run_alignment", {
        audioPath,
        linesJson: JSON.stringify(linesInput),
        language,
        useSeparation,
        useVad,
      });

      // align.py는 { lines, vocal_segments, separated } 객체를 반환(구버전은 배열).
      const parsed = JSON.parse(resultJson);
      const results: AlignmentResult[] = Array.isArray(parsed) ? parsed : parsed.lines;
      const vocalSegments: [number, number][] = Array.isArray(parsed) ? [] : (parsed.vocal_segments ?? []);
      const separated: boolean = Array.isArray(parsed) ? false : !!parsed.separated;
      const byIndex = new Map(results.map((r) => [r.index, r]));

      // 간주 뒤 보컬이 다시 시작하는 지점(분리 스템 VAD). prevEnd 직후 첫 보컬 구간 시작.
      const vocalResumeAfter = (t: number): number | null => {
        if (!separated || vocalSegments.length === 0) return null;
        for (const [s] of vocalSegments) {
          if (s > t + 0.1) return s; // 실제 공백 뒤 재개만(이전 줄 꼬리 제외)
        }
        return null;
      };

      // 정렬된 줄 [start,end]이 보컬 활동 구간과 얼마나 겹치는지(0~1).
      // VAD 없으면 1(페널티 없음). 겹침이 낮으면 보컬 없는 구간에 잘못 찍혔을 가능성.
      const vocalOverlapRatio = (start: number, end: number): number => {
        if (!separated || vocalSegments.length === 0) return 1;
        const dur = Math.max(end - start, 0.05);
        let ov = 0;
        for (const [s, e] of vocalSegments) {
          if (s > end) break; // 정렬되어 있어 조기 종료 가능
          ov += Math.max(0, Math.min(end, e) - Math.max(start, s));
        }
        return Math.max(0, Math.min(1, ov / dur));
      };

      const confidence: Record<string, number> = {};
      const newLines = doc.lines.map((line, idx) => {
        const r = byIndex.get(idx);
        if (r) {
          // VAD 보정: 보컬 활동과 겹침이 낮은 줄(=무보컬 구간 오정렬 의심)은 신뢰도 하향.
          // 타임스탬프는 유지하고 배지 색만 낮춰 "검토 필요"로 표시(자동 이동은 정확성 위험으로 미적용).
          const ratio = vocalOverlapRatio(r.start, r.end);
          const adjusted = r.confidence * (0.4 + 0.6 * ratio);
          confidence[line.id] = Math.round(adjusted * 1000) / 1000;
          // AI가 줄 단위로 재정렬 → 기존 글자 동기화는 무효화
          return { ...line, timestamp: r.start, syllables: undefined };
        }
        return line;
      });

      // 빈 줄(문단 구분선) 타임스탬프 배치:
      //  - 분리 스템 VAD가 있으면 간주 뒤 "보컬 재개 지점"에 정밀 배치
      //  - 없으면(또는 부적합) 이전 줄 end + offset 휴리스틱
      //  항상 다음 비공백 줄 시작을 넘지 않도록 클램프.
      for (let i = 0; i < newLines.length; i++) {
        if (doc.lines[i].text.trim() !== "") continue;
        let prevEnd = 0;
        let nextStart: number | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const r = byIndex.get(j);
          if (r) { prevEnd = r.end; break; }
        }
        for (let j = i + 1; j < newLines.length; j++) {
          const r = byIndex.get(j);
          if (r) { nextStart = r.start; break; }
        }
        const resume = vocalResumeAfter(prevEnd);
        const useResume = resume !== null && (nextStart === null || resume < nextStart);
        const desired = useResume ? (resume as number) : prevEnd + blankLineOffset;
        const ts = nextStart !== null ? Math.min(desired, nextStart) : desired;
        newLines[i] = { ...newLines[i], timestamp: Math.round(ts * 1000) / 1000 };
        confidence[doc.lines[i].id] = 1.0;
      }

      pushHistory("aiSync");
      set({
        doc: { ...doc, lines: newLines },
        aiSyncStatus: "done",
        aiSyncProgressStatus: "done",
        aiDraftConfidence: confidence,
        isDirty: true,
      });
      toast.success(useI18nStore.getState().t.toast.aiSyncDone);
    } catch (err) {
      const msg = String(err);
      if (msg === "cancelled") {
        set({ aiSyncStatus: "idle", aiSyncMessage: "", aiSyncProgressStatus: "" });
      } else {
        set({ aiSyncStatus: "error", aiSyncProgressStatus: "error", aiSyncMessage: msg });
        toast.error(useI18nStore.getState().t.toast.aiSyncFailed);
      }
    } finally {
      unlisten();
    }
  },

  cancelAiSync: () => {
    invoke("cancel_alignment").catch(() => {});
  },

  clearAiDraft: () => set({ aiDraftConfidence: null }),
  };
});
