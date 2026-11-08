// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModeSelectButton } from "./ModeSelectButton";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useToastStore } from "../../stores/useToastStore";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("../../utils/audioControls", () => ({ audioControls: { pause: vi.fn() } }));
vi.mock("../../utils/deviceControls", () => ({ deviceControls: { stopAndReset: vi.fn() } }));

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset().mockResolvedValue(() => {});
  useSettingsStore.setState({ spotifyMode: false, youtubeMode: false, deviceMode: false });
  useServiceStore.setState({ isLoggedIn: false });
  useToastStore.setState({ toasts: [] });
  useI18nStore.getState().setLang("en");
});
afterEach(cleanup);

it("ignores an older yt-dlp check after a newer menu check resolves", async () => {
  let resolveInitial!: (value: string | null) => void;
  let resolveMenu!: (value: string | null) => void;
  invoke.mockImplementation((command: string) => {
    if (command !== "check_ytdlp") return Promise.resolve(undefined);
    return new Promise<string | null>((resolve) => {
      if (!resolveInitial) resolveInitial = resolve;
      else resolveMenu = resolve;
    });
  });

  render(<ModeSelectButton />);
  await vi.waitFor(() => expect(resolveInitial).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button"));
  await vi.waitFor(() => expect(resolveMenu).toBeTypeOf("function"));

  await act(async () => { resolveMenu("2026.11.08"); });
  expect(screen.getByText(useI18nStore.getState().t.modeYouTube)).toBeTruthy();

  await act(async () => { resolveInitial(null); });
  expect(screen.getByText(useI18nStore.getState().t.modeYouTube)).toBeTruthy();
  expect(screen.queryByText(`${useI18nStore.getState().t.modeYouTube} ${useI18nStore.getState().t.modeComingSoon}`)).toBeNull();
});

it("reports Spotify pause failure but still switches playback mode", async () => {
  const pausePlayback = vi.fn().mockRejectedValue(new Error("remote pause failed"));
  useSettingsStore.setState({ spotifyMode: true });
  useServiceStore.setState({ isLoggedIn: true, pausePlayback });
  invoke.mockResolvedValue(null);

  render(<ModeSelectButton />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.modeFile }));

  await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  expect(pausePlayback).toHaveBeenCalledOnce();
  expect(useSettingsStore.getState().spotifyMode).toBe(false);
  expect(useToastStore.getState().toasts[0]).toMatchObject({
    type: "error",
    message: useI18nStore.getState().t.toast.spotifyActionFailed,
  });
});
