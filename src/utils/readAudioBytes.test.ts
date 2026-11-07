import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { readAudioBytes } from "./readAudioBytes";

const setPlatform = (platform: string) => vi.stubGlobal("navigator", { platform });

describe("readAudioBytes", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "read_audio_file") return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
      throw new Error(`Unexpected native command: ${command}`);
    });
    setPlatform("MacIntel");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the native validated snapshot for a non-AIFF file", async () => {
    const { bytes, transcoded } = await readAudioBytes("/song.mp3");

    expect(transcoded).toBe(false);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/song.mp3" });
  });

  it("surfaces native validation failures without reading through a second path", async () => {
    invoke.mockRejectedValue(new Error("AUDIO_RESOURCE_LIMIT"));

    await expect(readAudioBytes("/very-long-song.mp3")).rejects.toThrow("AUDIO_RESOURCE_LIMIT");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not start a native read when the audio source has already been cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(readAudioBytes("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops after a cancelled native read before returning bytes for decoding", async () => {
    const controller = new AbortController();
    invoke.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([1, 2, 3]).buffer;
    });

    await expect(readAudioBytes("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses native audio support for AIFF on macOS without transcoding", async () => {
    setPlatform("MacIntel");

    const { transcoded } = await readAudioBytes("/song.aiff");

    expect(transcoded).toBe(false);
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/song.aiff" });
  });

  it("transcodes AIFF to WAV bytes on Windows without creating a readable temp path", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue(new Uint8Array([7]).buffer);

    const { bytes, transcoded } = await readAudioBytes("/song.aiff");

    expect(transcoded).toBe(true);
    expect(invoke).toHaveBeenCalledWith("decode_audio_to_wav", { path: "/song.aiff" });
    expect(bytes).toEqual(new Uint8Array([7]));
  });

  it("recognizes the short .aif extension on Windows too", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue(new Uint8Array().buffer);

    const { transcoded } = await readAudioBytes("/song.aif");

    expect(transcoded).toBe(true);
    expect(invoke).toHaveBeenCalledWith("decode_audio_to_wav", { path: "/song.aif" });
  });

  it("uses a case-insensitive AIFF extension check", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue(new Uint8Array().buffer);

    await readAudioBytes("/SONG.AIFF");

    expect(invoke).toHaveBeenCalledWith("decode_audio_to_wav", { path: "/SONG.AIFF" });
  });
});
