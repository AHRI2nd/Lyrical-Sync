// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsModal } from "./SettingsModal";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { translations } from "../../i18n/translations";
import { loadRecoverySnapshot, saveRecoverySnapshot } from "../../utils/recovery";
import { defaultDocument } from "../../types/lrc";
beforeEach(() => {
  localStorage.clear(); useSettingsStore.setState({ recoveryEnabled: true });
  useI18nStore.setState({ lang: "en", t: translations.en });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("requires confirmation to stop recovery, and cancelling preserves the backup", () => {
  saveRecoverySnapshot(defaultDocument(), "/lyrics.lrc", null);
  const close = vi.fn(); render(<SettingsModal onClose={close} />);
  fireEvent.click(screen.getByRole("switch", { name: "Save recovery copies" }));
  expect(useSettingsStore.getState().recoveryEnabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(loadRecoverySnapshot()).not.toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Save recovery copies" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn off and delete copies" }));
  expect(useSettingsStore.getState().recoveryEnabled).toBe(false);
  expect(loadRecoverySnapshot()).toBeNull(); expect(close).not.toHaveBeenCalled();
});
it("Escape dismisses only the privacy confirmation", () => {
  const close = vi.fn(); render(<SettingsModal onClose={close} />);
  fireEvent.click(screen.getByRole("switch", { name: "Save recovery copies" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Turn off and delete copies" })).toBeNull();
});
