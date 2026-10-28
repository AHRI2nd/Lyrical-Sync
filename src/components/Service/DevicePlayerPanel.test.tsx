// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DevicePlayerPanel } from "./DevicePlayerPanel";
import { useDeviceStore } from "../../stores/useDeviceStore";
import { useI18nStore } from "../../stores/useI18nStore";

beforeEach(() => {
  useI18nStore.getState().setLang("en");
  useDeviceStore.setState({ hasSession: false, isPlaying: false, positionMs: 0, durationMs: 0 });
});

afterEach(cleanup);

it("disables playback controls while no media session is available", () => {
  render(<DevicePlayerPanel />);

  for (const label of [
    useI18nStore.getState().t.tooltipSkipBack5,
    useI18nStore.getState().t.tooltipSkipBack1,
    useI18nStore.getState().t.tooltipPlayPause,
    useI18nStore.getState().t.tooltipSkipFwd1,
    useI18nStore.getState().t.tooltipSkipFwd5,
  ]) {
    expect(screen.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(true);
  }
});
