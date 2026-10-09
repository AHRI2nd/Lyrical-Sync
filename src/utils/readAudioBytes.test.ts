import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { readAudioBytes } from "./readAudioBytes";

describe("readAudioBytes scoped native reads", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "read_audio_file") return Promise.resolve(Uint8Array.from([1, 2, 3]).buffer);
      if (command === "decode_audio_to_wav") return Promise.resolve(Uint8Array.from([1, 2, 3]).buffer);
      throw new Error("Unexpected command");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads ordinary audio through the native scoped command", async () => {
    expect(await readAudioBytes("/song.mp3")).toEqual({
      bytes: Uint8Array.from([1, 2, 3]), transcoded: false,
      file: { path: "/song.mp3", bookmark: null },
    });
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/song.mp3", bookmark: null });
  });

  it("keeps macOS AIFF native without requesting conversion", async () => {
    expect((await readAudioBytes("/song.aiff")).transcoded).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_audio_file", { path: "/song.aiff", bookmark: null });
  });

  it.each(["aiff", "aif", "AIFF"])("converts Windows %s with one binary response", async (extension) => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const path = "C:/Music/song." + extension;
    const result = await readAudioBytes(path);
    expect(result.bytes).toEqual(Uint8Array.from([1, 2, 3]));
    expect(result.transcoded).toBe(true);
    expect(result.file.path).toBe(path);
    expect(invoke).toHaveBeenNthCalledWith(1, "decode_audio_to_wav", { path, bookmark: null });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("retains a moved audio file reference for its owner", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "prepare_file_ref") return Promise.resolve({ path: "/moved/song.mp3", bookmark: "fresh" });
      return Promise.resolve(Uint8Array.from([7]).buffer);
    });
    const result = await readAudioBytes("/old/song.mp3", "old");
    expect(result.file).toEqual({ path: "/moved/song.mp3", bookmark: "fresh" });
    expect(result.bytes).toEqual(Uint8Array.from([7]));
    expect(invoke).toHaveBeenLastCalledWith("read_audio_file", {
      path: "/moved/song.mp3", bookmark: "fresh",
    });
  });

  it("does not retry an unscoped path after grant failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Select again"));
    await expect(readAudioBytes("/song.mp3", "invalid")).rejects.toThrow("Select again");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("propagates conversion errors without reading a temporary or original fallback", async () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Truncated audio"));
    await expect(readAudioBytes("C:/bad.aiff")).rejects.toThrow("Truncated audio");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent conversion bytes associated with their original files", async () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    vi.mocked(invoke).mockImplementation((_command, args) =>
      Promise.resolve(Uint8Array.from([args && typeof args === "object" && "path" in args && args.path === "C:/first.aiff" ? 1 : 2]).buffer));
    const [first, second] = await Promise.all([readAudioBytes("C:/first.aiff"), readAudioBytes("C:/second.aiff")]);
    expect(first.bytes).toEqual(Uint8Array.from([1]));
    expect(second.bytes).toEqual(Uint8Array.from([2]));
    expect(first.file.path).toBe("C:/first.aiff");
    expect(second.file.path).toBe("C:/second.aiff");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

});
