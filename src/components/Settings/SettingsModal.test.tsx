// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { useI18nStore } from "../../stores/useI18nStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useToastStore } from "../../stores/useToastStore";
afterEach(cleanup);
it("pauses active Spotify playback when Settings disables Spotify mode", async () => {
  const pausePlayback = vi.fn().mockRejectedValue(new Error("network unavailable"));
  useServiceStore.setState({ isLoggedIn: true, isPlaying: true, pausePlayback });
  useSettingsStore.setState({ spotifyMode: true });
  useToastStore.setState({ toasts: [] });
  const push = vi.spyOn(useToastStore.getState(), "push");
  const { t } = useI18nStore.getState();
  const view = render(<SettingsModal onClose={vi.fn()} onUpdateFound={vi.fn()} initialTab="spotify" />);

  fireEvent.click(screen.getByRole("switch", { name: t.spotifyModeToggle }));

  expect(pausePlayback).toHaveBeenCalledOnce();
  expect(useSettingsStore.getState().spotifyMode).toBe(false);
  await Promise.resolve();
  expect(push).toHaveBeenCalledWith("error", t.toast.spotifyActionFailed);
  view.unmount();
});

it("opens directly at character shortcuts and returns focus to its trigger", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger); trigger.focus();
  const onClose = vi.fn();
  const view = render(<SettingsModal {...{onClose,onUpdateFound:vi.fn(),initialTab:"shortcuts" as const}} />);
  expect(document.activeElement).toBe(screen.getByRole("heading",{name:useI18nStore.getState().t.charSync.modeChar}));
  fireEvent.click(screen.getByRole("button",{name:useI18nStore.getState().t.close}));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
