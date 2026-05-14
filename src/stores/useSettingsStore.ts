import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  autoCheckUpdate: boolean;
  uiScale: number;
  /** 커스텀 모델 저장 경로. "" = 앱 기본 경로 사용 */
  modelsDir: string;
  /** 빈 줄 타임스탬프 = 앞 가사 end + blankLineOffset 초 */
  blankLineOffset: number;
  setAutoCheckUpdate: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setModelsDir: (v: string) => void;
  setBlankLineOffset: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoCheckUpdate: true,
      uiScale: 1.0,
      modelsDir: "",
      blankLineOffset: 1.0,
      setAutoCheckUpdate: (v) => set({ autoCheckUpdate: v }),
      setUiScale: (v) => set({ uiScale: v }),
      setModelsDir: (v) => set({ modelsDir: v }),
      setBlankLineOffset: (v) => set({ blankLineOffset: v }),
    }),
    { name: "lyrical-sync-settings" }
  )
);
