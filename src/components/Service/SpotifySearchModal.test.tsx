// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpotifySearchModal } from "./SpotifySearchModal";
import { useServiceStore } from "../../stores/useServiceStore";
import { useI18nStore } from "../../stores/useI18nStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(name: string, next: string | null = null) {
  return { tracks: { items: [{ uri: `spotify:${name}`, name, artists: [{ name: "Artist" }],
    album: { name: "Album", images: [] }, duration_ms: 1000 }], next } };
}

function playlistPage(names: string[], next: string | null) {
  return {
    items: names.map((name, index) => ({
      id: `id-${name}`,
      name,
      images: [],
      tracks: { total: index + 1 },
    })),
    next,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useI18nStore.getState().setLang("en");
  useServiceStore.setState({ isLoggedIn: true, ensureToken: vi.fn().mockResolvedValue("token") });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("does not let an earlier search response replace the latest query results", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  const input = screen.getByPlaceholderText(useI18nStore.getState().t.spotifySearchPlaceholder);
  fireEvent.change(input, { target: { value: "old" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  fireEvent.change(input, { target: { value: "new" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });

  await act(async () => { second.resolve({ ok: true, json: async () => response("New Track") } as Response); await second.promise; });
  expect(screen.getByText("New Track")).toBeTruthy();
  await act(async () => { first.resolve({ ok: true, json: async () => response("Old Track") } as Response); await first.promise; });
  expect(screen.getByText("New Track")).toBeTruthy();
  expect(screen.queryByText("Old Track")).toBeNull();
});

it("ignores an in-flight search after the query is cleared", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  render(<SpotifySearchModal onClose={() => {}} />);
  const input = screen.getByPlaceholderText(useI18nStore.getState().t.spotifySearchPlaceholder);
  fireEvent.change(input, { target: { value: "old" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  fireEvent.change(input, { target: { value: "" } });
  await act(async () => { pending.resolve({ ok: true, json: async () => response("Old Track") } as Response); await pending.promise; });
  expect(screen.queryByText("Old Track")).toBeNull();
});

it("does not show no-results after a search is cancelled by changing tabs", async () => {
  const pendingSearch = deferred<Response>();
  const fetchMock = vi.fn()
    .mockReturnValueOnce(pendingSearch.promise)
    .mockResolvedValueOnce({ ok: true, json: async () => playlistPage([], null) } as Response);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  const t = useI18nStore.getState().t;
  fireEvent.change(screen.getByPlaceholderText(t.spotifySearchPlaceholder), { target: { value: "song" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  fireEvent.click(screen.getByRole("button", { name: t.spotifyMyPlaylists }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: t.spotifySearchTrack }));

  expect(screen.queryByText(t.spotifyNoResults)).toBeNull();
});

it("keeps playlist loading visible when a cancelled search settles", async () => {
  const pendingSearch = deferred<Response>();
  const pendingPlaylists = deferred<Response>();
  const fetchMock = vi.fn()
    .mockReturnValueOnce(pendingSearch.promise)
    .mockReturnValueOnce(pendingPlaylists.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  const t = useI18nStore.getState().t;
  fireEvent.change(screen.getByPlaceholderText(t.spotifySearchPlaceholder), { target: { value: "song" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });

  fireEvent.click(screen.getByRole("button", { name: t.spotifyMyPlaylists }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.getByText(t.spotifyLoading)).toBeTruthy();

  await act(async () => {
    pendingSearch.resolve({ ok: true, json: async () => response("Late Search") } as Response);
    await pendingSearch.promise;
  });
  expect(screen.getByText(t.spotifyLoading)).toBeTruthy();
  expect(screen.queryByText("Late Search")).toBeNull();

  await act(async () => {
    pendingPlaylists.resolve({ ok: true, json: async () => playlistPage(["Playlist A"], null) } as Response);
    await pendingPlaylists.promise;
  });
  expect(screen.queryByText(t.spotifyLoading)).toBeNull();
  expect(screen.getByText("Playlist A")).toBeTruthy();
});

it("ignores an in-flight search after Spotify logout", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  render(<SpotifySearchModal onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(useI18nStore.getState().t.spotifySearchPlaceholder), { target: { value: "old" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  useServiceStore.getState().logout();
  await act(async () => { pending.resolve({ ok: true, json: async () => response("Old Track") } as Response); await pending.promise; });
  expect(screen.queryByText("Old Track")).toBeNull();
});

it("localizes playlist loading and track-count labels", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  render(<SpotifySearchModal onClose={() => {}} />);
  const t = useI18nStore.getState().t;
  fireEvent.click(screen.getByRole("button", { name: t.spotifyMyPlaylists }));
  expect(screen.getByText(t.spotifyLoading)).toBeTruthy();

  await act(async () => {
    pending.resolve({ ok: true, json: async () => playlistPage(["Playlist A"], null) } as Response);
    await pending.promise;
  });
  expect(screen.getByText("Tracks: 1")).toBeTruthy();
});

it("exposes the selected Spotify search tab programmatically", () => {
  render(<SpotifySearchModal onClose={() => {}} />);
  const t = useI18nStore.getState().t;
  const search = screen.getByRole("button", { name: t.spotifySearchTrack });
  const playlists = screen.getByRole("button", { name: t.spotifyMyPlaylists });
  expect(search.getAttribute("aria-pressed")).toBe("true");
  expect(playlists.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(playlists);
  expect(search.getAttribute("aria-pressed")).toBe("false");
  expect(playlists.getAttribute("aria-pressed")).toBe("true");
});

it("maps the native no-active-device error to its dedicated message", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response("Test Track"),
  } as Response));
  useServiceStore.setState({ playTrack: vi.fn().mockRejectedValue(new Error("no_active_spotify_device")) });
  render(<SpotifySearchModal onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(useI18nStore.getState().t.spotifySearchPlaceholder), { target: { value: "test" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText("Test Track")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Test Track/ }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText(useI18nStore.getState().t.spotifyNoPlayableDevices)).toBeTruthy();
  expect(screen.queryByText(/no_active_spotify_device/)).toBeNull();
});

it("loads Spotify playlists incrementally through validated next pages", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyMyPlaylists }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  await act(async () => {
    first.resolve({ ok: true, json: async () => playlistPage(["First Playlist"], "https://api.spotify.com/v1/me/playlists?limit=50&offset=50") } as Response);
    await first.promise;
  });
  expect(screen.getByText("First Playlist")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyLoadMore }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await act(async () => {
    second.resolve({ ok: true, json: async () => playlistPage(["Second Playlist"], null) } as Response);
    await second.promise;
  });
  expect(screen.getByText("Second Playlist")).toBeTruthy();
});

it("keeps playlist details loading when an older page request settles", async () => {
  const pendingPage = deferred<Response>();
  const pendingDetail = deferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => playlistPage(["Playlist A"], "https://api.spotify.com/v1/me/playlists?limit=50&offset=50") } as Response)
    .mockReturnValueOnce(pendingPage.promise)
    .mockReturnValueOnce(pendingDetail.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyMyPlaylists }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText("Playlist A")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyLoadMore }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: /Playlist A/ }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(screen.getByText(useI18nStore.getState().t.spotifyLoading)).toBeTruthy();

  await act(async () => {
    pendingPage.resolve({ ok: true, json: async () => playlistPage(["Playlist B"], null) } as Response);
    await pendingPage.promise;
  });
  expect(screen.getByText(useI18nStore.getState().t.spotifyLoading)).toBeTruthy();

  await act(async () => {
    pendingDetail.resolve({ ok: true, json: async () => ({ items: [] }) } as Response);
    await pendingDetail.promise;
  });
});

it("loads additional track search results from the Spotify next page", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(useI18nStore.getState().t.spotifySearchPlaceholder), { target: { value: "song" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => {
    first.resolve({ ok: true, json: async () => response("First Track", "https://api.spotify.com/v1/search?offset=50&limit=50") } as Response);
    await first.promise;
  });
  expect(screen.getByText("First Track")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyLoadMore }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => {
    second.resolve({ ok: true, json: async () => response("Second Track") } as Response);
    await second.promise;
  });
  expect(screen.getByText("Second Track")).toBeTruthy();
});

it("does not let an earlier playlist detail overwrite the newly selected playlist", async () => {
  const firstDetail = deferred<Response>();
  const secondDetail = deferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => playlistPage(["Playlist A", "Playlist B"], null) } as Response)
    .mockReturnValueOnce(firstDetail.promise)
    .mockReturnValueOnce(secondDetail.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<SpotifySearchModal onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.spotifyMyPlaylists }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText("Playlist A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Playlist A/ }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: /Playlist A/ }));
  fireEvent.click(screen.getByRole("button", { name: /Playlist B/ }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await act(async () => {
    secondDetail.resolve({ ok: true, json: async () => ({ items: [{ track: {
      uri: "spotify:new", name: "New Track", artists: [{ name: "Artist" }],
      album: { name: "Album", images: [] }, duration_ms: 1000,
    } }] }) } as Response);
    await secondDetail.promise;
  });
  await act(async () => {
    firstDetail.resolve({ ok: true, json: async () => ({ items: [{ track: {
      uri: "spotify:old", name: "Old Track", artists: [{ name: "Artist" }],
      album: { name: "Album", images: [] }, duration_ms: 1000,
    } }] }) } as Response);
    await firstDetail.promise;
  });
  expect(screen.getByText("New Track")).toBeTruthy();
  expect(screen.queryByText("Old Track")).toBeNull();
});
