import { describe, it, expect, beforeEach, vi } from "vitest";

// zustand persist(useSettingsStore, useLrcStore 경유)용 최소 localStorage 폴리필 (node 환경)
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

const invoke = vi.fn();
const check = vi.fn();
const relaunch = vi.fn();
const saveRecoverySnapshot = vi.fn();

// useUpdaterStore가 useLrcStore를 경유해 이 모듈들을 끌어오므로 함께 스텁
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args: unknown[]) => check(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: (...args: unknown[]) => relaunch(...args) }));
vi.mock("../utils/recovery", () => ({ saveRecoverySnapshot: (...args: unknown[]) => saveRecoverySnapshot(...args) }));

import { useUpdaterStore } from "./useUpdaterStore";
import { useLrcStore } from "./useLrcStore";
import type { Update } from "@tauri-apps/plugin-updater";

const reset = () =>
  useUpdaterStore.setState({
    status: "idle", version: null, body: null, progress: 0, error: null, _update: null,
  });

describe("useUpdaterStore — checkForUpdate", () => {
  beforeEach(() => { reset(); check.mockReset(); });

  it("sets status=available with version/body when an update exists", async () => {
    check.mockResolvedValue({ version: "1.2.3", body: "release notes" });
    await useUpdaterStore.getState().checkForUpdate();
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("available");
    expect(s.version).toBe("1.2.3");
    expect(s.body).toBe("release notes");
    expect(s._update).not.toBeNull();
  });

  it("sets status=up-to-date when no update and not silent", async () => {
    check.mockResolvedValue(null);
    await useUpdaterStore.getState().checkForUpdate();
    expect(useUpdaterStore.getState().status).toBe("up-to-date");
  });

  it("sets status=idle when no update and silent", async () => {
    check.mockResolvedValue(null);
    await useUpdaterStore.getState().checkForUpdate(true);
    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("sets status=error with message when check() throws and not silent", async () => {
    check.mockRejectedValue(new Error("network down"));
    await useUpdaterStore.getState().checkForUpdate();
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toContain("network down");
  });

  it("silently swallows errors when silent=true (no error surfaced)", async () => {
    check.mockRejectedValue(new Error("network down"));
    await useUpdaterStore.getState().checkForUpdate(true);
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("idle");
    expect(s.error).toBeNull();
  });
});

describe("useUpdaterStore — downloadAndInstall", () => {
  beforeEach(() => reset());

  it("is a no-op when there is no pending update", async () => {
    await useUpdaterStore.getState().downloadAndInstall();
    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("tracks progress from Started/Progress/Finished events and ends ready", async () => {
    const mockUpdate = {
      version: "1.2.3",
      downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
        cb({ event: "Started", data: { contentLength: 100 } });
        cb({ event: "Progress", data: { chunkLength: 50 } });
        cb({ event: "Progress", data: { chunkLength: 50 } });
        cb({ event: "Finished" });
      }),
    };
    useUpdaterStore.setState({ status: "available", _update: mockUpdate as unknown as Update });
    await useUpdaterStore.getState().downloadAndInstall();
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("ready");
    expect(s.progress).toBe(100);
  });

  it("sets status=error when downloadAndInstall() rejects", async () => {
    const mockUpdate = { version: "1.2.3", downloadAndInstall: vi.fn().mockRejectedValue(new Error("disk full")) };
    useUpdaterStore.setState({ status: "available", _update: mockUpdate as unknown as Update });
    await useUpdaterStore.getState().downloadAndInstall();
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toContain("disk full");
  });
});

describe("useUpdaterStore — restart", () => {
  beforeEach(() => {
    reset();
    relaunch.mockReset();
    saveRecoverySnapshot.mockReset();
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useLrcStore.setState({
      doc: { metadata: { title: "", artist: "", album: "", by: "", offset: 0 }, lines: [], extraTags: {} },
      lrcPath: null,
      audioPath: null,
      isDirty: false,
    });
  });

  it("relaunches directly without saving when the doc is clean", async () => {
    await useUpdaterStore.getState().restart();
    expect(invoke).not.toHaveBeenCalled();
    expect(saveRecoverySnapshot).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("force-saves via saveLrc when dirty with a known lrcPath, skipping the snapshot on success", async () => {
    useLrcStore.setState({ isDirty: true, lrcPath: "/song.lrc" });
    await useUpdaterStore.getState().restart();
    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/song.lrc" }));
    expect(useLrcStore.getState().isDirty).toBe(false);
    expect(saveRecoverySnapshot).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("falls back to a recovery snapshot when the forced save fails", async () => {
    invoke.mockRejectedValue(new Error("write failed"));
    useLrcStore.setState({ isDirty: true, lrcPath: "/song.lrc" });
    await useUpdaterStore.getState().restart();
    expect(saveRecoverySnapshot).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("saves a recovery snapshot directly when dirty with no lrcPath (never saved before)", async () => {
    useLrcStore.setState({ isDirty: true, lrcPath: null });
    await useUpdaterStore.getState().restart();
    expect(invoke).not.toHaveBeenCalled();
    expect(saveRecoverySnapshot).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });
});

describe("useUpdaterStore — dismiss", () => {
  it("resets all fields back to idle", () => {
    useUpdaterStore.setState({ status: "ready", version: "1.2.3", body: "notes", progress: 100, error: "x", _update: {} as Update });
    useUpdaterStore.getState().dismiss();
    expect(useUpdaterStore.getState()).toMatchObject({
      status: "idle", version: null, body: null, progress: 0, error: null, _update: null,
    });
  });
});
