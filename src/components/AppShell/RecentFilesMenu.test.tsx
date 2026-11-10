// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { RecentFilesMenu } from "./RecentFilesMenu";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useLrcStore } from "../../stores/useLrcStore";

beforeEach(() => {
  cleanup();
  useSettingsStore.setState({ recentFiles: [{ lrcPath: "/songs/one.lrc", audioPath: null, lrcBookmark: null, audioBookmark: null, openedAt: 1 }] });
});

it("exposes the expanded state and closes on Escape with focus returned to the trigger", () => {
  const label = useI18nStore.getState().t.recentFiles;
  render(<RecentFilesMenu />);
  const trigger = screen.getByRole("button", { name: label });

  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const panel = screen.getByRole("group", { name: label });
  expect(trigger.getAttribute("aria-controls")).toBe(panel.id);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("group", { name: label })).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("keeps the popover open for an IME Escape and closes on outside interaction", () => {
  const label = useI18nStore.getState().t.recentFiles;
  render(<RecentFilesMenu />);
  const trigger = screen.getByRole("button", { name: label });
  fireEvent.click(trigger);

  fireEvent.keyDown(document, { key: "Escape", isComposing: true });
  expect(screen.getByRole("group", { name: label })).toBeTruthy();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("group", { name: label })).toBeNull();
});

it("keeps selecting and clearing recent files available", () => {
  const t = useI18nStore.getState().t;
  const transition = vi.fn().mockResolvedValue(true);
  useLrcStore.setState({ requestDocumentTransition: transition });
  render(<RecentFilesMenu />);
  fireEvent.click(screen.getByRole("button", { name: t.recentFiles }));
  fireEvent.click(screen.getByRole("button", { name: "one.lrc" }));
  expect(transition).toHaveBeenCalledOnce();
  expect(screen.queryByRole("group", { name: t.recentFiles })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: t.recentFiles }));
  fireEvent.click(screen.getByRole("button", { name: t.clearRecentFiles }));
  expect(useSettingsStore.getState().recentFiles).toEqual([]);
});
