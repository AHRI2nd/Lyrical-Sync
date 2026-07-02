import { create } from "zustand";
import { LrcDocument, LrcLine, LrcMetadata, LrcSyllable, defaultDocument } from "../types/lrc";
import { parseLrc, serializeLrc, type SyncUnit } from "../utils/lrcParser";
import { serializeSrt, parseSrt } from "../utils/srtConverter";
import { serializeVtt, serializeAss } from "../utils/exportFormats";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

// App Sandbox 보안 스코프 북마크 생성(best-effort) — 크래시 복구 후 파일 접근 권한 복원용.
// 실패해도(구버전 macOS, 권한 문제 등) 조용히 null 반환 — 복구 기능만 못 쓸 뿐 파일 열기 자체는 계속 동작.
async function createBookmark(path: string): Promise<string | null> {
  try {
    return await invoke<string>("create_security_bookmark", { path });
  } catch {
    return null;
  }
}

interface LrcStore {
  doc: LrcDocument;
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
  loadFromRawText: (raw: string) => void;
  /** 자동 복구: 스냅샷 문서·경로를 통째로 복원(미저장 상태로) */
  restoreDoc: (
    doc: LrcDocument,
    lrcPath: string | null,
    audioPath: string | null,
    lrcBookmark?: string | null,
    audioBookmark?: string | null
  ) => void;

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

export const useLrcStore = create<LrcStore>((set, get) => ({
  doc: defaultDocument(),
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

  syncMode: "line",
  syncUnit: "char",
  activeSyllableIndex: 0,

  setSyncMode: (m) => set({ syncMode: m }),
  setSyncUnit: (u) => set({ syncUnit: u }),
  setActiveSyllable: (i) => set({ activeSyllableIndex: i }),

  commitSyllables: (lineId, syllables, recordHistory = true) => {
    const { doc, _history } = get();
    const times = syllables.filter((s) => s.time !== null).map((s) => s.time as number);
    const lineTs = times.length > 0 ? Math.min(...times) : null;
    const lines = doc.lines.map((l) =>
      l.id === lineId
        ? { ...l, syllables, timestamp: lineTs !== null ? lineTs : l.timestamp }
        : l
    );
    set({
      ...(recordHistory
        ? { _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] }
        : {}),
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  clearLineSyllables: (lineId) => {
    const { doc, _history } = get();
    const lines = doc.lines.map((l) =>
      l.id === lineId ? { ...l, syllables: undefined } : l
    );
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc],
      _future: [],
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
    const { activeLineId, currentTime, doc, _history } = get();
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
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [],
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

  setMetadata: (meta, silent = false) =>
    set((s) => ({
      doc: { ...s.doc, metadata: { ...s.doc.metadata, ...meta } },
      // silent: 자동 채움 등 사용자 편집이 아닌 갱신은 dirty로 표시하지 않음
      isDirty: silent ? s.isDirty : true,
    })),

  setLines: (lines) => {
    const { doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  addLine: (text = "") => {
    const { doc, _history } = get();
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [],
      doc: { ...doc, lines: [...doc.lines, { id: genId(), timestamp: null, text }] },
      isDirty: true,
    });
  },

  insertLinesAfter: (afterId, texts) => {
    const newLines = texts.map((t) => ({ id: genId(), timestamp: null as null, text: t }));
    const lastId = newLines[newLines.length - 1].id;
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === afterId);
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, ...newLines);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
    return lastId;
  },

  updateLine: (id, patch) =>
    set((s) => ({
      doc: {
        ...s.doc,
        lines: s.doc.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      },
      isDirty: true,
    })),

  deleteLine: (id) => {
    const { doc, _history, activeLineId } = get();
    const lines = doc.lines.filter((l) => l.id !== id);
    const newActiveLineId = activeLineId === id ? (lines[0]?.id ?? null) : activeLineId;
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, activeLineId: newActiveLineId, isDirty: true });
  },

  duplicateLine: (id) => {
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    const newId = genId();
    // 텍스트만 복제 — 타임스탬프/글자 동기화는 비워 중복 시각을 만들지 않음
    const copy: LrcLine = { id: newId, timestamp: null, text: doc.lines[idx].text };
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, copy);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
    return newId;
  },

