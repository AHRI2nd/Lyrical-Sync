// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreviewSettingsTab } from "./PreviewSettingsTab";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

afterEach(() => { cleanup(); useSettingsStore.setState({ previewFontScale: 1 }); });

it("changes and resets the preview font scale", () => {
  useSettingsStore.setState({ previewFontScale: 1 });
  const t = useI18nStore.getState().t;
  render(<PreviewSettingsTab />);
  fireEvent.change(screen.getByRole("slider", { name: t.previewFontScaleLabel }), { target: { value: "1.2" } });
  expect(useSettingsStore.getState().previewFontScale).toBe(1.2);
  fireEvent.click(screen.getByRole("button", { name: t.settingsUiScaleReset }));
  expect(useSettingsStore.getState().previewFontScale).toBe(1);
});
