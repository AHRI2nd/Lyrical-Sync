import { create } from "zustand";
import { createSafeJSONStorage, isRecord, isFiniteNumber, isNullableString } from "../utils/storage";
import { persist } from "zustand/middleware";
import { type KeyAction, DEFAULT_KEYBINDINGS, KEY_ACTIONS, RESERVED_CODES } from "../utils/keybindings";

interface SettingsState {
  /** 저장 경로가 지정된 파일에 대해 변경 시 자동 저장 */
  autoSave: boolean;
  recoveryEnabled: boolean;
  uiScale: number;
  /** 글자/단어 동기화가 있어 Enhanced LRC로 저장될 때 알림 팝업 표시. false면 묻지 않고 저장 */
  showElrcSaveNotice: boolean;
  /** 가사 편집 글꼴 크기 배율 (0.8 ~ 1.5, 기본값: 1.0) */
  lyricsFontScale: number;
  /** 글자 동기화 모드에서 글자 아래 시간 마커 표시 */
  showGlyphTimeMarkers: boolean;
  /** 파형 대신/함께 스펙트로그램 표시 (음높이·배음 구조를 볼 때 유용) */
  showSpectrogram: boolean;
  /** 최근 연 파일(가사/오디오) 목록, 최신순 최대 8개 */
  recentFiles: RecentFileEntry[];
  /** 전역 단축키 바인딩(action → KeyboardEvent.code) */
  keybindings: Record<KeyAction, string>;
  resetLocalPreferences: () => void;
  setRecoveryEnabled: (v: boolean) => boolean;
  setAutoSave: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setShowElrcSaveNotice: (v: boolean) => void;
  setLyricsFontScale: (v: number) => void;
  setShowGlyphTimeMarkers: (v: boolean) => void;
  setShowSpectrogram: (v: boolean) => void;
  /** 최근 파일 항목 추가(같은 경로 조합이 이미 있으면 맨 앞으로 이동, 최대 8개 유지).
   *  App Sandbox라 경로만으론 재시작 후 재접근이 불가능 — 보안 스코프 북마크도 함께 저장 */
  addRecentFile: (entry: {
    lrcPath: string | null; audioPath: string | null;
    lrcBookmark: string | null; audioBookmark: string | null;
  }) => void;
  clearRecentFiles: () => void;
  setKeybinding: (action: KeyAction, code: string) => void;
  resetKeybindings: () => void;
}

export interface RecentFileEntry {
  lrcPath: string | null;
  audioPath: string | null;
  lrcBookmark: string | null;
  audioBookmark: string | null;
  openedAt: number;
}

const MAX_RECENT_FILES = 8;

function sanitizeSettings(value: unknown, current: SettingsState): SettingsState {
  if (!isRecord(value)) return current;
  const next = { ...current };
  for (const field of ["autoSave", "recoveryEnabled", "showElrcSaveNotice", "showGlyphTimeMarkers", "showSpectrogram"] as const)
    if (typeof value[field] === "boolean") next[field] = value[field];
  for (const [field, min, max] of [["uiScale", 0.7, 1.3], ["lyricsFontScale", 0.8, 1.5]] as const) {
    const number = value[field];
    if (isFiniteNumber(number) && number >= min && number <= max) next[field] = number;
  }
  next.keybindings = { ...current.keybindings };
  if (isRecord(value.keybindings)) for (const action of KEY_ACTIONS) {
    const code = value.keybindings[action];
    // Keyboard layouts may provide additional code names beyond the common keys.
    if (typeof code === "string" && /^[A-Z][A-Za-z0-9]{0,39}$/.test(code) &&
        !/^(Shift|Control|Alt|Meta)/.test(code) && !RESERVED_CODES.has(code)) next.keybindings[action] = code;
  }
  if (Array.isArray(value.recentFiles)) {
    const seen = new Set<string>();
    next.recentFiles = [];
    for (const entry of value.recentFiles) {
      if (!isRecord(entry) || !isNullableString(entry.lrcPath) || !isNullableString(entry.audioPath) ||
          (!entry.lrcPath && !entry.audioPath) || !isFiniteNumber(entry.openedAt) ||
          (entry.lrcBookmark !== undefined && !isNullableString(entry.lrcBookmark)) ||
          (entry.audioBookmark !== undefined && !isNullableString(entry.audioBookmark))) continue;
      const key = JSON.stringify([entry.lrcPath, entry.audioPath]);
      if (seen.has(key)) continue;
      seen.add(key);
      next.recentFiles.push({ lrcPath: entry.lrcPath as string | null, audioPath: entry.audioPath as string | null,
        lrcBookmark: (entry.lrcBookmark ?? null) as string | null, audioBookmark: (entry.audioBookmark ?? null) as string | null,
        openedAt: entry.openedAt });
      if (next.recentFiles.length === MAX_RECENT_FILES) break;
    }
  }
  return next;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoSave: true,
      recoveryEnabled: true,
      uiScale: 1.0,
      showElrcSaveNotice: true,
      lyricsFontScale: 1.0,
      showGlyphTimeMarkers: true,
      showSpectrogram: false,
      recentFiles: [],
      keybindings: { ...DEFAULT_KEYBINDINGS },
      resetLocalPreferences: () => set({
        autoSave: false, recoveryEnabled: false, uiScale: 1, showElrcSaveNotice: true,
        lyricsFontScale: 1, showGlyphTimeMarkers: true, showSpectrogram: false,
        recentFiles: [], keybindings: { ...DEFAULT_KEYBINDINGS },
      }),
      setRecoveryEnabled: (v) => {
        // Verify durable preference storage before discarding a recovery copy.
        try {
          const state = { ...useSettingsStore.getState(), recoveryEnabled: v };
          localStorage.setItem("lyrical-sync-settings", JSON.stringify({ state, version: 0 }));
          set({ recoveryEnabled: v });
          return JSON.parse(localStorage.getItem("lyrical-sync-settings")!).state.recoveryEnabled === v;
        } catch { return false; }
      },
      setAutoSave: (v) => set({ autoSave: v }),
      setUiScale: (v) => set({ uiScale: v }),
      setShowElrcSaveNotice: (v) => set({ showElrcSaveNotice: v }),
      setLyricsFontScale: (v) => set({ lyricsFontScale: v }),
      setShowGlyphTimeMarkers: (v) => set({ showGlyphTimeMarkers: v }),
      setShowSpectrogram: (v) => set({ showSpectrogram: v }),
      addRecentFile: (entry) =>
        set((s) => {
          if (!entry.lrcPath && !entry.audioPath) return s;
          const sameEntry = (f: RecentFileEntry) => f.lrcPath === entry.lrcPath && f.audioPath === entry.audioPath;
          const next = [{ ...entry, openedAt: Date.now() }, ...s.recentFiles.filter((f) => !sameEntry(f))];
          return { recentFiles: next.slice(0, MAX_RECENT_FILES) };
        }),
      clearRecentFiles: () => set({ recentFiles: [] }),
      setKeybinding: (action, code) =>
        set((s) => ({ keybindings: { ...s.keybindings, [action]: code } })),
      resetKeybindings: () => set({ keybindings: { ...DEFAULT_KEYBINDINGS } }),
    }),
    { name: "lyrical-sync-settings", storage: createSafeJSONStorage<SettingsState>(),
      merge: (persisted, current) => sanitizeSettings(persisted, current) }
  )
);
