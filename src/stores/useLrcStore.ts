import { create } from "zustand";
import { LrcDocument, LrcLine, LrcMetadata, LrcSyllable, defaultDocument } from "../types/lrc";
import { parseLrc, serializeLrc, type SyncUnit } from "../utils/lrcParser";
import { serializeSrt, parseSrt } from "../utils/srtConverter";
import { serializeVtt, serializeAss } from "../utils/exportFormats";
import { prepareFileRef, readLyrics, writeLyrics, type FileRef } from "../utils/fileAccess";
import { enqueuePathWrite } from "../utils/pathWriteQueue";
import { runDocumentTransition, confirmDocumentReplacement, cancelDocumentConfirmation, type DocumentIntent } from "../utils/documentTransition";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "./useSettingsStore";

// App Sandbox 보안 스코프 북마크 생성(best-effort) — 크래시 복구 후 파일 접근 권한 복원용.
// 실패해도(구버전 macOS, 권한 문제 등) 조용히 null 반환 — 복구 기능만 못 쓸 뿐 파일 열기 자체는 계속 동작.
async function createBookmark(path: string): Promise<string | null> {
  try {
    return (await invoke<string | null>("create_security_bookmark", { path })) ?? null;
  } catch {
    return null;
  }
}

interface LrcStore {
  doc: LrcDocument;
  _documentSession: number;
  _editRevision: number;
  _openRequest: number;
  _audioSelection: number;
  _saveTarget: number;
  _saveRequest: number;
  requestDocumentTransition: (intent: DocumentIntent) => Promise<"applied" | "cancelled">;
  _lastEditKey: string | null;
  _history: LrcDocument[];
  _future: LrcDocument[];
  undo: () => void;
  redo: () => void;
  audioPath: string | null;
  lrcPath: string | null;
  // App Sandbox 보안 스코프 북마크(base64) — 크래시 복구 스냅샷에 실어 재시작 후 접근 권한 복원용.
  audioBookmark: string | null;
  lrcBookmark: string | null;
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
  stampCurrentLine: (id: string) => void;
  applyOffset: () => void;
  loadFromRawText: (raw: string) => Promise<void>;
  /** 자동 복구: 스냅샷 문서·경로를 통째로 복원(미저장 상태로) */
  restoreDoc: (
    doc: LrcDocument,
    lrcPath: string | null,
    audioPath: string | null,
    lrcBookmark?: string | null,
    audioBookmark?: string | null
  ) => Promise<void>;

  setAudioPath: (path: string | null, bookmark?: string | null) => void;
  refreshFileReference: (kind: "lyrics" | "audio", previous: FileRef, next: FileRef, owner?: { session: number; selection: number; target?: number }) => void;
  openAudio: () => Promise<void>;
  openLrc: () => Promise<void>;
  loadLyricsPath: (path: string, bookmark?: string | null) => Promise<void>;
  // 반환값: 실제로 파일을 썼으면 true, 사용자가 저장 다이얼로그를 취소하면 false
  saveLrc: () => Promise<boolean>;
  // enhanced: 이번 저장에만 적용하는 일회성 override(미지정 시 글자 데이터 있으면 E-LRC)
  saveLrcAs: (format: "lrc" | "srt" | "vtt" | "ass", enhanced?: boolean) => Promise<boolean>;
  newLrc: () => Promise<void>;
  replaceInLines: (find: string, replace: string, caseSensitive: boolean) => number;

