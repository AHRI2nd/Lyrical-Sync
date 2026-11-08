// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn(async () => ({ setAsAppMenu: vi.fn(async () => {}) })) },
  Submenu: { new: vi.fn(async () => ({})) },
  MenuItem: { new: vi.fn(async () => ({})) },
  PredefinedMenuItem: { new: vi.fn(async () => ({})) },
  CheckMenuItem: { new: vi.fn(async () => ({})) },
}));

it("reports native menu creation failures locally", async () => {
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
