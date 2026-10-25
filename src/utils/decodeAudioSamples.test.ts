import { afterEach, expect, it, vi } from "vitest";
vi.mock("./readAudioBytes", () => ({ readAudioBytes: vi.fn() }));
import { readAudioBytes } from "./readAudioBytes";
import { decodeAudioSamples } from "./decodeAudioSamples";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

it("uses the original direct-file reader for a separate audio analysis read", async () => {
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  const close = vi.fn();
  vi.stubGlobal("AudioContext", class {
    close = close;
    async decodeAudioData() {
      return { numberOfChannels: 1, length: 2, sampleRate: 44100,
        getChannelData: () => new Float32Array([0.1, 0.2]) };
    }
  });
  const result = await decodeAudioSamples("/song.mp3");
  expect(readAudioBytes).toHaveBeenCalledWith("/song.mp3");
  expect(result.samples).toHaveLength(2);
  expect(close).toHaveBeenCalledOnce();
});

it("does not begin file access for an already cancelled analysis", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(decodeAudioSamples("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(readAudioBytes).not.toHaveBeenCalled();
});

it("stops after a cancelled file read before opening an audio context", async () => {
  const controller = new AbortController();
  vi.mocked(readAudioBytes).mockImplementation(async () => {
    controller.abort();
    return { bytes: new Uint8Array([1]), transcoded: false };
  });
  const create = vi.fn();
  vi.stubGlobal("AudioContext", create);
  await expect(decodeAudioSamples("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(create).not.toHaveBeenCalled();
});

it("closes the context when cancellation arrives during native decoding", async () => {
  const controller = new AbortController();
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  const close = vi.fn();
  vi.stubGlobal("AudioContext", class {
    close = close;
    async decodeAudioData() {
      controller.abort();
      return { numberOfChannels: 1, length: 1, sampleRate: 1000, getChannelData: () => new Float32Array([1]) };
    }
  });
  await expect(decodeAudioSamples("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(close).toHaveBeenCalledOnce();
});

it("yields during long stereo mixdown and can cancel before the next chunk", async () => {
  const controller = new AbortController();
  vi.useFakeTimers();
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  const close = vi.fn();
  const left = new Float32Array(400001).fill(1);
  const right = new Float32Array(400001).fill(-0.5);
  vi.stubGlobal("AudioContext", class {
    close = close;
    async decodeAudioData() {
      return { numberOfChannels: 2, length: left.length, sampleRate: 44100,
        getChannelData: (channel: number) => channel === 0 ? left : right };
    }
  });
  const result = decodeAudioSamples("/song.mp3", controller.signal);
  const settled = result.then(() => null, (error: unknown) => error);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  await vi.runAllTimersAsync();
  expect(await settled).toMatchObject({ name: "AbortError" });
  expect(close).toHaveBeenCalledOnce();
});

it("averages both channels across a chunk boundary and returns mono PCM", async () => {
  vi.useFakeTimers();
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  const left = new Float32Array(200001).fill(1);
  const right = new Float32Array(200001).fill(-0.5);
  vi.stubGlobal("AudioContext", class {
    close = vi.fn();
    async decodeAudioData() {
      return { numberOfChannels: 2, length: left.length, sampleRate: 44100,
        getChannelData: (channel: number) => channel === 0 ? left : right };
    }
  });
  const pending = decodeAudioSamples("/song.mp3");
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.samples[0]).toBe(0.25);
  expect(result.samples[200000]).toBe(0.25);
});
