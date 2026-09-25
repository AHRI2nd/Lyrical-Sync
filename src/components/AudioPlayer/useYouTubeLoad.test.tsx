// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../stores/useSettingsStore", () => ({
  useSettingsStore: () => ({ ytdlpAudioQuality: "best", ytdlpCookiesFile: "", ytdlpProxy: "" }),
}));

import { useYouTubeLoad } from "./useYouTubeLoad";
import { useBusyStore } from "../../stores/useBusyStore";

describe("useYouTubeLoad — cancellation lifecycle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useBusyStore.setState({ reasons: new Set() });
  });
  afterEach(() => cleanup());

  it("keeps the load non-retryable until the native command settles after cancel", async () => {
    let resolveLoad!: (path: string) => void;
    invokeMock.mockImplementation((command: string) => {
      if (command === "ytdlp_load_audio") return new Promise<string>((resolve) => { resolveLoad = resolve; });
      return Promise.resolve(undefined);
    });
    const setAudioPath = vi.fn();
    const { result } = renderHook(() => useYouTubeLoad(setAudioPath));

    act(() => result.current.setYtUrl("https://youtube.com/watch?v=fixture"));
    let loadingOperation!: Promise<void>;
    act(() => { loadingOperation = result.current.handleYtLoad(); });
    expect(result.current.ytLoading).toBe(true);

    act(() => result.current.handleYtCancel());
    expect(invokeMock).toHaveBeenCalledWith("cancel_ytdlp_load");
    expect(result.current.ytLoading).toBe(true);
    expect(useBusyStore.getState().reasons.has("youtube-download")).toBe(true);

    await act(async () => {
      resolveLoad("/tmp/downloaded-audio.mp3");
      await loadingOperation;
    });

    expect(result.current.ytLoading).toBe(false);
    expect(useBusyStore.getState().reasons.has("youtube-download")).toBe(false);
    expect(setAudioPath).toHaveBeenCalledWith("/tmp/downloaded-audio.mp3");
  });
});
