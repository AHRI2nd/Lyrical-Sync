import { create } from "zustand";
import { LrcDocument, LrcLine, LrcMetadata, defaultDocument } from "../types/lrc";
import { parseLrc, serializeLrc } from "../utils/lrcParser";
import { serializeSrt, parseSrt } from "../utils/srtConverter";
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
  _history: LrcDocument[];
  _future: LrcDocument[];
  undo: () => void;
  redo: () => void;
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

  setMetadata: (meta: Partial<LrcMetadata>) => void;
  setLines: (lines: LrcLine[]) => void;
  addLine: (text?: string) => void;
  insertLinesAfter: (afterId: string, texts: string[]) => string;
  updateLine: (id: string, patch: Partial<Omit<LrcLine, "id">>) => void;
  deleteLine: (id: string) => void;
  stampCurrentLine: (id: string) => void;
  applyOffset: () => void;
  loadFromRawText: (raw: string) => void;

  setAudioPath: (path: string | null) => void;
  openAudio: () => Promise<void>;
  openLrc: () => Promise<void>;
  saveLrc: () => Promise<void>;
  saveLrcAs: (format: "lrc" | "srt") => Promise<void>;
  newLrc: () => void;
  importSrt: () => Promise<void>;
  replaceInLines: (find: string, replace: string, caseSensitive: boolean) => number;

  // AI Auto Sync
  aiSyncStatus: AiSyncStatus;
  aiSyncMessage: string;
  /** Python progress status code (e.g. "loading_model", "analyzing", "error") */
  aiSyncProgressStatus: string;
  /** lineId → confidence (0–1). null = no AI draft active */
  aiDraftConfidence: Record<string, number> | null;
  runAiSync: (language: string, blankLineOffset: number) => Promise<void>;
  cancelAiSync: () => void;
  clearAiDraft: () => void;
}

let nextId = 1;
const genId = () => String(nextId++);

// 저장 경로의 확장자에 따라 LRC 또는 SRT로 직렬화
function serializeForPath(path: string, doc: LrcDocument, duration: number): string {
  if (path.toLowerCase().endsWith(".srt")) {
    return serializeSrt(doc, duration > 0 ? duration : undefined);
  }
  return serializeLrc(doc);
}

const MAX_HISTORY = 50;

