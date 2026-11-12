import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { decodeAudioSamples } from "./decodeAudioSamples";
import { detectBpm } from "./bpmDetect";

beforeEach(() => vi.mocked(invoke).mockReset());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

it("requests a native prefix and treats each returned value as one 20 ms RMS bucket", async () => {
  const energies = new Float32Array(6000);
  for (let frame = 5; frame < energies.length; frame += 25) energies[frame] = 1;
  vi.mocked(invoke).mockResolvedValue(energies.buffer);

  const result = await decodeAudioSamples("/song.mp3");

  expect(result.sampleRate).toBe(50);
  expect(result.samples).toEqual(energies);
  expect(invoke).toHaveBeenCalledTimes(1);
  const [command, args] = vi.mocked(invoke).mock.calls[0];
  expect(command).toBe("analyze_bpm_prefix");
  expect(args).toMatchObject({ path: "/song.mp3" });
  expect(typeof (args as Record<string, unknown>).runId).toBe("string");
  expect(detectBpm(result.samples, result.sampleRate)?.bpm).toBe(120);
});

it("rejects a malformed or oversized native response", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
  await expect(decodeAudioSamples("/song.wav")).rejects.toMatchObject({ name: "EncodingError" });

  vi.mocked(invoke).mockResolvedValueOnce(new Float32Array(6001).buffer);
  await expect(decodeAudioSamples("/long.wav")).rejects.toMatchObject({ name: "EncodingError" });
});

it("decodes a raw byte array returned by native IPC", async () => {
  vi.mocked(invoke).mockResolvedValue([0, 0, 128, 63, 0, 0, 0, 63]);

  const result = await decodeAudioSamples("/song.wav");

  expect(result.sampleRate).toBe(50);
  expect(Array.from(result.samples)).toEqual([1, 0.5]);
});

it("does not invoke native work for an already cancelled analysis", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(decodeAudioSamples("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).not.toHaveBeenCalled();
});

it("cancels the native run and maps its cancellation result to AbortError", async () => {
  const controller = new AbortController();
  let rejectAnalysis!: (reason: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "analyze_bpm_prefix") {
      return new Promise((_resolve, reject) => { rejectAnalysis = reject; });
    }
    return Promise.resolve(undefined);
  });

  const pending = decodeAudioSamples("/song.mp3", controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "cancel_audio_analysis")).toBe(true));
  const analyzeArgs = vi.mocked(invoke).mock.calls.find(([command]) => command === "analyze_bpm_prefix")?.[1];
  const cancelCall = vi.mocked(invoke).mock.calls.find(([command]) => command === "cancel_audio_analysis");
  expect(cancelCall?.[1]).toEqual({ runId: (analyzeArgs as Record<string, unknown> | undefined)?.runId });
  rejectAnalysis("cancelled");

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
