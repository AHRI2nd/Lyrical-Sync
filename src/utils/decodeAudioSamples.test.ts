import { afterEach, expect, it, vi } from "vitest";
vi.mock("./readAudioBytes", () => ({ readAudioBytes: vi.fn() }));
import { readAudioBytes } from "./readAudioBytes";
import { decodeAudioSamples } from "./decodeAudioSamples";
import { detectBpm } from "./bpmDetect";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

it("passes a complete owned byte buffer to Web Audio without copying it", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes, transcoded: false });
  const decodeAudioData = vi.fn(async (_buffer: ArrayBuffer) => ({
    numberOfChannels: 1, length: 1, sampleRate: 48000,
    getChannelData: () => new Float32Array([0.5]),
  }));
  vi.stubGlobal("AudioContext", class {
    close = vi.fn();
    decodeAudioData = decodeAudioData;
  });

  const result = await decodeAudioSamples("/song.mp3");
  expect(result.samples).toEqual(new Float32Array([0.5]));
  expect(decodeAudioData).toHaveBeenCalledWith(bytes.buffer);
  expect(decodeAudioData.mock.calls[0][0]).toBe(bytes.buffer);
});

it("requests the 48 kHz rate used by the native PCM resource estimate", async () => {
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  let options: AudioContextOptions | undefined;
  vi.stubGlobal("AudioContext", class {
    constructor(value?: AudioContextOptions) { options = value; }
    close = vi.fn();
    async decodeAudioData() {
      return { numberOfChannels: 1, length: 1, sampleRate: 48000, getChannelData: () => new Float32Array([0.5]) };
    }
  });

  await decodeAudioSamples("/song.mp3");

  expect(options?.sampleRate).toBe(48000);
});

it("copies only the selected bytes when the file reader returns a partial view", async () => {
  const backing = new Uint8Array([99, 1, 2, 3, 88]);
  const bytes = backing.subarray(1, 4);
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes, transcoded: false });
  const decodeAudioData = vi.fn(async (_buffer: ArrayBuffer) => ({
    numberOfChannels: 1, length: 1, sampleRate: 48000,
    getChannelData: () => new Float32Array([0.5]),
  }));
  vi.stubGlobal("AudioContext", class {
    close = vi.fn();
    decodeAudioData = decodeAudioData;
  });

  await decodeAudioSamples("/song.mp3");
  const submitted = decodeAudioData.mock.calls[0][0];
  expect(submitted).not.toBe(backing.buffer);
  expect(new Uint8Array(submitted)).toEqual(new Uint8Array([1, 2, 3]));
  expect(backing).toEqual(new Uint8Array([99, 1, 2, 3, 88]));
});

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
  expect(readAudioBytes).toHaveBeenCalledWith("/song.mp3", undefined);
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

it("closes the context when decoding fails from an unavailable memory allocation", async () => {
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  const close = vi.fn();
  vi.stubGlobal("AudioContext", class {
    close = close;
    async decodeAudioData() { throw new DOMException("allocation failed", "EncodingError"); }
  });

  await expect(decodeAudioSamples("/song.mp3")).rejects.toMatchObject({ name: "EncodingError" });
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

it("mixes channel energy across a chunk boundary and returns mono analysis samples", async () => {
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
  expect(result.samples[0]).toBeCloseTo(Math.sqrt(0.625));
  expect(result.samples[200000]).toBeCloseTo(Math.sqrt(0.625));
});

it("preserves BPM attacks from opposite-phase stereo channels", async () => {
  const left = new Float32Array(12_000);
  for (let start = 100; start < left.length; start += 500) left.fill(1, start, start + 20);
  const right = Float32Array.from(left, value => -value);
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  vi.stubGlobal("AudioContext", class {
    close = vi.fn();
    async decodeAudioData() {
      return { numberOfChannels: 2, length: left.length, sampleRate: 1000,
        getChannelData: (channel: number) => channel === 0 ? left : right };
    }
  });

  const { samples, sampleRate } = await decodeAudioSamples("/anti-phase.wav");

  expect(detectBpm(left, 1000)?.bpm).toBe(120);
  expect(detectBpm(samples, sampleRate)?.bpm).toBe(120);
});

it("returns only the first two minutes needed for BPM analysis", async () => {
  const sampleRate = 1_000;
  const fullTrack = new Float32Array(sampleRate * 121).fill(0.25);
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false });
  vi.stubGlobal("AudioContext", class {
    close = vi.fn();
    async decodeAudioData() {
      return {
        numberOfChannels: 1,
        length: fullTrack.length,
        sampleRate,
        getChannelData: () => fullTrack,
      };
    }
  });

  const result = await decodeAudioSamples("/long-track.wav");

  expect(result.samples).toHaveLength(sampleRate * 120);
  expect(result.samples[0]).toBeCloseTo(0.25);
  expect(result.samples[result.samples.length - 1]).toBeCloseTo(0.25);
});
