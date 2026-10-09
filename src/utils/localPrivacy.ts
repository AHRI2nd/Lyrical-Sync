import { useSettingsStore } from "../stores/useSettingsStore";
import { clearRecoverySnapshot } from "./recovery";

// Called only after the user confirms deletion, never by automatic cleanup.
export function configureRecovery(enabled: boolean): boolean {
  if (!useSettingsStore.getState().setRecoveryEnabled(enabled)) return false;
  return enabled || clearRecoverySnapshot();
}

export function clearLocalData(): boolean {
  // Stop future snapshots first. A failed deletion can then be safely retried.
  if (!configureRecovery(false)) return false;
  useSettingsStore.getState().resetLocalPreferences();
  try {
    localStorage.removeItem("lyrical-sync-settings");
    // Retain only the opt-outs, so neither recovery nor autosave restarts after clearing.
    localStorage.setItem("lyrical-sync-settings", JSON.stringify({ state: { recoveryEnabled: false, autoSave: false }, version: 0 }));
    const stored = JSON.parse(localStorage.getItem("lyrical-sync-settings")!);
    return JSON.stringify(stored.state) === JSON.stringify({ recoveryEnabled: false, autoSave: false });
  } catch { return false; }
}
