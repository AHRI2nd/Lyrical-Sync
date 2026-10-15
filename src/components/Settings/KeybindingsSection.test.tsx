// @vitest-environment jsdom
import { translations } from "../../i18n/translations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { KeybindingsSection } from "./KeybindingsSection";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { DEFAULT_KEYBINDINGS } from "../../utils/keybindings";

beforeEach(() => useSettingsStore.setState({ keybindings: { ...DEFAULT_KEYBINDINGS } }));
afterEach(() => { cleanup(); useI18nStore.setState({lang:"ko",t:translations.ko}); });

describe("KeybindingsSection", () => {
  it("focuses the character guide without entering shortcut capture", () => {
    const { getByRole, queryByText } = render(<KeybindingsSection focusCharacterSync />);
    const heading = getByRole("heading", { name: useI18nStore.getState().t.charSync.modeChar });
    expect(document.activeElement).toBe(heading);
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(useSettingsStore.getState().keybindings.stamp).toBe("Space");
    expect(queryByText(useI18nStore.getState().t.keys.capturing)).toBeNull();
  });

  it("shows one editable control per action and keeps fixed and mouse guidance separate", () => {
    const t = useI18nStore.getState().t;
    const { getByRole, getByText, getAllByRole } = render(<KeybindingsSection />);
    const group = getByRole("region", { name: t.charSync.modeChar });
    expect(within(group).getByRole("button", { name: `${t.charSync.stampHint} Space` })).toBeTruthy();
    expect(getAllByRole("button")).toHaveLength(9);
    expect(getByText(t.charSync.fixedShortcuts)).toBeTruthy();
    expect(getByText(t.charSync.mouseControls)).toBeTruthy();
    expect(getByText(t.charSync.nudgeShortcut)).toBeTruthy();
    expect(getByText(t.charSync.paintAction)).toBeTruthy();
  });

  it.each(["ko", "en", "ja"] as const)("shows localized timing guidance in %s", (lang) => {
    useI18nStore.setState({lang,t:translations[lang]});
    const t = useI18nStore.getState().t;
    const { getByRole, getByText } = render(<KeybindingsSection />);
    expect(getByRole("button", { name: `${t.charSync.stampHint} Space` })).toBeTruthy();
    expect(getByText(t.charSync.seekAction)).toBeTruthy();
    expect(getByText(t.charSync.clearAction)).toBeTruthy();
  });

  it("ignores modifier chords and reports reserved keys during capture", () => {
    const t = useI18nStore.getState().t;
    const { getByRole, getByText } = render(<KeybindingsSection />);
    fireEvent.click(getByRole("button", { name: `${t.charSync.stampHint} Space` }));
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    expect(useSettingsStore.getState().keybindings.stamp).toBe("Space");
    fireEvent.keyDown(window, { code: "Tab" });
    expect(getByText(t.keys.reserved)).toBeTruthy();
    expect(useSettingsStore.getState().keybindings.stamp).toBe("Space");
  });

  it("keeps capture, conflict detection, cancellation, and reset working", () => {
    const t = useI18nStore.getState().t;
    const { getByRole, getByText } = render(<KeybindingsSection />);
    fireEvent.click(getByRole("button", { name: `${t.charSync.stampHint} Space` }));
    fireEvent.keyDown(window, { code: "Digit3" });
    expect(getByText(t.keys.conflict.replace("{action}", t.keys.playPause))).toBeTruthy();
    expect(useSettingsStore.getState().keybindings.stamp).toBe("Space");
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(useSettingsStore.getState().keybindings.stamp).toBe("KeyT");
    fireEvent.click(getByRole("button", { name: `${t.charSync.stampHint} T` }));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(useSettingsStore.getState().keybindings.stamp).toBe("KeyT");
    fireEvent.click(getByRole("button", { name: t.keys.reset }));
    expect(useSettingsStore.getState().keybindings).toEqual(DEFAULT_KEYBINDINGS);
  });
});
