import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const readFile = vi.fn();
const invoke = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...args: unknown[]) => readFile(...args) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { readAudioBytes } from "./readAudioBytes";

const setPlatform = (platform: string) => vi.stubGlobal("navigator", { platform });

describe("readAudioBytes", () => {
  beforeEach(() => {
    readFile.mockReset();
    invoke.mockReset();
    setPlatform("MacIntel");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads a non-AIFF file directly, without transcoding", async () => {
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { bytes, transcoded } = await readAudioBytes("/song.mp3");
    expect(transcoded).toBe(false);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(readFile).toHaveBeenCalledWith("/song.mp3");
    expect(invoke).not.toHaveBeenCalledWith("decode_audio_to_wav", expect.anything());
  });

  it("does not transcode AIFF on macOS (native support)", async () => {
    setPlatform("MacIntel");
    readFile.mockResolvedValue(new Uint8Array([9]));
    const { transcoded } = await readAudioBytes("/song.aiff");
    expect(transcoded).toBe(false);
    expect(readFile).toHaveBeenCalledWith("/song.aiff");
  });

  it("transcodes AIFF to WAV on Windows and reads the transcoded path", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue("/tmp/transcoded.wav");
    readFile.mockResolvedValue(new Uint8Array([7]));
    const { bytes, transcoded } = await readAudioBytes("/song.aiff");
    expect(transcoded).toBe(true);
    expect(invoke).toHaveBeenCalledWith("decode_audio_to_wav", { path: "/song.aiff" });
    expect(readFile).toHaveBeenCalledWith("/tmp/transcoded.wav");
    expect(bytes).toEqual(new Uint8Array([7]));
  });

  it("recognizes the short .aif extension on Windows too", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue("/tmp/transcoded.wav");
    readFile.mockResolvedValue(new Uint8Array());
    const { transcoded } = await readAudioBytes("/song.aif");
    expect(transcoded).toBe(true);
  });

  it("is case-insensitive about the extension", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue("/tmp/transcoded.wav");
    readFile.mockResolvedValue(new Uint8Array());
    const { transcoded } = await readAudioBytes("/SONG.AIFF");
    expect(transcoded).toBe(true);
  });

  it("falls back to the read_audio_file command when readFile is out of fs scope", async () => {
    readFile.mockRejectedValue(new Error("forbidden path"));
    invoke.mockResolvedValue(new Uint8Array([4, 5, 6]).buffer);
    const { bytes, transcoded } = await readAudioBytes("/tmp/outside-scope.mp3");
    expect(transcoded).toBe(false);
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/tmp/outside-scope.mp3" });
    expect(bytes).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("falls back to read_audio_file using the transcoded path when that one is out of scope", async () => {
    setPlatform("Win32");
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "decode_audio_to_wav") return Promise.resolve("/tmp/transcoded.wav");
      if (cmd === "read_audio_file") return Promise.resolve(new Uint8Array([1]).buffer);
      return Promise.reject(new Error("unexpected"));
    });
    readFile.mockRejectedValue(new Error("forbidden path"));
    const { bytes, transcoded } = await readAudioBytes("/song.aiff");
    expect(transcoded).toBe(true);
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/tmp/transcoded.wav" });
    expect(bytes).toEqual(new Uint8Array([1]));
  });
});
