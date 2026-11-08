// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";

const menuMocks = vi.hoisted(() => ({
  menuNew: vi.fn(),
  setAsAppMenu: vi.fn(),
  submenuNew: vi.fn(),
  menuItemNew: vi.fn(),
  predefinedNew: vi.fn(),
  checkMenuItemNew: vi.fn(),
  setText: vi.fn(),
  setChecked: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: menuMocks.menuNew },
  Submenu: { new: menuMocks.submenuNew },
  MenuItem: { new: menuMocks.menuItemNew },
  PredefinedMenuItem: { new: menuMocks.predefinedNew },
  CheckMenuItem: { new: menuMocks.checkMenuItemNew },
}));

it("reuses one native menu tree when mode or locale changes", async () => {
  vi.resetModules();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  menuMocks.menuNew.mockReset().mockResolvedValue({ setAsAppMenu: menuMocks.setAsAppMenu });
  menuMocks.setAsAppMenu.mockReset().mockResolvedValue(null);
  menuMocks.setText.mockReset().mockResolvedValue(undefined);
  menuMocks.setChecked.mockReset().mockResolvedValue(undefined);
  menuMocks.setEnabled.mockReset().mockResolvedValue(undefined);
  menuMocks.submenuNew.mockReset().mockResolvedValue({ setText: menuMocks.setText });
  menuMocks.menuItemNew.mockReset().mockResolvedValue({ setText: menuMocks.setText });
  menuMocks.predefinedNew.mockReset().mockResolvedValue({});
  menuMocks.checkMenuItemNew.mockReset().mockResolvedValue({
    setText: menuMocks.setText,
    setChecked: menuMocks.setChecked,
    setEnabled: menuMocks.setEnabled,
  });

  const { useMacMenu } = await import("./useMacMenu");
  const translations = (settings: string) => ({
    menu: {
      settings, file: "File", edit: "Edit", playback: "Playback", mode: "Mode", view: "View", help: "Help",
      saveAsLrc: "Save LRC", saveAsSrt: "Save SRT", playPause: "Play", skipBack5: "Back 5",
      skipBack1: "Back 1", skipFwd1: "Forward 1", skipFwd5: "Forward 5", stop: "Stop",
    },
    newFileBtn: "New", openLrc: "Open LRC", openAudio: "Open Audio", save: "Save", undo: "Undo", redo: "Redo",
    previewBtn: "Preview", shortcutsTitle: "Shortcuts", modeFile: "File mode", modeYouTube: "YouTube", modeDevice: "Device",
  }) as never;
  const state = (overrides = {}) => ({
    t: translations("Settings"),
    spotifyMode: false,
    youtubeMode: false,
    deviceMode: false,
    ytdlpInstalled: false,
    ...overrides,
  });
  const first = state();
  const { rerender } = renderHook(({ current }) => useMacMenu({} as never, current as never), {
    initialProps: { current: first },
    wrapper: StrictMode,
  });
  await waitFor(() => expect(menuMocks.setAsAppMenu).toHaveBeenCalledOnce());

  rerender({ current: state({ spotifyMode: true }) });
  rerender({ current: state({ t: translations("Einstellungen") }) });
  await waitFor(() => expect(menuMocks.menuNew).toHaveBeenCalledOnce());
  expect(menuMocks.submenuNew).toHaveBeenCalledTimes(7);
  await waitFor(() => expect(menuMocks.setChecked).toHaveBeenCalled());
  expect(menuMocks.setText).toHaveBeenCalledWith("Einstellungen");
  expect(menuMocks.setEnabled).toHaveBeenCalledWith(false);
});

it("reports native menu creation failures locally", async () => {
  vi.resetModules();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  const menuApi = await import("@tauri-apps/api/menu");
  vi.mocked(menuApi.PredefinedMenuItem.new).mockRejectedValueOnce(new Error("native menu unavailable"));
  const { useMacMenu } = await import("./useMacMenu");
  const logError = vi.spyOn(console, "error").mockImplementation(() => {});
  const reportRuntimeError = vi.fn();
  window.addEventListener("lyrical-runtime-error", reportRuntimeError);

  renderHook(() => useMacMenu({} as never, {
    t: {} as never,
    spotifyMode: false,
    youtubeMode: false,
    deviceMode: false,
    ytdlpInstalled: false,
  }));

  await waitFor(() => {
    expect(reportRuntimeError).toHaveBeenCalledOnce();
  });
  expect(logError).toHaveBeenCalledWith("Failed to create macOS application menu", expect.any(Error));
  window.removeEventListener("lyrical-runtime-error", reportRuntimeError);
  logError.mockRestore();
});
