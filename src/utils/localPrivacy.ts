import { useSettingsStore } from "../stores/useSettingsStore";
import { clearRecoverySnapshot } from "./recovery";

// Called only after the user confirms deletion, never by automatic cleanup.
export function configureRecovery(enabled: boolean): boolean {
  if (!useSettingsStore.getState().setRecoveryEnabled(enabled)) return false;
  return enabled || clearRecoverySnapshot();
}
