import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { useLrcStore } from "./useLrcStore";
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

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  body: null,
  progress: 0,
  error: null,
  _update: null,

  checkForUpdate: async (silent = false) => {
    if (!silent) set({ status: "checking", error: null });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version, body: update.body ?? null, _update: update });
      } else {
        set({ status: silent ? "idle" : "up-to-date" });
      }
    } catch (e) {
      set({ status: silent ? "idle" : "error", error: silent ? null : String(e) });
    }
  },

  downloadAndInstall: async () => {
    const { _update } = get();
    if (!_update) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let downloaded = 0;
      await _update.downloadAndInstall((event) => {
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
            break;
        }
      });
      set({ status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  restart: async () => {
    // 재시작으로 프로세스가 죽기 전, 디바운스된 자동저장/복구 스냅샷이 미처 못 돈 채로
    // 최근 편집이 유실되지 않도록 즉시(디바운스 없이) 저장을 강제한다.
    const lrc = useLrcStore.getState();
    if (lrc.isDirty) {
      if (lrc.lrcPath) {
        try { await lrc.saveLrc(); } catch { /* 실패해도 아래 스냅샷이 안전망 */ }
      }
      const after = useLrcStore.getState();
      if (after.isDirty) {
        saveRecoverySnapshot(after.doc, after.lrcPath, after.audioPath);
      }
    }
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },

  dismiss: () => set({ status: "idle", version: null, body: null, progress: 0, error: null, _update: null }),
}));