export const useLrcStore = create<LrcStore>((set, get) => ({
  doc: defaultDocument(),
  _history: [],
  _future: [],
  audioPath: null,
  lrcPath: null,
  currentTime: 0,
  isDirty: false,
  activeLineId: null,
  isPlaying: false,
  duration: 0,

  aiSyncStatus: "idle",
  aiSyncMessage: "",
  aiSyncProgressStatus: "",
  aiDraftConfidence: null,

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
    const { activeLineId, currentTime, doc, aiDraftConfidence, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    const lines = doc.lines;
    if (lines.length === 0) return;

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

  setMetadata: (meta) =>
    set((s) => ({
      doc: { ...s.doc, metadata: { ...s.doc.metadata, ...meta } },
      isDirty: true,
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

  stampCurrentLine: (id) => {
    const { currentTime, doc, aiDraftConfidence, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
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
    const { doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    const parsed = parseLrc(raw);
    let id = nextId;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = parsed.lines[0]?.id ?? null;
    set({ doc: parsed, activeLineId: firstId, isDirty: true });
  },

  applyOffset: () => {
    const { doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    const deltaSeconds = doc.metadata.offset / 1000;
    if (deltaSeconds === 0) return;
    set({
      doc: {
        ...doc,
        metadata: { ...doc.metadata, offset: 0 },
        lines: doc.lines.map((l) => ({
          ...l,
          timestamp: l.timestamp !== null
            ? Math.max(0, l.timestamp + deltaSeconds)
            : null,
        })),
      },
      isDirty: true,
    });
  },

  setAudioPath: (path) => set({ audioPath: path }),

  openAudio: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"] }],
    });
    if (typeof selected === "string") {
      set({ audioPath: selected });
    }
  },

  openLrc: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "LRC", extensions: ["lrc"] }],
    });
    if (typeof selected === "string") {
      const content: string = await invoke("read_lrc_file", { path: selected });
      const doc = parseLrc(content);
      let id = 1;
      doc.lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
      nextId = id;
      const firstId = doc.lines[0]?.id ?? null;
      set({ doc, lrcPath: selected, isDirty: false, activeLineId: firstId, _history: [], _future: [] });
    }
  },

  saveLrc: async () => {
    const { lrcPath, doc, duration } = get();
    if (!lrcPath) { await get().saveLrcAs("lrc"); return; }
    await invoke("write_lrc_file", { path: lrcPath, content: serializeForPath(lrcPath, doc, duration) });
    set({ isDirty: false });
  },

  saveLrcAs: async (format) => {
    const { doc, duration } = get();
    const path = await save({
      filters: format === "srt"
        ? [{ name: "SubRip", extensions: ["srt"] }]
        : [{ name: "LRC", extensions: ["lrc"] }],
      defaultPath: doc.metadata.title || "untitled",
    });
    if (path) {
      const content = format === "srt"
        ? serializeSrt(doc, duration > 0 ? duration : undefined)
        : serializeLrc(doc);
      await invoke("write_lrc_file", { path, content });
      set({ lrcPath: path, isDirty: false });
    }
  },

  newLrc: () =>
    set({ doc: defaultDocument(), lrcPath: null, isDirty: false, activeLineId: null, _history: [], _future: [] }),

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
      return { ...l, text: l.text.replace(re, replace) };
    });
    if (count === 0) return 0;
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines: newLines }, isDirty: true });
    return count;
  },

  importSrt: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SubRip", extensions: ["srt"] }],
    });
    if (typeof selected === "string") {
      const content: string = await invoke("read_lrc_file", { path: selected });
      const doc = parseSrt(content);
      let id = 1;
      doc.lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
      nextId = id;
      const firstId = doc.lines[0]?.id ?? null;
      // SRT는 LRC 경로가 아니므로 lrcPath는 비우고 dirty 상태로 둠
      set({ doc, lrcPath: null, isDirty: true, activeLineId: firstId, _history: [], _future: [] });
    }
  },

  runAiSync: async (language, blankLineOffset) => {
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
      });

      const results: AlignmentResult[] = JSON.parse(resultJson);
      const byIndex = new Map(results.map((r) => [r.index, r]));

      const confidence: Record<string, number> = {};
      const newLines = doc.lines.map((line, idx) => {
        const r = byIndex.get(idx);
        if (r) {
          confidence[line.id] = r.confidence;
          return { ...line, timestamp: r.start };
        }
        return line;
      });

      // Set blank-line timestamps = previous non-blank end + offset
      for (let i = 0; i < newLines.length; i++) {
        if (doc.lines[i].text.trim() !== "") continue;
        let prevEnd = 0;
        for (let j = i - 1; j >= 0; j--) {
          const r = byIndex.get(j);
          if (r) { prevEnd = r.end; break; }
        }
        newLines[i] = { ...newLines[i], timestamp: prevEnd + blankLineOffset };
        confidence[doc.lines[i].id] = 1.0;
      }

      const { _history } = get();
      set({
        _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [],
        doc: { ...doc, lines: newLines },
        aiSyncStatus: "done",
        aiSyncProgressStatus: "done",
        aiDraftConfidence: confidence,
        isDirty: true,
      });
    } catch (err) {
      const msg = String(err);
      if (msg === "cancelled") {
        set({ aiSyncStatus: "idle", aiSyncMessage: "", aiSyncProgressStatus: "" });
      } else {
        set({ aiSyncStatus: "error", aiSyncProgressStatus: "error", aiSyncMessage: msg });
      }
    } finally {
      unlisten();
    }
  },

  cancelAiSync: () => {
    invoke("cancel_alignment").catch(() => {});
  },

  clearAiDraft: () => set({ aiDraftConfidence: null }),
}));
