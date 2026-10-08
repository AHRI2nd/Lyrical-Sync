import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { prepareFileRef, readLyrics, writeLyrics, readAudio, readAudioMetadata } from "./fileAccess";

describe("file access IPC boundary", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("reads a moved file with its refreshed bookmark", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ path: "/moved/song.lrc", bookmark: "fresh" })
      .mockResolvedValueOnce("[00:01.00]hello");
    expect(await readLyrics({ path: "/old/song.lrc", bookmark: "stale" })).toEqual({
      value: "[00:01.00]hello", file: { path: "/moved/song.lrc", bookmark: "fresh" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "read_lrc_file", {
      path: "/moved/song.lrc", bookmark: "fresh",
    });
  });

  it("does not read the original path after bookmark resolution fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Select the file again"));
    await expect(readLyrics({ path: "/old/song.lrc", bookmark: "invalid" }))
      .rejects.toThrow("Select the file again");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("writes with the prepared bookmark and propagates an I/O error", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ path: "/song.lrc", bookmark: "fresh" })
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(writeLyrics({ path: "/song.lrc", bookmark: "old" }, "draft"))
      .rejects.toThrow("disk full");
    expect(invoke).toHaveBeenLastCalledWith("write_lrc_file", {
      path: "/song.lrc", bookmark: "fresh", content: "draft",
    });
  });

  it("uses a Windows ordinary file reference without resolving an Apple bookmark", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("draft");
    expect(await readLyrics({ path: "C:\\Music\\song.lrc", bookmark: null })).toEqual({
      value: "draft", file: { path: "C:\\Music\\song.lrc", bookmark: null },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps native audio bytes binary after preparing the reference", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ path: "/song.mp3", bookmark: "fresh" })
      .mockResolvedValueOnce(Uint8Array.from([1, 2, 3]).buffer);
    const result = await readAudio({ path: "/song.mp3", bookmark: "old" });
    expect(result.value).toEqual(Uint8Array.from([1, 2, 3]));
    expect(result.file.bookmark).toBe("fresh");
  });

  it("reads metadata using the resolved location", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ path: "/new/song.mp3", bookmark: "fresh" })
      .mockResolvedValueOnce({ title: "Song", artist: "Artist", album: "Album" });
    expect((await readAudioMetadata({ path: "/old/song.mp3", bookmark: "old" })).value)
      .toEqual({ title: "Song", artist: "Artist", album: "Album" });
    expect(invoke).toHaveBeenLastCalledWith("read_audio_metadata", {
      path: "/new/song.mp3", bookmark: "fresh",
    });
  });

  it("does not open any native scope when preparing a bookmark-free reference", async () => {
    expect(await prepareFileRef({ path: "/selected/song.lrc", bookmark: null }))
      .toEqual({ path: "/selected/song.lrc", bookmark: null });
    expect(invoke).not.toHaveBeenCalled();
  });
});
