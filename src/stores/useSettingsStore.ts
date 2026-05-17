import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  autoCheckUpdate: boolean;
  uiScale: number;
  /** 커스텀 모델 저장 경로. "" = 앱 기본 경로 사용 */
  modelsDir: string;
  /** 빈 줄 타임스탬프 = 앞 가사 end + blankLineOffset 초 */
  blankLineOffset: number;
  /** Spotify Developer App client_id (사용자 직접 입력) */
  spotifyClientId: string;
  /** Spotify 모드 활성화 여부 (로그인 상태와 독립적으로 UI 전환) */
  spotifyMode: boolean;
  setAutoCheckUpdate: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setModelsDir: (v: string) => void;
  setBlankLineOffset: (v: number) => void;
  setSpotifyClientId: (v: string) => void;
  setSpotifyMode: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoCheckUpdate: true,
      uiScale: 1.0,
      modelsDir: "",
      blankLineOffset: 1.0,
      spotifyClientId: "",
      spotifyMode: false,
      setAutoCheckUpdate: (v) => set({ autoCheckUpdate: v }),
      setUiScale: (v) => set({ uiScale: v }),
      setModelsDir: (v) => set({ modelsDir: v }),
      setBlankLineOffset: (v) => set({ blankLineOffset: v }),
      setSpotifyClientId: (v) => set({ spotifyClientId: v }),
      setSpotifyMode: (v) => set({ spotifyMode: v }),
    }),
    { name: "lyrical-sync-settings" }
  )
);
