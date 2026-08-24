import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("searches by track_name (+artist/album) when a title is given", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    await lrclibSearch({ title: "Song", artist: "Artist", album: "Album" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("track_name")).toBe("Song");
    expect(url.searchParams.get("artist_name")).toBe("Artist");
    expect(url.searchParams.get("album_name")).toBe("Album");
  });

  it("falls back to a combined q= query when there is no title", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    await lrclibSearch({ artist: "Artist", album: "Album" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.has("track_name")).toBe(false);
    expect(url.searchParams.get("q")).toBe("Artist Album");
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

  it("returns [] when the response body is not an array", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: "not found" }) });
    const results = await lrclibSearch({ title: "Song" });
    expect(results).toEqual([]);
  });
});
