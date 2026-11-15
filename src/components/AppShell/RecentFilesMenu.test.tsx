// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { RecentFilesMenu } from "./RecentFilesMenu";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";

afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined as never);
});

it("exposes expanded state and closes the recent-files popup on Escape", () => {
  useSettingsStore.setState({ recentFiles: [{ lrcPath: "/music/song.lrc", audioPath: null, openedAt: 1 }] });
  const t = useI18nStore.getState().t;
  render(<RecentFilesMenu onOpen={() => {}} />);
  const trigger = screen.getByRole("button", { name: t.recentFiles });

  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const file = screen.getByRole("button", { name: "song.lrc" });
  fireEvent.keyDown(file, { key: "Escape" });

  expect(screen.queryByRole("group", { name: t.recentFiles })).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("does not close the recent-files popup for an IME Escape event", () => {
  useSettingsStore.setState({ recentFiles: [{ lrcPath: "/music/song.lrc", audioPath: null, openedAt: 1 }] });
  const t = useI18nStore.getState().t;
  render(<RecentFilesMenu onOpen={() => {}} />);
  const trigger = screen.getByRole("button", { name: t.recentFiles });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("button", { name: "song.lrc" }), { key: "Escape", isComposing: false, keyCode: 229 });

  expect(screen.getByRole("group", { name: t.recentFiles })).toBeTruthy();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("keeps the recent-files popup aligned within the right edge of its header", () => {
  useSettingsStore.setState({ recentFiles: [{ lrcPath: "/music/song.lrc", audioPath: null, openedAt: 1 }] });
  const t = useI18nStore.getState().t;
  render(<RecentFilesMenu onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: t.recentFiles }));

  const popup = screen.getByRole("group", { name: t.recentFiles });
  expect(popup.className).toContain("right-0");
  expect(popup.className).not.toContain("left-0");
});

it("clears native file grants before removing recent entries", async () => {
  useSettingsStore.setState({ recentFiles: [{ lrcPath: "/music/song.lrc", audioPath: null, openedAt: 1 }] });
  const t = useI18nStore.getState().t;
  render(<RecentFilesMenu onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: t.recentFiles }));

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: t.clearRecentFiles }));
    await Promise.resolve();
  });

  expect(invoke).toHaveBeenCalledWith("clear_recent_file_grants");
  expect(useSettingsStore.getState().recentFiles).toEqual([]);
});

it("keeps recent entries when native grant clearing fails", async () => {
  const recentFiles = [{ lrcPath: "/music/song.lrc", audioPath: null, openedAt: 1 }];
  useSettingsStore.setState({ recentFiles });
  vi.mocked(invoke).mockRejectedValueOnce(new Error("permission store unavailable"));
  const t = useI18nStore.getState().t;
  render(<RecentFilesMenu onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: t.recentFiles }));

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: t.clearRecentFiles }));
    await Promise.resolve();
  });
  await waitFor(() => expect(useSettingsStore.getState().recentFiles).toEqual(recentFiles));
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
