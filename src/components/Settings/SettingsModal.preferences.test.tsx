// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsModal } from "./SettingsModal";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { translations } from "../../i18n/translations";

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState());
  useI18nStore.setState({ lang: "en", t: { ...translations.en,
    settingsTabPreview: "Preview", settingsSpellCheck: "Spell check", settingsSpellCheckDesc: "Use system spell check",
    previewFontScaleLabel: "Preview font size", previewActiveColorLabel: "Active lyric color",
    previewAccentColorLabel: "Accent color", previewGlowLabel: "Glow",
  } });
});
afterEach(cleanup);

it("lets users opt in to spell check from general settings", () => {
  render(<SettingsModal onClose={() => {}} />);
  const toggle = screen.getByRole("switch", { name: "Spell check" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  expect(useSettingsStore.getState().showSpellCheck).toBe(true);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

it("updates preview settings using labeled controls in the preview tab", () => {
  render(<SettingsModal onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  fireEvent.change(screen.getByRole("slider", { name: "Preview font size" }), { target: { value: "1.35" } });
  fireEvent.change(screen.getByLabelText("Active lyric color"), { target: { value: "#ff8800" } });
  fireEvent.change(screen.getByLabelText("Accent color"), { target: { value: "#112233" } });
  fireEvent.click(screen.getByRole("switch", { name: "Glow" }));
  expect(useSettingsStore.getState()).toMatchObject({ previewFontScale: 1.35,
    previewActiveColor: "#ff8800", previewAccentColor: "#112233", previewGlowEnabled: false });
  fireEvent.click(screen.getByRole("button", { name: translations.en.settingsUiScaleReset }));
  expect(useSettingsStore.getState().previewFontScale).toBe(1);
});

it("keeps settings open when Escape belongs to an IME composition", () => {
  const close = vi.fn();
  render(<SettingsModal onClose={close} />);
  fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});


it("requires the compatibility warning before enabling translation inputs", () => {
  render(<SettingsModal onClose={() => {}} />);
  fireEvent.click(screen.getByRole("switch", { name: translations.en.translationToggle }));
  expect(useSettingsStore.getState().showTranslationLines).toBe(false);
  expect(screen.getByText(translations.en.translationWarningTitle)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: translations.en.translationWarningCancel }));
  expect(useSettingsStore.getState().showTranslationLines).toBe(false);
  fireEvent.click(screen.getByRole("switch", { name: translations.en.translationToggle }));
  fireEvent.click(screen.getByRole("button", { name: translations.en.translationWarningOk }));
  expect(useSettingsStore.getState().showTranslationLines).toBe(true);
});
