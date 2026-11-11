import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { useLrcStore } from "./useLrcStore";
import { useI18nStore } from "./useI18nStore";
import { useBusyStore } from "./useBusyStore";
import { saveRecoverySnapshot } from "../utils/recovery";

export type UpdaterStatus =
  | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  body: string | null; // 릴리즈 노트
  progress: number; // 0~100, downloading 중에만 의미 있음
  error: string | null;
  _update: Update | null; // 내부 핸들(다운로드/설치 실행용), UI에서 직접 사용 안 함

  checkForUpdate: (silent?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
}

// Windows installation exits the process before the separate restart action.
// Invoke the destructive action in the same turn as the final recovery snapshot.
let updateOperationActive = false;
let checkGeneration = 0;
const updateClosePromises = new WeakMap<Update, Promise<void>>();
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 60_000;

function closeUpdateOnce(update: Update | null | undefined): Promise<void> {
  if (!update) return Promise.resolve();
  const existing = updateClosePromises.get(update);
  if (existing) return existing;
  const closing = Promise.resolve().then(() => update.close()).then(() => undefined, () => undefined);
  updateClosePromises.set(update, closing);
  return closing;
}

function isCurrentCheck(generation: number): boolean {
  return checkGeneration === generation;
}
function hasBlockingAppOperation(): boolean {
  return useBusyStore.getState().reasons.size > 0
    || useLrcStore.getState().aiSyncStatus === "running";
}
async function preserveBefore(action: () => Promise<void>): Promise<void> {
  const lrc = useLrcStore.getState();
  if (lrc.isDirty && lrc.lrcPath) {
    try { await lrc.saveLrc(); } catch { /* Fall back to a durable recovery copy. */ }
  }
  const after = useLrcStore.getState();
  if (after.isDirty && !saveRecoverySnapshot(
    after.doc, after.lrcPath, after.audioPath, null, null, undefined,
    after._documentSession, after._editRevision, after._lrcFileHash,
  )) {
    throw new Error(useI18nStore.getState().t.toast.recoveryFailed);
  }
  return action();
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  body: null,
  progress: 0,
  error: null,
  _update: null,

  checkForUpdate: async (silent = false) => {
    if (updateOperationActive || get().status === "downloading" || get().status === "ready") return;
    const generation = ++checkGeneration;
    set({ status: "checking", version: null, body: null, progress: 0, error: null });
    let checkPromise: Promise<Update | null> | null = null;
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      checkPromise = (async () => {
        const { check } = await import("@tauri-apps/plugin-updater");
        return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      })();
      const checkResult = checkPromise.then((update) => {
        if ((timedOut || !isCurrentCheck(generation)) && get()._update !== update) {
          void closeUpdateOnce(update);
        }
        return update;
      });
      const update = await new Promise<Update | null>((resolve, reject) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          reject(new Error("Updater check timed out"));
        }, UPDATE_CHECK_TIMEOUT_MS);
        checkResult.then(resolve, reject);
      });
      if (!isCurrentCheck(generation)) {
        if (get()._update !== update) await closeUpdateOnce(update);
        return;
      }
      const previous = get()._update;
      if (previous !== update) await closeUpdateOnce(previous);
      if (!isCurrentCheck(generation)) {
        if (get()._update !== update) await closeUpdateOnce(update);
        return;
      }
      if (update) {
        set({ status: "available", version: update.version, body: update.body ?? null, _update: update });
      } else {
        set({ status: silent ? "idle" : "up-to-date", version: null, body: null, progress: 0, error: null, _update: null });
      }
    } catch (e) {
      if (!isCurrentCheck(generation)) return;
      const previous = get()._update;
      await closeUpdateOnce(previous);
      if (!isCurrentCheck(generation)) return;
      set({
        status: silent ? "idle" : "error",
        version: null,
        body: null,
        progress: 0,
        error: silent ? null : String(e),
        _update: null,
      });
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  },

  downloadAndInstall: async () => {
    const { _update } = get();
    if (!_update || get().status !== "available" || updateOperationActive || hasBlockingAppOperation()) return;
    updateOperationActive = true;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let downloaded = 0;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      let rejectStalledDownload: ((error: Error) => void) | null = null;
      let resolveDownloadFinished: (() => void) | null = null;
      const stalledDownload = new Promise<void>((resolve, reject) => {
        resolveDownloadFinished = resolve;
        rejectStalledDownload = reject;
      });
      const refreshStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          rejectStalledDownload?.(new Error("Updater download stalled"));
        }, UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
      };
      refreshStallTimer();
      try {
        await Promise.race([
          _update.download((event) => {
            refreshStallTimer();
            switch (event.event) {
              case "Started":
                total = event.data.contentLength ?? 0;
                break;
              case "Progress":
                downloaded += event.data.chunkLength;
                if (total > 0) set({ progress: Math.min(100, Math.round((downloaded / total) * 100)) });
                break;
              case "Finished":
                set({ progress: 100 });
                resolveDownloadFinished?.();
                break;
            }
          }, { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS }),
          stalledDownload,
        ]);
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
      }
      await preserveBefore(() => _update.install());
      if (get()._update === _update) set({ status: "ready", progress: 100, error: null });
    } catch (e) {
      // Separate downloads own a native byte buffer until installation or close.
      // A failed attempt must be checked again rather than overwrite that buffer.
      try { await _update.close(); } catch { /* Preserve the original failure. */ }
      if (get()._update === _update) {
        set({ status: "error", version: null, body: null, progress: 0, error: String(e), _update: null });
      }
    } finally {
      updateOperationActive = false;
    }
  },

  restart: async () => {
    if (updateOperationActive || hasBlockingAppOperation()) return;
    updateOperationActive = true;
    try {
      // Resolve the module before capturing the final document to protect.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await preserveBefore(relaunch);
    } catch (error) {
      set({ status: "error", error: String(error) });
    } finally {
      updateOperationActive = false;
    }
  },

  dismiss: () => {
    if (updateOperationActive || get().status === "downloading") return;
    checkGeneration += 1;
    const update = get()._update;
    set({ status: "idle", version: null, body: null, progress: 0, error: null, _update: null });
    void closeUpdateOnce(update);
  },
}));
