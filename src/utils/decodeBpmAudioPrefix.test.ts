import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { decodeBpmAudioPrefix } from "./decodeBpmAudioPrefix";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("uses native prefix analysis and returns the refreshed file reference", async () => {
  const file = { path: "/moved/song.mp3", bookmark: "fresh" };
  vi.mocked(invoke).mockResolvedValue({ samples: [0.25, 0.5], sample_rate: 50, file });

  const result = await decodeBpmAudioPrefix("/song.mp3", "persisted");

  expect(invoke).toHaveBeenCalledWith("analyze_bpm_prefix", {
    path: "/song.mp3", bookmark: "persisted", runId: expect.any(String),
  });
  expect(result).toEqual({ samples: new Float32Array([0.25, 0.5]), sampleRate: 50, file });
});

it("does not start native work when already cancelled", async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(decodeBpmAudioPrefix("/song.mp3", null, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).not.toHaveBeenCalled();
});

it("requests owner-scoped native cancellation and reports an abort", async () => {
  const controller = new AbortController();
  let rejectAnalysis: ((reason: unknown) => void) | undefined;
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "analyze_bpm_prefix") {
      return new Promise((_, reject) => { rejectAnalysis = reject; });
    }
    rejectAnalysis?.("cancelled");
    return Promise.resolve();
  });
  const pending = decodeBpmAudioPrefix("/song.mp3", "grant", controller.signal);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("analyze_bpm_prefix", expect.any(Object)));

  controller.abort();

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).toHaveBeenCalledWith("cancel_audio_analysis", { runId: expect.any(String) });
});

it("rejects a native result that exceeds the prefix bound", async () => {
  vi.mocked(invoke).mockResolvedValue({
    samples: new Array(6001).fill(0.1), sample_rate: 50, file: { path: "/song.mp3", bookmark: null },
  });

  await expect(decodeBpmAudioPrefix("/song.mp3")).rejects.toMatchObject({ name: "EncodingError" });
});

it("rejects non-finite samples and invalid file references", async () => {
  vi.mocked(invoke).mockResolvedValue({
    samples: [0.1, Number.NaN], sample_rate: 50, file: { path: "/song.mp3", bookmark: null },
  });
  await expect(decodeBpmAudioPrefix("/song.mp3")).rejects.toMatchObject({ name: "EncodingError" });

  vi.mocked(invoke).mockResolvedValue({ samples: [0.1], sample_rate: 50, file: { path: 1, bookmark: null } });
  await expect(decodeBpmAudioPrefix("/song.mp3")).rejects.toMatchObject({ name: "EncodingError" });
});