  shiftTimeRange: (fromIdx: number, toIdx: number, deltaSeconds: number) => void;
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

export const useLrcStore = create<LrcStore>((baseSet, get) => {
  const set = (update: Partial<LrcStore> | ((state: LrcStore) => Partial<LrcStore>)) => {
    baseSet((state) => {
      const patch = typeof update === "function" ? update(state) : update;
      const changed = patch.doc && patch.doc !== state.doc;
      return { ...patch,
        ...(changed && patch._lastEditKey === undefined ? { _lastEditKey: null } : {}),
        ...(changed && patch._documentSession === undefined ? { _editRevision: state._editRevision + 1 } : {}) };

    });
  };
  const pushHistory = (doc: LrcDocument, editKey: string | null): Pick<LrcStore, "_history" | "_future" | "_lastEditKey"> => {
    const state = get();
    const grouped = editKey !== null && state._lastEditKey === editKey && state._history.length > 0;
    return { _history: grouped ? state._history : [...state._history, doc].slice(-MAX_HISTORY),
      _future: [], _lastEditKey: editKey };
  };
  let audioDialogRequest = 0;
  const recordRecent = () => {
    const { lrcPath, audioPath, lrcBookmark, audioBookmark } = get();
    if (lrcPath || audioPath) useSettingsStore.getState().addRecentFile({ lrcPath, audioPath, lrcBookmark, audioBookmark });
  };
  return ({
  doc: defaultDocument(),
  _documentSession: 0, _editRevision: 0, _openRequest: 0, _audioSelection: 0, _saveTarget: 0, _saveRequest: 0,
  _lastEditKey: null,
  _history: [],
  _future: [],
  audioPath: null,
  lrcPath: null,
  audioBookmark: null,
  lrcBookmark: null,
  currentTime: 0,
  isDirty: false,
  activeLineId: null,
  isPlaying: false,
  duration: 0,
  loopLineId: null,
  setLoopLine: (id) => set({ loopLineId: id }),

  syncMode: "line",
  syncUnit: "char",
  activeSyllableIndex: 0,

  setSyncMode: (m) => set({ syncMode: m }),
  setSyncUnit: (u) => set({ syncUnit: u }),
  setActiveSyllable: (i) => set({ activeSyllableIndex: i }),

  commitSyllables: (lineId, syllables, recordHistory = true) => {
    const { doc } = get();
    const times = syllables.filter((s) => s.time !== null).map((s) => s.time as number);
    const lineTs = times.length > 0 ? Math.min(...times) : null;
    const lines = doc.lines.map((l) =>
      l.id === lineId
        ? { ...l, syllables, timestamp: lineTs !== null ? lineTs : l.timestamp }
        : l
    );
    set({
      ...(recordHistory
        ? pushHistory(doc, null)
        : { _lastEditKey: null, _future: [] }),
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  clearLineSyllables: (lineId) => {
    const { doc } = get();
    const lines = doc.lines.map((l) =>
      l.id === lineId ? { ...l, syllables: undefined } : l
    );
    set({
      ...pushHistory(doc, null),
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  undo: () => {
    const { doc, _history, _future } = get();
    if (_history.length === 0) return;
    const prev = _history[_history.length - 1];
    set({
      doc: prev,
      _history: _history.slice(0, -1),
      _future: [doc, ..._future].slice(0, MAX_HISTORY),
      isDirty: true,
    });
  },

  redo: () => {
    const { doc, _history, _future } = get();
    if (_future.length === 0) return;
    const next = _future[0];
    set({
      doc: next,
      _history: [..._history, doc].slice(-MAX_HISTORY),
      _future: _future.slice(1),
      isDirty: true,
    });
  },

  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
  setCurrentTime: (t) => set({ currentTime: t }),

  setActiveLineId: (id) => set({ activeLineId: id }),

  stampAndAdvance: () => {
    const { activeLineId, currentTime, doc } = get();
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

    // 실제 스탬프할 때만 히스토리 기록
    set({
      ...pushHistory(doc, null),
      doc: { ...doc, lines: stamped },
      activeLineId: next ? next.id : activeLineId,
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
    const { doc, isDirty } = get();
    const fields = (Object.keys(meta) as (keyof LrcMetadata)[]).filter((field) => !Object.is(doc.metadata[field], meta[field]));
    if (fields.length === 0) return;
    const editKey = fields.length === 1 ? `metadata:${fields[0]}` : null;
    set({ ...(silent ? { _lastEditKey: null, _future: [] } : pushHistory(doc, editKey)),
      doc: { ...doc, metadata: { ...doc.metadata, ...meta } }, isDirty: silent ? isDirty : true });
  },

  setLines: (lines) => {
    const { doc } = get();
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
  },

  addLine: (text = "") => {
    const { doc } = get();
    set({
      ...pushHistory(doc, null),
      doc: { ...doc, lines: [...doc.lines, { id: genId(), timestamp: null, text }] },
      isDirty: true,
    });
  },

  insertLinesAfter: (afterId, texts) => {
    const newLines = texts.map((t) => ({ id: genId(), timestamp: null as null, text: t }));
    const lastId = newLines[newLines.length - 1].id;
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === afterId);
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, ...newLines);
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
    return lastId;
  },

  addLinesFromSpeechSegments: (segments) => {
    if (segments.length === 0) return 0;
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
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
    return segments.length;
  },

  updateLine: (id, patch) => {
    const { doc } = get();
    const line = doc.lines.find((item) => item.id === id);
    if (!line) return;
    const fields = (Object.keys(patch) as (keyof typeof patch)[]).filter((field) => !Object.is(line[field], patch[field]));
    if (fields.length === 0) return;
    const key = fields.length === 1 && fields[0] === "text" ? `line:${id}:text` : null;
    set({ ...pushHistory(doc, key), doc: { ...doc, lines: doc.lines.map((item) => item.id === id ? { ...item, ...patch } : item) }, isDirty: true });
  },

  deleteLine: (id) => {
    const { doc, activeLineId, loopLineId } = get();
    const lines = doc.lines.filter((l) => l.id !== id);
    const newActiveLineId = activeLineId === id ? (lines[0]?.id ?? null) : activeLineId;
    set({
      ...pushHistory(doc, null), doc: { ...doc, lines },
      activeLineId: newActiveLineId, loopLineId: loopLineId === id ? null : loopLineId, isDirty: true,
    });
  },

  duplicateLine: (id) => {
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    const newId = genId();
    // 텍스트만 복제 — 타임스탬프/글자 동기화는 비워 중복 시각을 만들지 않음
    const copy: LrcLine = { id: newId, timestamp: null, text: doc.lines[idx].text };
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, copy);
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
    return newId;
  },

  mergeLineUp: (id) => {
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx <= 0) return null;
    const prev = doc.lines[idx - 1];
    const cur = doc.lines[idx];
    const sep = prev.text && cur.text ? " " : "";
    // 이전 줄 타임스탬프 유지, 텍스트 결합, 글자 동기화는 무효화(텍스트 변경)
    const merged: LrcLine = { ...prev, text: prev.text + sep + cur.text, syllables: undefined };
    const lines = [...doc.lines];
    lines.splice(idx - 1, 2, merged);
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, activeLineId: prev.id, isDirty: true });
    return prev.id;
  },

  splitLine: (id, caretPos) => {
    const { doc } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    const cur = doc.lines[idx];
    const newId = genId();
    // 앞부분: 타임스탬프 유지 / 뒷부분: 새 줄(타임스탬프 없음). 둘 다 글자 동기화 무효화
    const first: LrcLine = { ...cur, text: cur.text.slice(0, caretPos), syllables: undefined };
    const second: LrcLine = { id: newId, timestamp: null, text: cur.text.slice(caretPos) };
    const lines = [...doc.lines];
    lines.splice(idx, 1, first, second);
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, activeLineId: newId, isDirty: true });
    return newId;
  },

  moveLine: (fromIndex, toIndex) => {
    const { doc } = get();
    const n = doc.lines.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) return;
    const lines = [...doc.lines];
    const [moved] = lines.splice(fromIndex, 1);
    lines.splice(toIndex, 0, moved);
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
  },

  scaleTimestamps: (factor) => {
    if (!(factor > 0) || factor === 1) return;
    const { doc } = get();
    const sc = (t: number | null) => (t !== null ? Math.max(0, Math.round(t * factor * 1000) / 1000) : null);
    const lines = doc.lines.map((l) => ({
      ...l,
      timestamp: sc(l.timestamp),
      syllables: l.syllables?.map((s) => ({ ...s, time: sc(s.time) })),
    }));
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
  },

  deleteLines: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, activeLineId, loopLineId } = get();
    const lines = doc.lines.filter((l) => !idSet.has(l.id));
    const newActiveLineId = activeLineId && idSet.has(activeLineId) ? (lines[0]?.id ?? null) : activeLineId;
    set({
      ...pushHistory(doc, null), doc: { ...doc, lines },
      activeLineId: newActiveLineId, loopLineId: loopLineId && idSet.has(loopLineId) ? null : loopLineId, isDirty: true,
    });
  },

  shiftLines: (ids, delta) => {
    if (delta === 0 || ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc } = get();
    const sh = (t: number | null) => (t !== null ? Math.max(0, Math.round((t + delta) * 1000) / 1000) : null);
    const lines = doc.lines.map((l) =>
      idSet.has(l.id)
        ? { ...l, timestamp: sh(l.timestamp), syllables: l.syllables?.map((s) => ({ ...s, time: sh(s.time) })) }
        : l
    );
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
  },

  clearTimestamps: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc } = get();
    const lines = doc.lines.map((l) => (idSet.has(l.id) ? { ...l, timestamp: null, syllables: undefined } : l));
    set({ ...pushHistory(doc, null), doc: { ...doc, lines }, isDirty: true });
  },

  stampCurrentLine: (id) => {
    const { currentTime, doc } = get();
    set({ ...pushHistory(doc, null) });
    set({
      doc: {
        ...doc,
        lines: doc.lines.map((l) =>
          l.id === id ? { ...l, timestamp: currentTime } : l
        ),
      },
      isDirty: true,
    });
  },

  loadFromRawText: async (text) => { await get().requestDocumentTransition({ kind: "raw", text }); },
  restoreDoc: async (doc, lrcPath, audioPath, lrcBookmark = null, audioBookmark = null) => {
    await get().requestDocumentTransition({ kind: "recovery", doc,
      lyrics: lrcPath ? { path: lrcPath, bookmark: lrcBookmark } : null,
      audio: audioPath ? { path: audioPath, bookmark: audioBookmark } : null });
  },

  applyOffset: () => {
    const { doc } = get();
    const deltaSeconds = doc.metadata.offset / 1000;
    if (deltaSeconds === 0) return; // 변화 없음 → 히스토리 기록 안 함(빈 undo 방지)
    set({ ...pushHistory(doc, null) });
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

  refreshFileReference: (kind, previous, next, owner) => {
    const current = get();
    const pathKey = kind === "audio" ? "audioPath" : "lrcPath";
    const bookmarkKey = kind === "audio" ? "audioBookmark" : "lrcBookmark";
    if (owner?.target !== undefined && kind === "lyrics" && current._saveTarget !== owner.target) return;
    if (owner && (current._documentSession !== owner.session ||
        (kind === "audio" && current._audioSelection !== owner.selection))) return;
    if (current[pathKey] !== previous.path ||
        current[bookmarkKey] !== previous.bookmark) return;
    if (previous.path === next.path && previous.bookmark === next.bookmark) return;
    set({ [pathKey]: next.path, [bookmarkKey]: next.bookmark });
    useSettingsStore.setState((settings) => ({
      recentFiles: settings.recentFiles.map((entry) =>
        entry[pathKey] === previous.path && entry[bookmarkKey] === previous.bookmark
          ? { ...entry, [pathKey]: next.path, [bookmarkKey]: next.bookmark }
          : entry),
    }));
  },

  setAudioPath: (path, bookmark = null) => {
    const selection = get()._audioSelection + 1;
    const session = get()._documentSession;
    set({ audioPath: path, audioBookmark: bookmark, _audioSelection: selection });
    recordRecent();
    if (path && !bookmark) {
      createBookmark(path).then((fresh) => {
        get().refreshFileReference("audio", { path, bookmark: null }, { path, bookmark: fresh }, { session, selection });
      });
    }
  },

  openAudio: async () => {
    const request = ++audioDialogRequest;
    const selection = get()._audioSelection;
    const session = get()._documentSession;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"] }],
    });
    if (audioDialogRequest === request && get()._documentSession === session && get()._audioSelection === selection && typeof selected === "string") {
      get().setAudioPath(selected);
    }
  },

  requestDocumentTransition: async (intent) => {
    cancelDocumentConfirmation();
    const request = get()._openRequest + 1;
    const audioSelection = get()._audioSelection;
    set({ _openRequest: request });
    return runDocumentTransition({
      snapshot: () => ({ session: get()._documentSession, revision: get()._editRevision, dirty: !(intent.kind === "recent" && !intent.entry.lrcPath) && get().isDirty }),
      isCurrent: () => get()._openRequest === request &&
        (!(intent.kind === "recent" || (intent.kind === "file" && intent.audio !== undefined)) || get()._audioSelection === audioSelection),
      confirm: confirmDocumentReplacement,
      save: () => get().saveLrc(),
      prepare: async () => {
        let doc: LrcDocument;
        let lyrics: FileRef | null = null;
        let audio: FileRef | null | undefined;
        let dirty = false;
        if (intent.kind === "file" || intent.kind === "recent") {
          const file = intent.kind === "file" ? intent.file
            : intent.entry.lrcPath ? { path: intent.entry.lrcPath, bookmark: intent.entry.lrcBookmark } : null;
          if (file) {
            const result = await readLyrics(file);
            lyrics = result.file;
            doc = /\.srt$/i.test(lyrics.path) ? parseSrt(result.value) : parseLrc(result.value);
          } else { doc = get().doc; dirty = get().isDirty; lyrics = get().lrcPath ? { path: get().lrcPath!, bookmark: get().lrcBookmark } : null; }
          const selectedAudio = intent.kind === "file" ? intent.audio
            : intent.entry.audioPath ? { path: intent.entry.audioPath, bookmark: intent.entry.audioBookmark } : null;
          audio = selectedAudio ? await prepareFileRef(selectedAudio) : selectedAudio;
        } else if (intent.kind === "recovery") {
          doc = intent.doc; dirty = true;
          // Recovery content remains useful even if a persistent grant expires.
          const restore = async (file: FileRef | null) => file ? prepareFileRef(file) : null;
          lyrics = await restore(intent.lyrics).catch(() => null);
          audio = await restore(intent.audio).catch(() => null);
        } else if (intent.kind === "new") doc = defaultDocument();
        else {
          doc = parseLrc(intent.text); dirty = true;
          lyrics = get().lrcPath ? { path: get().lrcPath!, bookmark: get().lrcBookmark } : null;
        }
        return { doc, lyrics, audio, dirty };
      },
      apply: ({ doc, lyrics, audio, dirty }) => {
        const previous = get();
        if (intent.kind === "raw") lyrics = previous.lrcPath ? { path: previous.lrcPath, bookmark: previous.lrcBookmark } : null;
        if (intent.kind === "recent" && !intent.entry.lrcPath) {
          get().setAudioPath(audio?.path ?? null, audio?.bookmark ?? null);
          return;
        }
        let id = 1;
        doc = { ...doc, lines: doc.lines.map((line) => ({ ...line, id: String(id++) })) };
        nextId = id;
        const session = previous._documentSession + 1;
        const selection = previous._audioSelection + (audio !== undefined ? 1 : 0);
        const target = previous._saveTarget + 1;
        set({ doc, lrcPath: lyrics?.path ?? null, lrcBookmark: lyrics?.bookmark ?? null,
          ...(audio !== undefined ? { audioPath: audio?.path ?? null, audioBookmark: audio?.bookmark ?? null } : {}),
          _documentSession: session, _editRevision: 0, _audioSelection: selection, _saveTarget: target,
          isDirty: dirty, activeLineId: doc.lines[0]?.id ?? null, loopLineId: null,
          _history: intent.kind === "raw" ? pushHistory(previous.doc, null)._history : [], _future: [] });
        if (intent.kind === "file" || intent.kind === "recent" || intent.kind === "recovery") recordRecent();
        const ensureGrant = (kind: "lyrics" | "audio", file: FileRef | null) => {
          if (file && !file.bookmark) void createBookmark(file.path).then((bookmark) => {
            get().refreshFileReference(kind, file, { ...file, bookmark }, { session, selection, target });
          });
        };
        if (intent.kind !== "new") ensureGrant("lyrics", lyrics);
        ensureGrant("audio", get().audioPath ? { path: get().audioPath!, bookmark: get().audioBookmark } : null);
      },
    });
  },

  loadLyricsPath: async (path, bookmark = null) => {
    await get().requestDocumentTransition({ kind: "file", file: { path, bookmark } });
  },

  // 가사 열기: LRC·SRT 모두 지원.
  openLrc: async () => {
    cancelDocumentConfirmation();
    const request = get()._openRequest + 1;
    set({ _openRequest: request });
    const selected = await open({
      multiple: false,
      filters: [{ name: "Lyrics", extensions: ["lrc", "srt"] }],
    });
    if (get()._openRequest === request && typeof selected === "string") await get().loadLyricsPath(selected);
  },

  saveLrc: async () => {
    set({ _lastEditKey: null });
    const { lrcPath, lrcBookmark, doc, duration, _documentSession: session, _editRevision: revision, _saveTarget: target } = get();
    if (!lrcPath) return get().saveLrcAs("lrc");
    const content = serializeForPath(lrcPath, doc, duration);
    const result = await enqueuePathWrite(lrcPath, () => writeLyrics({ path: lrcPath, bookmark: lrcBookmark }, content));
    if (get()._documentSession === session) {
      get().refreshFileReference("lyrics", { path: lrcPath, bookmark: lrcBookmark }, result.file, { session, selection: get()._audioSelection, target });
      if (get()._editRevision === revision && get()._saveTarget === target) set({ isDirty: false });
    }
    return true;
  },

  saveLrcAs: async (format, enhanced) => {
    set({ _lastEditKey: null });
    const request = get()._saveRequest + 1;
    set({ _saveRequest: request });
    const { doc, duration, _documentSession: session, _editRevision: revision } = get();
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
      if (get()._documentSession !== session || get()._saveRequest !== request) return false;
      const end = duration > 0 ? duration : undefined;
      const content =
        format === "srt" ? serializeSrt(doc, end)
        : format === "vtt" ? serializeVtt(doc, end)
        : format === "ass" ? serializeAss(doc, end)
        : serializeLrc(doc, enhanced ?? true);
      await enqueuePathWrite(path, () => writeLyrics({ path, bookmark: null }, content));
      // 보조 포맷 저장 시엔 작업 파일 경로(lrcPath)·dirty 상태를 바꾸지 않음
      if ((format === "lrc" || format === "srt") && get()._documentSession === session && get()._saveRequest === request) {
        const target = get()._saveTarget + 1;
        set({ lrcPath: path, lrcBookmark: null, _saveTarget: target, isDirty: get()._editRevision !== revision });
        recordRecent();
        createBookmark(path).then((bookmark) => {
          get().refreshFileReference("lyrics", { path, bookmark: null }, { path, bookmark }, { session, selection: get()._audioSelection, target });
        });
      }
      return true;
    }
    return false; // 사용자가 저장 다이얼로그 취소
  },

  newLrc: async () => { await get().requestDocumentTransition({ kind: "new" }); },

  shiftTimeRange: (fromIdx, toIdx, deltaSeconds) => {
    if (deltaSeconds === 0) return;
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
    set({ ...pushHistory(doc, null), doc: { ...doc, lines: newLines }, isDirty: true });
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
    set({ ...pushHistory(doc, null), doc: { ...doc, lines: newLines }, isDirty: true });
    return count;
  },
  });
});
