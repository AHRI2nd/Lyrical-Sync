import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lrclibSearch, scoreResult, sortByAccuracy, type LrcLibResult } from "./lrclib";

const result = (overrides: Partial<LrcLibResult> = {}): LrcLibResult => ({
  id: 1,
  trackName: "Song",
  artistName: "Artist",
  albumName: "Album",
  duration: 180,
  instrumental: false,
  plainLyrics: null,
  syncedLyrics: null,
  ...overrides,
});

describe("scoreResult", () => {
  it("gives full title weight (100) for an exact title match", () => {
    const s = scoreResult(result({ trackName: "Exact Title" }), { title: "Exact Title" });
    expect(s).toBe(100);
  });

  it("gives partial credit (0.7×weight) for a substring match", () => {
    const s = scoreResult(result({ trackName: "Exact Title (Remix)" }), { title: "Exact Title" });
    expect(s).toBeCloseTo(70, 5);
  });

  it("weights title > artist > album (100 / 10 / 1)", () => {
    const s = scoreResult(
      result({ trackName: "T", artistName: "A", albumName: "B" }),
      { title: "T", artist: "A", album: "B" }
    );
    expect(s).toBeCloseTo(111, 5);
  });

  it("ignores fields the user left blank", () => {
    const s = scoreResult(result({ trackName: "Wrong", artistName: "Artist" }), { artist: "Artist" });
    expect(s).toBeCloseTo(10, 5);
  });

  it("is case- and whitespace-insensitive", () => {
    const s = scoreResult(result({ trackName: "  ExAcT   Title  " }), { title: "exact title" });
    expect(s).toBe(100);
  });

  it("scores 0 when nothing matches and no fields are queried", () => {
    expect(scoreResult(result(), {})).toBe(0);
  });
});

describe("sortByAccuracy", () => {
  it("sorts results by descending accuracy score", () => {
    const weak = result({ id: 1, trackName: "Totally Different" });
    const strong = result({ id: 2, trackName: "Exact Match" });
    const sorted = sortByAccuracy([weak, strong], { title: "Exact Match" });
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });

  it("breaks ties by preferring synced lyrics", () => {
    const plainOnly = result({ id: 1, trackName: "Same", syncedLyrics: null });
    const synced = result({ id: 2, trackName: "Same", syncedLyrics: "[00:01.00]hi" });
    const sorted = sortByAccuracy([plainOnly, synced], { title: "Same" });
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });

  it("does not mutate the input array", () => {
    const a = result({ id: 1, trackName: "B" });
    const b = result({ id: 2, trackName: "A" });
    const input = [a, b];
    sortByAccuracy(input, { title: "A" });
    expect(input).toEqual([a, b]);
  });
});

describe("lrclibSearch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function jsonResponse(data: unknown, contentLength?: string) {
    const value = new TextEncoder().encode(JSON.stringify(data));
    let read = false;
    return {
      ok: true,
      headers: { get: (key: string) => key === "content-length" ? (contentLength ?? null) : null },
      body: { getReader: () => ({ read: async () => {
        if (read) return { done: true, value: undefined };
        read = true;
        return { done: false, value };
      } }) },
    };
  }

  it("searches by track_name (+artist/album) when a title is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse([result()]));
    expect(await lrclibSearch({ title: " Song ", artist: "Artist", album: "Album" })).toEqual([result()]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.toString()).toBe("track_name=Song&artist_name=Artist&album_name=Album");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to a combined q= query when there is no title", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    expect(await lrclibSearch({ artist: "Artist", album: "Album" })).toEqual([]);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("q")).toBe("Artist Album");
  });

  it("returns [] without calling fetch when every field is blank", async () => {
    const results = await lrclibSearch({});
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with the status code on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(lrclibSearch({ title: "Song" })).rejects.toThrow("503");
  });

  it("filters malformed results before UI sorting and normalizes a missing album", async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      null,
      { ...result(), trackName: { unexpected: true } },
      { ...result({ id: 2 }), albumName: null },
    ]));
    expect(await lrclibSearch({ title: "Song" })).toEqual([result({ id: 2, albumName: "" })]);
  });

  it("rejects a successful response with an unexpected object shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ invalid: true }));
    await expect(lrclibSearch({ title: "Song" })).rejects.toThrow("unexpected response shape");
  });

  it("cancels a pending fetch using the caller's AbortSignal", async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      requestSignal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true });
      });
    });
    const pending = lrclibSearch({ title: "Song" }, caller.signal);
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("cancels an in-progress response body read using the caller's signal", async () => {
    const caller = new AbortController();
    let startedReading!: () => void;
    const reading = new Promise<void>((resolve) => { startedReading = resolve; });
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      const requestSignal = options.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        body: { getReader: () => ({ read: () => new Promise((_resolve, reject) => {
          requestSignal.addEventListener("abort", () => reject(requestSignal.reason), { once: true });
          startedReading();
        }) }) },
      });
    });
    const pending = lrclibSearch({ title: "Song" }, caller.signal);
    await reading;
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not fetch if the caller signal is already aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    await expect(lrclibSearch({ title: "Song" }, caller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the 10-second deadline even with a caller signal", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      requestSignal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true });
      });
    });
    const pending = lrclibSearch({ title: "Song" }, caller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  });

  it("enforces the same deadline without a caller signal", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const pending = lrclibSearch({ title: "Song" });
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("clears the timeout and caller listener after a successful response", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    fetchMock.mockResolvedValue(jsonResponse([result()]));
    await expect(lrclibSearch({ title: "Song" }, caller.signal)).resolves.toEqual([result()]);
    const requestSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    expect(requestSignal.aborted).toBe(false);
  });

  it("retains the 2 MiB response cap for a Content-Length header", async () => {
    fetchMock.mockResolvedValue(jsonResponse([], String(2 * 1024 * 1024 + 1)));
    await expect(lrclibSearch({ title: "Song" })).rejects.toThrow("response too large");
  });

  it("retains the 2 MiB streamed response cap without Content-Length", async () => {
    let reads = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: { getReader: () => ({ read: async () => {
        reads++;
        return { done: false, value: new Uint8Array(1024 * 1024 + 1) };
      } }) },
    });
    await expect(lrclibSearch({ title: "Song" })).rejects.toThrow("response exceeded");
    expect(reads).toBe(2);
  });
});
