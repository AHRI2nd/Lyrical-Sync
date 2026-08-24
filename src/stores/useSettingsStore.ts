import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type KeyAction, DEFAULT_KEYBINDINGS } from "../utils/keybindings";

interface SettingsState {
  /** 저장 경로가 지정된 파일에 대해 변경 시 자동 저장 */
  autoSave: boolean;
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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoSave: true,
      uiScale: 1.0,
      showElrcSaveNotice: true,
      lyricsFontScale: 1.0,
      showGlyphTimeMarkers: true,
      showSpectrogram: false,
      recentFiles: [],
      keybindings: { ...DEFAULT_KEYBINDINGS },
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
    { name: "lyrical-sync-settings" }
  )
);
