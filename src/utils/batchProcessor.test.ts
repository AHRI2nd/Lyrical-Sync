import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readLyrics } from "./fileAccess";
import { batchOutputName, preflightBatch, runBatchOperation, type BatchFileEntry } from "./batchProcessor";
import { SRT_UNREPRESENTABLE_CONTENT_CODE } from "./srtConverter";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./fileAccess", () => ({ readLyrics: vi.fn() }));
const entry = (path: string, id = path): BatchFileEntry => ({ id, file: { path, bookmark: "input" }, status: "pending" });
const output = { path: "/output", bookmark: "folder" };
const convert = { kind: "convert", format: "srt" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readLyrics).mockImplementation(async (file) => ({ value: "[00:02.00]<00:02.20>Hello", file: { ...file, bookmark: "fresh" } }));
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("batch preflight", () => {
  it("rejects same-stem and case-folded output collisions before any I/O", async () => {
    await expect(runBatchOperation([entry("/a/song.lrc"), entry("/b/SONG.srt")], convert, output, vi.fn())).rejects.toThrow("Duplicate output");
    expect(readLyrics).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("retains the input basename extension for offset and chooses only a basename for conversion", () => {
    expect(batchOutputName("C:\\folder.with.dot\\Song.LRC", { kind: "offset", deltaSeconds: 1 })).toBe("Song.LRC");
    expect(batchOutputName("/parent.dot/song.srt", { kind: "tag", title: "new" })).toBe("song.srt");
    expect(batchOutputName("/parent.dot/song.lrc", convert)).toBe("song.srt");
    expect(preflightBatch([entry("/a/song.lrc")], convert, output)[0].targetPath).toBe("/output/song.srt");
  });
  it("rejects unsupported inputs and unsafe basenames", () => {
    expect(() => preflightBatch([entry("/a/song.wav")], convert, output)).toThrow("Unsupported input");
    expect(() => batchOutputName("/a/bad:name.lrc", convert)).toThrow("Invalid output name");
    for (const name of ["NUL .lrc", "COM¹.lrc", "CONIN$.lrc"]) {
      expect(() => batchOutputName(`/a/${name}`, convert)).toThrow("Invalid output name");
    }
    expect(() => preflightBatch([entry("/a/song.lrc")], { kind: "offset", deltaSeconds: Infinity }, output)).toThrow("finite");
  });
});

describe("batch output", () => {
  it("fails only SRT files with blank paragraph rows and continues the batch", async () => {
    vi.mocked(readLyrics)
      .mockResolvedValueOnce({ value: "[00:01.00]first\n[x-lyrical-translations:1]\n[00:01.00]/translated\\n\\nparagraph", file: { path: "/inputs/bad.lrc", bookmark: "fresh" } })
      .mockResolvedValueOnce({ value: "[00:01.00]first\n[x-lyrical-translations:1]\n[00:01.00]/translated", file: { path: "/inputs/good.lrc", bookmark: "fresh" } });
    const status = vi.fn();

    const summary = await runBatchOperation(
      [entry("/inputs/bad.lrc", "bad"), entry("/inputs/good.lrc", "good")],
      { kind: "convert", format: "srt" },
      output,
      status,
      { concurrency: 1 },
    );

    expect(summary).toEqual({ done: 1, error: 1, cancelled: 0 });
    expect(status).toHaveBeenCalledWith("bad", "error", SRT_UNREPRESENTABLE_CONTENT_CODE, { path: "/inputs/bad.lrc", bookmark: "fresh" });
    expect(status).toHaveBeenCalledWith("good", "done", undefined, { path: "/inputs/good.lrc", bookmark: "fresh" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("write_batch_output", expect.objectContaining({ name: "good.srt" }));
  });

  it("updates nonempty LRC tags while preserving existing metadata and lyric content", async () => {
    vi.mocked(readLyrics).mockResolvedValueOnce({ value: "[ti:Old]\n[ar:Existing]\n[00:02.00]Hello", file: entry("/inputs/song.lrc").file });
    await runBatchOperation([entry("/inputs/song.lrc")], { kind: "tag", title: " New ", artist: " " }, output, vi.fn());
    const content = (vi.mocked(invoke).mock.calls[0][1] as { content: string }).content;
    expect(content).toContain("[ti:New]");
    expect(content).toContain("[ar:Existing]");
    expect(content).toContain("[00:02.00]Hello");
  });
  it("preserves multiline SRT content and its final end while shifting new output", async () => {
    vi.mocked(readLyrics).mockResolvedValueOnce({ value: "1\n00:00:10,000 --> 00:00:12,000\nFirst\nSecond\n", file: entry("/inputs/song.srt").file });
    await runBatchOperation([entry("/inputs/song.srt")], { kind: "offset", deltaSeconds: 1 }, output, vi.fn());
    expect(invoke).toHaveBeenCalledWith("write_batch_output", expect.objectContaining({ name: "song.srt", content: expect.stringContaining("00:00:11,000 --> 00:00:13,000\nFirst\nSecond") }));
  });
  it.each(["srt", "vtt", "ass"] as const)("converts local lyrics to a new %s basename", async (format) => {
    await runBatchOperation([entry("/inputs/song.lrc")], { kind: "convert", format }, output, vi.fn());
    expect(invoke).toHaveBeenCalledWith("write_batch_output", expect.objectContaining({ name: `song.${format}`, content: expect.stringContaining("Hello") }));
  });
  it("escapes markup-like text during batch conversion to VTT", async () => {
    vi.mocked(readLyrics).mockResolvedValueOnce({
      value: "[00:02.00]A <b>bold</b> &amp; B",
      file: { path: "/inputs/song.lrc", bookmark: "fresh" },
    });

    await runBatchOperation([entry("/inputs/song.lrc")], { kind: "convert", format: "vtt" }, output, vi.fn());

    expect(invoke).toHaveBeenCalledWith("write_batch_output", expect.objectContaining({
      name: "song.vtt",
      content: expect.stringContaining("A &lt;b&gt;bold&lt;/b&gt; &amp;amp; B"),
    }));
  });
  it("shifts both line and syllable times and writes a new output with the selected folder grant", async () => {
    const status = vi.fn();
    const summary = await runBatchOperation([entry("/inputs/song.lrc", "stable")], { kind: "offset", deltaSeconds: -1 }, output, status);
    expect(summary).toEqual({ done: 1, error: 0, cancelled: 0 });
    expect(invoke).toHaveBeenCalledWith("write_batch_output", {
      outputDir: "/output", outputBookmark: "folder", name: "song.lrc",
      content: expect.stringContaining("[00:01.00]<00:01.20>Hello"),
    });
    expect(status).toHaveBeenLastCalledWith("stable", "done", undefined, { path: "/inputs/song.lrc", bookmark: "fresh" });
  });
  it("reports denied reads and refused outputs per stable entry ID", async () => {
    vi.mocked(readLyrics).mockRejectedValueOnce(new Error("permission denied"));
    vi.mocked(invoke).mockRejectedValueOnce(new Error("already exists"));
    const status = vi.fn();
    const summary = await runBatchOperation([entry("/a/one.lrc", "one"), entry("/a/two.lrc", "two")], convert, output, status, { concurrency: 1 });
    expect(summary).toEqual({ done: 0, error: 2, cancelled: 0 });
    expect(status).toHaveBeenCalledWith("one", "error", "permission denied", undefined);
    expect(status).toHaveBeenCalledWith("two", "error", "already exists", { path: "/a/two.lrc", bookmark: "fresh" });
  });
  it("snapshots operation and entries while cancellation awaits active I/O and stops new entries", async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const files = [entry("/a/one.lrc", "one"), entry("/a/two.lrc", "two")];
    const operation = { kind: "offset", deltaSeconds: 1 } as const;
    const controller = new AbortController();
    const status = vi.fn();
    const running = runBatchOperation(files, operation, output, status, { signal: controller.signal, concurrency: 1 });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    files[1].file.path = "/a/replaced.lrc";
    (operation as { deltaSeconds: number }).deltaSeconds = 10;
    controller.abort();
    let settled = false;
    void running.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    expect(await running).toEqual({ done: 1, error: 0, cancelled: 1 });
    expect(readLyrics).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith("two", "cancelled", undefined, undefined);
    expect(invoke).toHaveBeenCalledWith("write_batch_output", expect.objectContaining({ content: expect.stringContaining("[00:03.00]") }));
  });
  it("snapshots operation, source path and folder while the first file is being read", async () => {
    let finish!: (value: Awaited<ReturnType<typeof readLyrics>>) => void;
    vi.mocked(readLyrics).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const files = [entry("/a/one.lrc", "one"), entry("/a/two.lrc", "two")];
    const operation = { kind: "offset", deltaSeconds: 1 } as const;
    const folder = { ...output };
    const running = runBatchOperation(files, operation, folder, vi.fn(), { concurrency: 1 });
    files[1].file.path = "/a/replaced.lrc";
    (operation as { deltaSeconds: number }).deltaSeconds = 20;
    folder.path = "/elsewhere";
    finish({ value: "[00:02.00]One", file: files[0].file });
    await running;
    expect(readLyrics).toHaveBeenLastCalledWith({ path: "/a/two.lrc", bookmark: "input" });
    expect(invoke).toHaveBeenLastCalledWith("write_batch_output", expect.objectContaining({ outputDir: "/output", name: "two.lrc", content: expect.stringContaining("[00:03.00]") }));
  });
});