  mergeLineUp: (id) => {
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx <= 0) return null;
    const prev = doc.lines[idx - 1];
    const cur = doc.lines[idx];
    const sep = prev.text && cur.text ? " " : "";
    // 이전 줄 타임스탬프 유지, 텍스트 결합, 글자 동기화는 무효화(텍스트 변경)
    const merged: LrcLine = { ...prev, text: prev.text + sep + cur.text, syllables: undefined };
    const lines = [...doc.lines];
    lines.splice(idx - 1, 2, merged);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, activeLineId: prev.id, isDirty: true });
    return prev.id;
  },

  splitLine: (id, caretPos) => {
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    const cur = doc.lines[idx];
    const newId = genId();
    // 앞부분: 타임스탬프 유지 / 뒷부분: 새 줄(타임스탬프 없음). 둘 다 글자 동기화 무효화
    const first: LrcLine = { ...cur, text: cur.text.slice(0, caretPos), syllables: undefined };
    const second: LrcLine = { id: newId, timestamp: null, text: cur.text.slice(caretPos) };
    const lines = [...doc.lines];
    lines.splice(idx, 1, first, second);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, activeLineId: newId, isDirty: true });
    return newId;
  },

  moveLine: (fromIndex, toIndex) => {
    const { doc, _history } = get();
    const n = doc.lines.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) return;
    const lines = [...doc.lines];
    const [moved] = lines.splice(fromIndex, 1);
    lines.splice(toIndex, 0, moved);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  scaleTimestamps: (factor) => {
    if (!(factor > 0) || factor === 1) return;
    const { doc, _history } = get();
    const sc = (t: number | null) => (t !== null ? Math.max(0, Math.round(t * factor * 1000) / 1000) : null);
    const lines = doc.lines.map((l) => ({
      ...l,
      timestamp: sc(l.timestamp),
      syllables: l.syllables?.map((s) => ({ ...s, time: sc(s.time) })),
    }));
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  deleteLines: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, _history, activeLineId } = get();
    const lines = doc.lines.filter((l) => !idSet.has(l.id));
    const newActiveLineId = activeLineId && idSet.has(activeLineId) ? (lines[0]?.id ?? null) : activeLineId;
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, activeLineId: newActiveLineId, isDirty: true });
  },

  shiftLines: (ids, delta) => {
    if (delta === 0 || ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, _history } = get();
    const sh = (t: number | null) => (t !== null ? Math.max(0, Math.round((t + delta) * 1000) / 1000) : null);
    const lines = doc.lines.map((l) =>
      idSet.has(l.id)
        ? { ...l, timestamp: sh(l.timestamp), syllables: l.syllables?.map((s) => ({ ...s, time: sh(s.time) })) }
        : l
    );
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  clearTimestamps: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, _history } = get();
    const lines = doc.lines.map((l) => (idSet.has(l.id) ? { ...l, timestamp: null, syllables: undefined } : l));
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  stampCurrentLine: (id) => {
    const { currentTime, doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
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

  loadFromRawText: (raw) => {
    const { doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    const parsed = parseLrc(raw);
    let id = nextId;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = parsed.lines[0]?.id ?? null;
    set({ doc: parsed, activeLineId: firstId, isDirty: true });
  },

  restoreDoc: (doc, lrcPath, audioPath, lrcBookmark = null, audioBookmark = null) => {
    // 줄 id를 새로 부여해 nextId 카운터와 충돌 없게 함
    let id = 1;
    const lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    set({
      doc: { ...doc, lines },
      lrcPath,
      audioPath,
      lrcBookmark,
      audioBookmark,
      activeLineId: lines[0]?.id ?? null,
      isDirty: true, // 복구된 작업은 아직 미저장
      _history: [],
      _future: [],
    });
  },

  applyOffset: () => {
    const { doc, _history } = get();
    const deltaSeconds = doc.metadata.offset / 1000;
    if (deltaSeconds === 0) return; // 변화 없음 → 히스토리 기록 안 함(빈 undo 방지)
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
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
    set({ audioPath: path, audioBookmark: null });
    if (path) {
      createBookmark(path).then((bookmark) => {
        // 그 사이 다른 파일로 바뀌었으면 덮어쓰지 않음
        if (get().audioPath === path) set({ audioBookmark: bookmark });
      });
    }
  },

  openAudio: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"] }],
    });
    if (typeof selected === "string") {
      get().setAudioPath(selected);
    }
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
    set({ doc, lrcPath: path, lrcBookmark: null, isDirty: false, activeLineId: firstId, _history: [], _future: [] });
    createBookmark(path).then((bookmark) => {
      if (get().lrcPath === path) set({ lrcBookmark: bookmark });
    });
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
      lrcBookmark: null,
      isDirty: true,
      activeLineId: firstId,
      _history: [],
      _future: [],
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
      if (format === "lrc" || format === "srt") {
        set({ lrcPath: path, lrcBookmark: null, isDirty: false });
        createBookmark(path).then((bookmark) => {
          if (get().lrcPath === path) set({ lrcBookmark: bookmark });
        });
      }
      return true;
    }
    return false; // 사용자가 저장 다이얼로그 취소
  },

  newLrc: () =>
    set({ doc: defaultDocument(), lrcPath: null, lrcBookmark: null, isDirty: false, activeLineId: null, _history: [], _future: [] }),

  shiftTimeRange: (fromIdx, toIdx, deltaSeconds) => {
    if (deltaSeconds === 0) return;
    const { doc, _history } = get();
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
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines: newLines }, isDirty: true });
  },

  replaceInLines: (find, replace, caseSensitive) => {
    if (!find) return 0;
    const { doc, _history } = get();
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
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines: newLines }, isDirty: true });
    return count;
  },
}));

