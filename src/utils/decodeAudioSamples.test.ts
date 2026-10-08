import { afterEach, expect, it, vi } from "vitest";
vi.mock("./readAudioBytes", () => ({ readAudioBytes: vi.fn() }));
import { readAudioBytes } from "./readAudioBytes";
import { decodeAudioSamples } from "./decodeAudioSamples";

afterEach(() => vi.unstubAllGlobals());

it("uses the persistent grant for a separate audio analysis read", async () => {
  const file = { path: "/moved/song.mp3", bookmark: "fresh" };
  vi.mocked(readAudioBytes).mockResolvedValue({ bytes: new Uint8Array([1]), transcoded: false, file });
  const close = vi.fn();
  vi.stubGlobal("AudioContext", class {
    close = close;
    async decodeAudioData() {
      return { numberOfChannels: 1, length: 2, sampleRate: 44100,
        getChannelData: () => new Float32Array([0.1, 0.2]) };
    }
  });
  const result = await decodeAudioSamples("/song.mp3", "persisted");
  expect(readAudioBytes).toHaveBeenCalledWith("/song.mp3", "persisted");
  expect(result.file).toEqual(file);
  expect(result.samples).toHaveLength(2);
  expect(close).toHaveBeenCalledOnce();
});
