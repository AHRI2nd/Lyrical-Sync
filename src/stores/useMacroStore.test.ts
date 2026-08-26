import { describe, it, expect, beforeEach, vi } from "vitest";

if (typeof globalThis.localStorage === "undefined") {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { useMacroStore } from "./useMacroStore";
import { useLrcStore } from "./useLrcStore";
import type { LrcLine } from "../types/lrc";

const resetLrc = (lines: LrcLine[]) =>
  useLrcStore.setState({
    doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, lines, extraTags: {} },
    _history: [],
    _future: [],
  });

beforeEach(() => {
  useMacroStore.setState({ isRecording: false, currentSteps: [], savedMacros: [] });
  resetLrc([]);
});

describe("recording", () => {
  it("recordStep does nothing while not recording", () => {
    useMacroStore.getState().recordStep({ action: "scaleTimestamps", params: { factor: 1.1 } });
    expect(useMacroStore.getState().currentSteps).toHaveLength(0);
  });

  it("records steps in order while recording", () => {
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "scaleTimestamps", params: { factor: 1.1 } });
    useMacroStore.getState().recordStep({ action: "shiftLines", params: { delta: 0.5 } });
    expect(useMacroStore.getState().currentSteps.map((s) => s.action)).toEqual(["scaleTimestamps", "shiftLines"]);
  });

  it("discardRecording clears steps without saving", () => {
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "applyOffset", params: {} });
    useMacroStore.getState().discardRecording();
    expect(useMacroStore.getState().isRecording).toBe(false);
    expect(useMacroStore.getState().currentSteps).toHaveLength(0);
    expect(useMacroStore.getState().savedMacros).toHaveLength(0);
  });

  it("saveMacro stores the recorded steps under a name and resets recording state", () => {
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "clearTimestamps", params: {} });
    useMacroStore.getState().saveMacro("My Macro");

    const st = useMacroStore.getState();
    expect(st.isRecording).toBe(false);
    expect(st.currentSteps).toHaveLength(0);
    expect(st.savedMacros).toHaveLength(1);
    expect(st.savedMacros[0].name).toBe("My Macro");
    expect(st.savedMacros[0].steps).toEqual([{ action: "clearTimestamps", params: {} }]);
  });

  it("saveMacro with no recorded steps saves nothing", () => {
    useMacroStore.getState().startRecording();
    useMacroStore.getState().saveMacro("Empty");
    expect(useMacroStore.getState().savedMacros).toHaveLength(0);
  });
});

describe("macro management", () => {
  const seedMacro = () => {
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "scaleTimestamps", params: { factor: 1.05 } });
    useMacroStore.getState().saveMacro("Tempo Fix");
    return useMacroStore.getState().savedMacros[0].id;
  };

  it("renameMacro updates only the matching macro", () => {
    const id = seedMacro();
    useMacroStore.getState().renameMacro(id, "Renamed");
    expect(useMacroStore.getState().savedMacros[0].name).toBe("Renamed");
  });

  it("deleteMacro removes it from the list", () => {
    const id = seedMacro();
    useMacroStore.getState().deleteMacro(id);
    expect(useMacroStore.getState().savedMacros).toHaveLength(0);
  });
});

describe("replayMacro", () => {
  it("calls the corresponding useLrcStore action with recorded params", () => {
    resetLrc([{ id: "1", timestamp: 1, text: "a" }, { id: "2", timestamp: 2, text: "b" }]);
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "scaleTimestamps", params: { factor: 2 } });
    useMacroStore.getState().saveMacro("Double");
    const id = useMacroStore.getState().savedMacros[0].id;

    useMacroStore.getState().replayMacro(id, []);
    expect(useLrcStore.getState().doc.lines.map((l) => l.timestamp)).toEqual([2, 4]);
  });

  it("resolves selection-scoped steps against scopeIds at replay time, not recorded ids", () => {
    resetLrc([{ id: "1", timestamp: 1, text: "a" }, { id: "2", timestamp: 2, text: "b" }]);
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "shiftLines", params: { delta: 1 } });
    useMacroStore.getState().saveMacro("Shift");
    const id = useMacroStore.getState().savedMacros[0].id;

    useMacroStore.getState().replayMacro(id, ["2"]); // 재생 시점엔 "2"만 선택
    expect(useLrcStore.getState().doc.lines.map((l) => l.timestamp)).toEqual([1, 3]);
  });

  it("treats an empty scopeIds as 'all lines' for selection-scoped steps", () => {
    resetLrc([{ id: "1", timestamp: 1, text: "a" }, { id: "2", timestamp: 2, text: "b" }]);
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "clearTimestamps", params: {} });
    useMacroStore.getState().saveMacro("Clear");
    const id = useMacroStore.getState().savedMacros[0].id;

    useMacroStore.getState().replayMacro(id, []);
    expect(useLrcStore.getState().doc.lines.every((l) => l.timestamp === null)).toBe(true);
  });

  it("replays multiple steps in recorded order", () => {
    resetLrc([{ id: "1", timestamp: 1, text: "hello" }]);
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "replaceAll", params: { find: "hello", replace: "hi", caseSensitive: false } });
    useMacroStore.getState().recordStep({ action: "scaleTimestamps", params: { factor: 3 } });
    useMacroStore.getState().saveMacro("Combo");
    const id = useMacroStore.getState().savedMacros[0].id;

    useMacroStore.getState().replayMacro(id, []);
    const line = useLrcStore.getState().doc.lines[0];
    expect(line.text).toBe("hi");
    expect(line.timestamp).toBe(3);
  });

  it("does nothing for an unknown macro id", () => {
    resetLrc([{ id: "1", timestamp: 1, text: "a" }]);
    expect(() => useMacroStore.getState().replayMacro("nonexistent", [])).not.toThrow();
    expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1);
  });
});

describe("persistence", () => {
  it("never writes isRecording/currentSteps to disk — a crash mid-recording can't leave a stale flag on relaunch", () => {
    useMacroStore.getState().startRecording();
    useMacroStore.getState().recordStep({ action: "scaleTimestamps", params: { factor: 1.1 } });

    const raw = localStorage.getItem("lyrical-sync-macros");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted).not.toHaveProperty("isRecording");
    expect(persisted).not.toHaveProperty("currentSteps");
    expect(persisted).toHaveProperty("savedMacros");
  });
});
