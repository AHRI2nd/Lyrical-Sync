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
  beforeEach(() => {
    reset(); relaunch.mockReset(); invoke.mockReset(); invoke.mockResolvedValue(undefined);
    saveRecoverySnapshot.mockReset(); saveRecoverySnapshot.mockReturnValue(true);
    useLrcStore.setState({ isDirty: false, lrcPath: null, audioPath: null });
  });

  it("is a no-op when there is no pending update", async () => {
    await useUpdaterStore.getState().downloadAndInstall();
    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("tracks progress from Started/Progress/Finished events and ends ready", async () => {
    const mockUpdate = {
      version: "1.2.3",
      install: vi.fn(async () => {}),
      download: vi.fn(async (cb: (e: unknown) => void) => {
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
    const mockUpdate = { version: "1.2.3", install: vi.fn(), download: vi.fn().mockRejectedValue(new Error("disk full")) };
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
    saveRecoverySnapshot.mockReturnValue(true);
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


describe("useUpdaterStore — restart durability failures", () => {
  beforeEach(() => {
    reset(); relaunch.mockReset(); invoke.mockReset(); saveRecoverySnapshot.mockReset();
    useLrcStore.setState({ isDirty: true, lrcPath: "/song.lrc", audioPath: null });
  });
  it("does not relaunch if neither file save nor snapshot succeeds", async () => {
    invoke.mockRejectedValue(new Error("disk full"));
    saveRecoverySnapshot.mockReturnValue(false);
    await useUpdaterStore.getState().restart();
    expect(relaunch).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("error");
    expect(useUpdaterStore.getState().error).toBeTruthy();
    expect(useLrcStore.getState().isDirty).toBe(true);
  });
  it("does not relaunch an unsaved document if the snapshot fails", async () => {
    useLrcStore.setState({ lrcPath: null });
    saveRecoverySnapshot.mockReturnValue(false);
    await useUpdaterStore.getState().restart();
    expect(relaunch).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("error");
  });
  it("protects edits made while the forced file save was pending", async () => {
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    saveRecoverySnapshot.mockReturnValue(true);
    const restarting = useUpdaterStore.getState().restart();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    useLrcStore.getState().setMetadata({ title: "edited during save" });
    finish();
    await restarting;
    expect(saveRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ title: "edited during save" }) }), "/song.lrc", null);
    expect(relaunch).toHaveBeenCalledOnce();
  });
  it("reports a relaunch error without leaving an unhandled rejection", async () => {
    useLrcStore.setState({ isDirty: false });
    relaunch.mockRejectedValueOnce(new Error("restart unavailable"));
    await expect(useUpdaterStore.getState().restart()).resolves.toBeUndefined();
    expect(useUpdaterStore.getState().status).toBe("error");
    expect(useUpdaterStore.getState().error).toContain("restart unavailable");
  });
});

describe("useUpdaterStore — installation durability", () => {
  beforeEach(() => {
    reset(); relaunch.mockReset(); invoke.mockReset(); invoke.mockResolvedValue(undefined);
    saveRecoverySnapshot.mockReset(); saveRecoverySnapshot.mockReturnValue(true);
    useLrcStore.setState({ isDirty: true, lrcPath: null, audioPath: null });
  });
  function update(download = vi.fn(async () => {}), install = vi.fn(async () => {})) {
    const close = vi.fn(async () => {});
    useUpdaterStore.setState({ status: "available", _update: { version: "1.2.3", download, install, close } as unknown as Update });
    return { download, install, close };
  }
  it("preserves the latest edits after download before entering the installer", async () => {
    const u = update(vi.fn(async () => { useLrcStore.getState().setMetadata({ title: "edited while downloading" }); }), vi.fn(async () => {
      expect(saveRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ title: "edited while downloading" }) }), null, null);
    }));
    await useUpdaterStore.getState().downloadAndInstall();
    expect(u.download).toHaveBeenCalledOnce(); expect(u.install).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });
  it("does not install an unsaved document when recovery cannot be persisted", async () => {
    saveRecoverySnapshot.mockReturnValue(false); const u = update();
    await useUpdaterStore.getState().downloadAndInstall();
    expect(u.install).not.toHaveBeenCalled(); expect(useUpdaterStore.getState().status).toBe("error");
  });
  it("blocks installation when both file save and recovery fail", async () => {
    useLrcStore.setState({ lrcPath: "/song.lrc" });
    invoke.mockRejectedValue(new Error("disk full")); saveRecoverySnapshot.mockReturnValue(false);
    const u = update(); await useUpdaterStore.getState().downloadAndInstall();
    expect(invoke).toHaveBeenCalled(); expect(u.install).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("error");
  });
  it("saves known files before installing without requiring recovery storage", async () => {
    useLrcStore.setState({ lrcPath: "/song.lrc" }); saveRecoverySnapshot.mockReturnValue(false);
    const u = update(); await useUpdaterStore.getState().downloadAndInstall();
    expect(invoke).toHaveBeenCalledWith("write_lrc_file", expect.objectContaining({ path: "/song.lrc" }));
    expect(saveRecoverySnapshot).not.toHaveBeenCalled(); expect(u.install).toHaveBeenCalledOnce();
  });
  it("protects edits made while the file save is pending", async () => {
    useLrcStore.setState({ lrcPath: "/song.lrc" });
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const u = update(); const task = useUpdaterStore.getState().downloadAndInstall();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    useLrcStore.getState().setMetadata({ title: "edited during update save" }); finish(); await task;
    expect(saveRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ title: "edited during update save" }) }), "/song.lrc", null);
    expect(u.install).toHaveBeenCalledOnce();
  });
  it("closes a failed update and retries with a fresh checked resource", async () => {
    const u = update(undefined, vi.fn().mockRejectedValue(new Error("installer unavailable")));
    await useUpdaterStore.getState().downloadAndInstall();
    expect(useUpdaterStore.getState().error).toContain("installer unavailable");
    expect(u.close).toHaveBeenCalledOnce(); expect(useUpdaterStore.getState()._update).toBeNull();
    const fresh = update();
    const checked = useUpdaterStore.getState()._update;
    useUpdaterStore.setState({ _update: null }); check.mockResolvedValueOnce(checked);
    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadAndInstall();
    expect(u.download).toHaveBeenCalledOnce(); expect(fresh.install).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });
  it("releases downloaded resources when preservation fails", async () => {
    saveRecoverySnapshot.mockReturnValue(false); const u = update();
    await useUpdaterStore.getState().downloadAndInstall();
    expect(u.close).toHaveBeenCalledOnce(); expect(useUpdaterStore.getState()._update).toBeNull();
    expect(u.install).not.toHaveBeenCalled();
  });
  it("keeps the original failure when resource cleanup also fails", async () => {
    const u = update(undefined, vi.fn().mockRejectedValue(new Error("install failed")));
    u.close.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(useUpdaterStore.getState().downloadAndInstall()).resolves.toBeUndefined();
    expect(useUpdaterStore.getState().error).toContain("install failed");
    expect(useUpdaterStore.getState()._update).toBeNull();
  });
  it("does not start a second download or restart while installation is active", async () => {
    let finish!: () => void;
    const u = update(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    const first = useUpdaterStore.getState().downloadAndInstall();
    await useUpdaterStore.getState().downloadAndInstall();
    await useUpdaterStore.getState().restart();
    expect(u.download).toHaveBeenCalledOnce(); expect(relaunch).not.toHaveBeenCalled(); finish(); await first;
    expect(u.install).toHaveBeenCalledOnce();
  });
});

