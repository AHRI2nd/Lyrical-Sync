import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
const readDirMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: (...args: unknown[]) => readDirMock(...args) }));

import { findMatchingAudio, runBatchOperation, type BatchFileEntry } from "./batchProcessor";

const LRC = "[ti:Song]\n[00:01.00]hello\n[00:03.00]world";

beforeEach(() => {
  invokeMock.mockReset();
  readDirMock.mockReset();
});

describe("findMatchingAudio", () => {
  it("finds a same-stem audio file in the same directory", async () => {
    readDirMock.mockResolvedValue([
      { name: "song.lrc", isFile: true, isDirectory: false, isSymlink: false },
      { name: "song.mp3", isFile: true, isDirectory: false, isSymlink: false },
      { name: "other.wav", isFile: true, isDirectory: false, isSymlink: false },
    ]);
    const result = await findMatchingAudio("/music/song.lrc");
    expect(result).toBe("/music/song.mp3");
  });

  it("returns null when nothing matches", async () => {
    readDirMock.mockResolvedValue([{ name: "other.mp3", isFile: true, isDirectory: false, isSymlink: false }]);
    expect(await findMatchingAudio("/music/song.lrc")).toBeNull();
  });

  it("returns null when the directory can't be read (out of scope, etc.)", async () => {
    readDirMock.mockRejectedValue(new Error("permission denied"));
    expect(await findMatchingAudio("/music/song.lrc")).toBeNull();
  });

  it("ignores non-audio extensions and directories", async () => {
    readDirMock.mockResolvedValue([
      { name: "song.txt", isFile: true, isDirectory: false, isSymlink: false },
      { name: "song", isFile: false, isDirectory: true, isSymlink: false },
    ]);
    expect(await findMatchingAudio("/music/song.lrc")).toBeNull();
  });
});

describe("runBatchOperation", () => {
  const entry = (lrcPath: string): BatchFileEntry => ({ lrcPath, audioPath: null, status: "pending" });

  it("applies an offset to every file and writes the shifted content", async () => {
    invokeMock.mockImplementation((cmd: string) => (cmd === "read_lrc_file" ? Promise.resolve(LRC) : Promise.resolve()));
    const entries = [entry("/a.lrc"), entry("/b.lrc")];
    const progress: [number, string][] = [];
    await runBatchOperation(entries, { kind: "offset", deltaSeconds: 1 }, (i, status) => progress.push([i, status]));

    expect(progress).toEqual([[0, "processing"], [0, "done"], [1, "processing"], [1, "done"]]);
    const writeCalls = invokeMock.mock.calls.filter((c) => c[0] === "write_lrc_file");
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0][1].content).toContain("[00:02.00]hello");
    expect(writeCalls[0][1].content).toContain("[00:04.00]world");
  });

  it("converts format and writes to a new path with the target extension", async () => {
    invokeMock.mockImplementation((cmd: string) => (cmd === "read_lrc_file" ? Promise.resolve(LRC) : Promise.resolve()));
    await runBatchOperation([entry("/song.lrc")], { kind: "convert", format: "srt" }, () => {});
    const writeCall = invokeMock.mock.calls.find((c) => c[0] === "write_lrc_file");
    expect(writeCall?.[1].path).toBe("/song.srt");
    expect(writeCall?.[1].content).toContain("-->");
  });

  it("reports a per-file error and continues with the rest of the batch", async () => {
    invokeMock.mockImplementation((cmd: string, args: { path: string }) => {
      if (cmd === "read_lrc_file") {
        if (args.path === "/bad.lrc") return Promise.reject(new Error("not found"));
        return Promise.resolve(LRC);
      }
      return Promise.resolve();
    });
    const entries = [entry("/bad.lrc"), entry("/good.lrc")];
    const progress: [number, string, string?][] = [];
    await runBatchOperation(entries, { kind: "offset", deltaSeconds: 1 }, (i, status, error) => progress.push([i, status, error]));

    expect(progress[1]).toEqual([0, "error", "Error: not found"]);
    expect(progress[2]).toEqual([1, "processing", undefined]);
    expect(progress[3]).toEqual([1, "done", undefined]);
  });

  it("skips tagging SRT files (no metadata concept) and reports it as an error", async () => {
    invokeMock.mockImplementation((cmd: string) => (cmd === "read_lrc_file" ? Promise.resolve(LRC) : Promise.resolve()));
    const progress: [number, string][] = [];
    await runBatchOperation([entry("/song.srt")], { kind: "tag", title: "New Title" }, (i, status) => progress.push([i, status]));
    expect(progress).toEqual([[0, "processing"], [0, "error"]]);
    expect(invokeMock.mock.calls.some((c) => c[0] === "write_lrc_file")).toBe(false);
  });

  it("applies tags to an LRC file, only overwriting non-empty fields", async () => {
    invokeMock.mockImplementation((cmd: string) => (cmd === "read_lrc_file" ? Promise.resolve(LRC) : Promise.resolve()));
    await runBatchOperation([entry("/song.lrc")], { kind: "tag", artist: "New Artist" }, () => {});
    const writeCall = invokeMock.mock.calls.find((c) => c[0] === "write_lrc_file");
    expect(writeCall?.[1].content).toContain("[ti:Song]");
    expect(writeCall?.[1].content).toContain("[ar:New Artist]");
  });
});
