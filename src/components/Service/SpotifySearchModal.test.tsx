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

function response(name: string) {
  return { tracks: { items: [{ uri: `spotify:${name}`, name, artists: [{ name: "Artist" }],
    album: { name: "Album", images: [] }, duration_ms: 1000 }] } };
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