describe("useUpdaterStore — check and handle ownership", () => {
  beforeEach(() => { reset(); check.mockReset(); });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  function update(version: string) {
    return { version, body: version, close: vi.fn(async () => {}), download: vi.fn(async () => {}), install: vi.fn(async () => {}) } as unknown as Update;
  }

  it("keeps the newer manual result when an earlier silent check returns null", async () => {
    const earlier = deferred<Update | null>();
    const latest = deferred<Update | null>();
    check.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    const first = useUpdaterStore.getState().checkForUpdate(true);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    const second = useUpdaterStore.getState().checkForUpdate(false);
    const latestUpdate = update("2.0.0");
    latest.resolve(latestUpdate);
    await second;
    earlier.resolve(null);
    await first;
    expect(useUpdaterStore.getState()).toMatchObject({ status: "available", version: "2.0.0", _update: latestUpdate });
  });

  it("closes a stale update resource without replacing the latest handle", async () => {
    const earlier = deferred<Update | null>();
    const latest = deferred<Update | null>();
    check.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    const first = useUpdaterStore.getState().checkForUpdate(true);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    const second = useUpdaterStore.getState().checkForUpdate(false);
    const latestUpdate = update("2.0.0");
    latest.resolve(latestUpdate);
    await second;
    const staleUpdate = update("1.9.0");
    earlier.resolve(staleUpdate);
    await first;
    expect(useUpdaterStore.getState()._update).toBe(latestUpdate);
    expect(staleUpdate.close).toHaveBeenCalledOnce();
  });

  it("does not let a stale error clear the latest available result", async () => {
    const earlier = deferred<Update | null>();
    const latest = deferred<Update | null>();
    check.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    const first = useUpdaterStore.getState().checkForUpdate(true);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    const second = useUpdaterStore.getState().checkForUpdate(false);
    const latestUpdate = update("2.0.0");
    latest.resolve(latestUpdate);
    await second;
    earlier.reject(new Error("stale network error"));
    await first;
    expect(useUpdaterStore.getState()).toMatchObject({ status: "available", version: "2.0.0", error: null, _update: latestUpdate });
  });

  it("invalidates a pending check on dismiss and closes its late resource", async () => {
    const pending = deferred<Update | null>();
    check.mockReturnValueOnce(pending.promise);
    const task = useUpdaterStore.getState().checkForUpdate(true);
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    useUpdaterStore.getState().dismiss();
    const lateUpdate = update("2.0.0");
    pending.resolve(lateUpdate);
    await task;
    expect(useUpdaterStore.getState()).toMatchObject({ status: "idle", version: null, _update: null });
    expect(lateUpdate.close).toHaveBeenCalledOnce();
  });

  it("closes the dismissed handle once and ignores dismiss during active download", async () => {
    const handle = update("2.0.0");
    useUpdaterStore.setState({ status: "available", version: handle.version, _update: handle });
    useUpdaterStore.getState().dismiss();
    await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());

    let finish!: () => void;
    const active = update("2.1.0");
    active.download = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    useUpdaterStore.setState({ status: "available", version: active.version, _update: active });
    check.mockReset();
    const downloading = useUpdaterStore.getState().downloadAndInstall();
    await useUpdaterStore.getState().checkForUpdate();
    useUpdaterStore.getState().dismiss();
    expect(useUpdaterStore.getState()).toMatchObject({ status: "downloading", _update: active });
    expect(check).not.toHaveBeenCalled();
    finish();
    await downloading;
  });

  it("closes the previous handle and clears all displayed update fields on a current no-update result", async () => {
    const previous = update("1.9.0");
    useUpdaterStore.setState({ status: "available", version: previous.version, body: "old", progress: 85, error: "old error", _update: previous });
    check.mockResolvedValueOnce(null);
    await useUpdaterStore.getState().checkForUpdate();
    expect(previous.close).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState()).toMatchObject({
      status: "up-to-date", version: null, body: null, progress: 0, error: null, _update: null,
    });
  });
});
