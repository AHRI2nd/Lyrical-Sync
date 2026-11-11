// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { SpotifySdkBridge } from "./spotifySdkBridge";

const bridges: SpotifySdkBridge[] = [];

function createBridge(): SpotifySdkBridge {
  const bridge = new SpotifySdkBridge(window, document);
  bridges.push(bridge);
  return bridge;
}

function dispatchFrameMessage(frame: HTMLIFrameElement, data: unknown, origin = "null", source: MessageEventSource | null = frame.contentWindow) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("loads the Spotify SDK in an opaque-origin srcdoc frame without same-origin access", () => {
  const bridge = createBridge();
  bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });

  const frame = document.querySelector<HTMLIFrameElement>('iframe[data-spotify-sdk-frame="true"]');
  expect(frame).not.toBeNull();
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame?.getAttribute("allow")).toContain("encrypted-media");
  expect(frame?.getAttribute("src")).toBeNull();
  expect(frame?.srcdoc).toContain('<script src="/spotify-sdk-frame.js"></script>');
  expect(document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')).toBeNull();
});

it("does not trust SDK-ready messages from another source or a non-opaque frame origin", () => {
  const bridge = createBridge();
  bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" }, "null", window);
  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" }, window.location.origin);
  expect(postMessage).not.toHaveBeenCalled();

  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "command", command: "create-player", version: 1 }),
    "*",
  );
});

it("cancels queued SDK construction when the auth session disconnects before frame readiness", () => {
  const bridge = createBridge();
  const player = bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

  player.disconnect();
  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" });

  expect(postMessage).not.toHaveBeenCalled();
});

it("resolves player commands only from the isolated frame response", async () => {
  const bridge = createBridge();
  const player = bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" });
  const createRequest = postMessage.mock.calls[0][0] as { requestId: number };
  dispatchFrameMessage(frame, {
    version: 1,
    type: "command-result",
    requestId: createRequest.requestId,
    ok: true,
    value: true,
  });

  const connected = player.connect();
  const connectRequest = postMessage.mock.calls[1][0] as { requestId: number };
  dispatchFrameMessage(frame, {
    version: 1,
    type: "command-result",
    requestId: connectRequest.requestId,
    ok: true,
    value: true,
  });
  await expect(connected).resolves.toBe(true);
});

it("rejects an invalid connect result instead of passing it to player state", async () => {
  const bridge = createBridge();
  const player = bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" });
  const createRequest = postMessage.mock.calls[0][0] as { requestId: number };
  dispatchFrameMessage(frame, { version: 1, type: "command-result", requestId: createRequest.requestId, ok: true, value: true });
  const connected = player.connect();
  const connectRequest = postMessage.mock.calls[1][0] as { requestId: number };
  dispatchFrameMessage(frame, { version: 1, type: "command-result", requestId: connectRequest.requestId, ok: true, value: "yes" });

  await expect(connected).rejects.toThrow("spotify_sdk_invalid_result");
});

it("fails queued commands immediately when the vendor SDK cannot load", async () => {
  const bridge = createBridge();
  const player = bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
  const connected = player.connect();

  dispatchFrameMessage(frame, { version: 1, type: "sdk-error" });

  await expect(connected).rejects.toThrow("spotify_sdk_load_failed");
});

it("times out queued commands when the SDK frame never becomes ready", async () => {
  vi.useFakeTimers();
  const bridge = createBridge();
  const player = bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const connected = player.connect();
  const connectionFailure = expect(connected).rejects.toThrow("spotify_sdk_request_timeout");

  await vi.advanceTimersByTimeAsync(15_000);

  await connectionFailure;
});

it("drops malformed playback events sent by code running beside the vendor SDK", () => {
  const bridge = createBridge();
  const player = bridge.createPlayer({ getOAuthToken: (callback) => callback("access-token") });
  const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
  const listener = vi.fn();
  player.addListener("player_state_changed", listener);

  dispatchFrameMessage(frame, { version: 1, type: "sdk-ready" });
  const createRequest = postMessage.mock.calls[0][0] as { requestId: number };
  dispatchFrameMessage(frame, {
    version: 1,
    type: "command-result",
    requestId: createRequest.requestId,
    ok: true,
    value: true,
  });
  dispatchFrameMessage(frame, {
    version: 1,
    type: "player-event",
    playerId: "spotify-player-1",
    event: "player_state_changed",
    value: { paused: false, position: "not-a-number", duration: -1, track_window: {} },
  });

  expect(listener).not.toHaveBeenCalled();

  dispatchFrameMessage(frame, {
    version: 1,
    type: "player-event",
    playerId: "spotify-player-1",
    event: "player_state_changed",
    value: {
      paused: false,
      position: 42,
      duration: 100,
      repeat_mode: 1,
      track_window: {
        current_track: {
          uri: "spotify:track:one",
          name: "One",
          duration_ms: 100,
          artists: [{ name: "Artist" }],
          album: { name: "Album", uri: "spotify:album:two", images: [] },
        },
      },
    },
  });
  expect(listener).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ position: 42 }));
});
