// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecentFilesMenu } from "./RecentFilesMenu";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";

afterEach(() => cleanup());

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
