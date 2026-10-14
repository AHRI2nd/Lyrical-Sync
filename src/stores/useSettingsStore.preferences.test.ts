// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { useSettingsStore } from "./useSettingsStore";

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState(useSettingsStore.getInitialState());
});

it("rejects malformed restored style preferences without replacing actions or privacy opt-outs", async () => {
  useSettingsStore.setState({ autoSave: false, recoveryEnabled: false });
  localStorage.setItem("lyrical-sync-settings", JSON.stringify({ state: {
    showSpellCheck: "yes", showTranslationLines: 1, previewFontScale: 20,
    previewActiveColor: "red", previewAccentColor: "#fff", previewGlowEnabled: "false",
    glyphWaveformHeight: "240", glyphWaveformStyle: "custom", setShowSpellCheck: "broken",
  }, version: 0 }));
  await useSettingsStore.persist.rehydrate();
  const state = useSettingsStore.getState();
  expect(state).toMatchObject({ showSpellCheck: false, showTranslationLines: false,
    previewFontScale: 1, previewActiveColor: "#ffffff", previewAccentColor: "#6366f1",
    previewGlowEnabled: true, glyphWaveformHeight: 144, glyphWaveformStyle: "continuous",
    autoSave: false, recoveryEnabled: false });
  expect(typeof state.setShowSpellCheck).toBe("function");
});

it("restores valid preview preferences and rounds saved waveform height to the supported grid", async () => {
  localStorage.setItem("lyrical-sync-settings", JSON.stringify({ state: {
    showSpellCheck: true, showTranslationLines: true, previewFontScale: 1.35,
    previewActiveColor: "#Aa00FF", previewAccentColor: "#12ab34", previewGlowEnabled: false,
    glyphWaveformHeight: 157, glyphWaveformStyle: "bars",
  }, version: 0 }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState()).toMatchObject({ showSpellCheck: true, showTranslationLines: true,
    previewFontScale: 1.35, previewActiveColor: "#Aa00FF", previewAccentColor: "#12ab34",
    previewGlowEnabled: false, glyphWaveformHeight: 160, glyphWaveformStyle: "bars" });
});

it.each([[40, 80], [999, 240], [Number.NaN, 144], [151, 152]])(
  "normalizes waveform height %s to %s through its action", (value, expected) => {
    useSettingsStore.getState().setGlyphWaveformHeight(value);
    expect(useSettingsStore.getState().glyphWaveformHeight).toBe(expected);
  });

it("ignores invalid preview input and clears every new preference with the privacy reset", () => {
  const state = useSettingsStore.getState();
  state.setPreviewFontScale(1.4);
  state.setPreviewFontScale(Number.POSITIVE_INFINITY);
  state.setPreviewFontScale(0.5);
  state.setPreviewActiveColor("#12ab34");
  state.setPreviewActiveColor("url(unsafe)");
  state.setPreviewAccentColor("#ffaa00");
  state.setPreviewGlowEnabled(false);
  state.setShowSpellCheck(true);
  state.setShowTranslationLines(true);
  state.setGlyphWaveformHeight(240);
  state.setGlyphWaveformStyle("bars");
  expect(useSettingsStore.getState()).toMatchObject({ previewFontScale: 1.4, previewActiveColor: "#12ab34" });
  state.resetLocalPreferences();
  expect(useSettingsStore.getState()).toMatchObject({ showSpellCheck: false, showTranslationLines: false,
    previewFontScale: 1, previewActiveColor: "#ffffff", previewAccentColor: "#6366f1",
    previewGlowEnabled: true, glyphWaveformHeight: 144, glyphWaveformStyle: "continuous",
    autoSave: false, recoveryEnabled: false });
  const saved = JSON.parse(localStorage.getItem("lyrical-sync-settings")!).state;
  expect(saved.previewActiveColor).toBe("#ffffff");
  expect(saved.showSpellCheck).toBe(false);
});
