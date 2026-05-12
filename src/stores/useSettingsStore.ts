import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  autoCheckUpdate: boolean;
  uiScale: number;
  setAutoCheckUpdate: (v: boolean) => void;
  setUiScale: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoCheckUpdate: true,
      uiScale: 1.0,
      setAutoCheckUpdate: (v) => set({ autoCheckUpdate: v }),
      setUiScale: (v) => set({ uiScale: v }),
    }),
    { name: "lyrical-sync-settings" }
  )
);
