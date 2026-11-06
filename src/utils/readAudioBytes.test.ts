import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const readFile = vi.fn();
const invoke = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...args: unknown[]) => readFile(...args) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { readAudioBytes } from "./readAudioBytes";

const setPlatform = (platform: string) => vi.stubGlobal("navigator", { platform });
let fileSize = 3;
let fileMtime = "100.000000001";
let fileId: string | null = "12:34";

describe("readAudioBytes", () => {
  beforeEach(() => {
    readFile.mockReset();
    invoke.mockReset();
    fileSize = 3;
    fileMtime = "100.000000001";
    fileId = "12:34";
    invoke.mockImplementation((command: string) => {
      if (command === "validate_audio_file") return Promise.resolve(undefined);
      if (command === "get_audio_file_info") {
        return Promise.resolve({ size: fileSize, mtime: fileMtime, fileId });
      }
      throw new Error(`Unexpected native command: ${command}`);
    });
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

  it("checks the decoded-memory budget before reading a non-AIFF file", async () => {
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await readAudioBytes("/song.mp3");
    expect(invoke).toHaveBeenCalledWith("validate_audio_file", { path: "/song.mp3" });
    expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(readFile.mock.invocationCallOrder[0]);
  });

  it("rejects an unsafe audio file before reading its bytes", async () => {
    invoke.mockRejectedValue(new Error("AUDIO_RESOURCE_LIMIT"));
    await expect(readAudioBytes("/very-long-song.mp3")).rejects.toThrow("AUDIO_RESOURCE_LIMIT");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not start a file read when the audio source has already been cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readAudioBytes("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("stops after a cancelled file read before returning bytes for decoding", async () => {
    const controller = new AbortController();
    readFile.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([1, 2, 3]);
    });
    await expect(readAudioBytes("/song.mp3", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not transcode AIFF on macOS (native support)", async () => {
    setPlatform("MacIntel");
    fileSize = 1;
    readFile.mockResolvedValue(new Uint8Array([9]));
    const { transcoded } = await readAudioBytes("/song.aiff");
    expect(transcoded).toBe(false);
    expect(readFile).toHaveBeenCalledWith("/song.aiff");
  });

  it("transcodes AIFF to WAV bytes on Windows without creating a readable temp path", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue(new Uint8Array([7]).buffer);
    const { bytes, transcoded } = await readAudioBytes("/song.aiff");
    expect(transcoded).toBe(true);
    expect(invoke).toHaveBeenCalledWith("decode_audio_to_wav", { path: "/song.aiff" });
    expect(readFile).not.toHaveBeenCalled();
    expect(bytes).toEqual(new Uint8Array([7]));
  });

  it("recognizes the short .aif extension on Windows too", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue(new Uint8Array().buffer);
    const { transcoded } = await readAudioBytes("/song.aif");
    expect(transcoded).toBe(true);
  });

  it("is case-insensitive about the extension", async () => {
    setPlatform("Win32");
    invoke.mockResolvedValue(new Uint8Array().buffer);
    const { transcoded } = await readAudioBytes("/SONG.AIFF");
    expect(transcoded).toBe(true);
  });

  it("falls back to the read_audio_file command when readFile is out of fs scope", async () => {
    readFile.mockRejectedValue(new Error("forbidden path"));
    invoke.mockImplementation((command: string) => {
      if (command === "get_audio_file_info") return Promise.resolve({ size: 3, mtime: fileMtime, fileId });
      if (command === "read_audio_file") return Promise.resolve(new Uint8Array([4, 5, 6]).buffer);
      if (command === "validate_audio_file") return Promise.resolve(undefined);
      throw new Error(`Unexpected native command: ${command}`);
    });
    const { bytes, transcoded } = await readAudioBytes("/tmp/outside-scope.mp3");
    expect(transcoded).toBe(false);
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/tmp/outside-scope.mp3" });
    expect(bytes).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("rejects a changed mtime without a second full-file read", async () => {
    readFile.mockImplementation(async () => {
      fileMtime = "100.000000002"; // Changes within the same second matter.
      return new Uint8Array([1, 2, 3]);
    });
    await expect(readAudioBytes("/song.mp3")).rejects.toThrow("Audio file changed during read");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("read_audio_file", expect.anything());
  });

  it("rejects a same-size, same-mtime replacement when its file identity differs", async () => {
    readFile.mockImplementation(async () => {
      fileId = "12:99";
      return new Uint8Array([1, 2, 3]);
    });
    await expect(readAudioBytes("/song.mp3")).rejects.toThrow("Audio file changed during read");
    expect(invoke).not.toHaveBeenCalledWith("read_audio_file", expect.anything());
  });

  it("rejects a truncated read even if file metadata is unchanged", async () => {
    readFile.mockResolvedValue(new Uint8Array([1, 2]));
    await expect(readAudioBytes("/song.mp3")).rejects.toThrow("Audio file changed during read");
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("never copies the file for metadata when native file info fails", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "validate_audio_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("native identity check denied"));
    });
    await expect(readAudioBytes("/song.mp3")).rejects.toThrow("native identity check denied");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not fall back to a temporary file after AIFF transcoding", async () => {
    setPlatform("Win32");
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "decode_audio_to_wav") return Promise.resolve(new Uint8Array([1]).buffer);
      return Promise.reject(new Error("unexpected"));
    });
    const { bytes, transcoded } = await readAudioBytes("/song.aiff");
    expect(transcoded).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("read_audio_file", expect.anything());
    expect(bytes).toEqual(new Uint8Array([1]));
  });
});
