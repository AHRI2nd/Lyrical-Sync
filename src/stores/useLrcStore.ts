import { create } from "zustand";
import { LrcDocument, LrcLine, LrcMetadata, defaultDocument } from "../types/lrc";
import { parseLrc, serializeLrc } from "../utils/lrcParser";
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

  openAudio: () => Promise<void>;
  openLrc: () => Promise<void>;
  saveLrc: () => Promise<void>;
  saveLrcAs: () => Promise<void>;
  newLrc: () => void;

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

export const useLrcStore = create<LrcStore>((set, get) => ({
  doc: defaultDocument(),
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

  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
  setCurrentTime: (t) => set({ currentTime: t }),

  setActiveLineId: (id) => set({ activeLineId: id }),

  stampAndAdvance: () => {
    const { activeLineId, currentTime, doc, aiDraftConfidence } = get();
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

  setLines: (lines) =>
    set((s) => ({ doc: { ...s.doc, lines }, isDirty: true })),

  addLine: (text = "") =>
    set((s) => ({
      doc: { ...s.doc, lines: [...s.doc.lines, { id: genId(), timestamp: null, text }] },
      isDirty: true,
    })),

  insertLinesAfter: (afterId, texts) => {
    const newLines = texts.map((t) => ({ id: genId(), timestamp: null as null, text: t }));
    const lastId = newLines[newLines.length - 1].id;
    set((s) => {
      const idx = s.doc.lines.findIndex((l) => l.id === afterId);
      const lines = [...s.doc.lines];
      lines.splice(idx + 1, 0, ...newLines);
      return { doc: { ...s.doc, lines }, isDirty: true };
    });
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

  deleteLine: (id) =>
    set((s) => {
      const lines = s.doc.lines.filter((l) => l.id !== id);
      const activeLineId = s.activeLineId === id
        ? (lines[0]?.id ?? null)
        : s.activeLineId;
      return { doc: { ...s.doc, lines }, activeLineId, isDirty: true };
    }),

  stampCurrentLine: (id) => {
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
    const parsed = parseLrc(raw);
    let id = nextId;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = parsed.lines[0]?.id ?? null;
    set({ doc: parsed, activeLineId: firstId, isDirty: true });
  },

  applyOffset: () => {
    const { doc } = get();
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
      set({ doc, lrcPath: selected, isDirty: false, activeLineId: firstId });
    }
  },

  saveLrc: async () => {
    const { lrcPath, doc } = get();
    if (!lrcPath) { await get().saveLrcAs(); return; }
    await invoke("write_lrc_file", { path: lrcPath, content: serializeLrc(doc) });
    set({ isDirty: false });
  },

  saveLrcAs: async () => {
    const { doc } = get();
    const path = await save({
      filters: [{ name: "LRC", extensions: ["lrc"] }],
      defaultPath: doc.metadata.title || "untitled",
    });
    if (path) {
      await invoke("write_lrc_file", { path, content: serializeLrc(doc) });
      set({ lrcPath: path, isDirty: false });
    }
  },

  newLrc: () =>
    set({ doc: defaultDocument(), lrcPath: null, isDirty: false, activeLineId: null }),

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

      set({
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
