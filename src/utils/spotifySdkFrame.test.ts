// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import frameScript from "../../public/spotify-sdk-frame.js?raw";

class MockSdkPlayer {
  static instance: MockSdkPlayer | null = null;
  listeners = new Map<string, (value: any) => void>();
  options: { getOAuthToken: (callback: (token: string) => void) => void };
  connect = vi.fn(async () => true);
  disconnect = vi.fn();
  activateElement = vi.fn(async () => {});
  setVolume = vi.fn(async () => {});
  getVolume = vi.fn(async () => 0.5);

  constructor(options: MockSdkPlayer["options"]) {
    this.options = options;
    MockSdkPlayer.instance = this;
  }

  addListener(event: string, listener: (value: any) => void) {
    this.listeners.set(event, listener);
    return true;
  }
}

const parent = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };

function sendParentMessage(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, origin: "app-origin", source: parent as unknown as MessageEventSource }));
}

beforeEach(() => {
  parent.postMessage.mockClear();
  MockSdkPlayer.instance = null;
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  Object.defineProperty(window, "Spotify", { configurable: true, value: { Player: MockSdkPlayer } });
  document.head.replaceChildren();
  window.eval(frameScript);
});

afterEach(() => {
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

it("loads the vendor SDK in the frame and announces readiness only after its callback", () => {
  const script = document.querySelector<HTMLScriptElement>('script[src="https://sdk.scdn.co/spotify-player.js"]');
  expect(script?.async).toBe(true);
  expect(parent.postMessage).not.toHaveBeenCalled();

  window.onSpotifyWebPlaybackSDKReady();
  expect(parent.postMessage).toHaveBeenCalledWith({ version: 1, type: "sdk-ready" }, "*");
});

it("brokers token requests and forwards only the required playback state fields", () => {
  window.onSpotifyWebPlaybackSDKReady();
  sendParentMessage({ version: 1, type: "command", requestId: 1, playerId: "p1", command: "create-player" });
  const player = MockSdkPlayer.instance!;
  player.options.getOAuthToken(vi.fn());

  const tokenRequest = parent.postMessage.mock.calls.find(([message]) => (message as any).type === "token-request");
  expect(tokenRequest?.[0]).toMatchObject({ version: 1, type: "token-request", playerId: "p1", tokenRequestId: 1 });
  sendParentMessage({ version: 1, type: "token-response", tokenRequestId: 1, token: "scoped-access-token" });

  const tokenCallback = vi.fn();
  player.options.getOAuthToken(tokenCallback);
  const latestTokenRequest = parent.postMessage.mock.calls[parent.postMessage.mock.calls.length - 1]?.[0] as any;
  sendParentMessage({ version: 1, type: "token-response", tokenRequestId: latestTokenRequest.tokenRequestId, token: "scoped-access-token" });
  expect(tokenCallback).toHaveBeenCalledWith("scoped-access-token");

  player.listeners.get("player_state_changed")?.({
    paused: false,
    position: 42,
    duration: 100,
    repeat_mode: 1,
    track_window: {
      current_track: {
        uri: "spotify:track:one",
        name: "One",
        duration_ms: 100,
        artists: [{ name: "Artist", uri: "spotify:artist:a" }],
        album: { name: "Album", uri: "spotify:album:b", images: [{ url: "https://img.test/a" }] },
      },
      next_tracks: [{ name: "Do not forward" }],
    },
    private_sdk_payload: "discarded",
  });
  expect(parent.postMessage).toHaveBeenLastCalledWith({
    version: 1,
    type: "player-event",
    playerId: "p1",
    event: "player_state_changed",
    value: {
      paused: false,
      position: 42,
      duration: 100,
      repeat_mode: 1,
      track_window: {
        current_track: {
          id: null,
          uri: "spotify:track:one",
          type: "track",
          name: "One",
          duration_ms: 100,
          artists: [{ name: "Artist", uri: "spotify:artist:a" }],
          album: { name: "Album", uri: "spotify:album:b", images: [{ url: "https://img.test/a" }] },
        },
      },
    },
  }, "*");
});

it("rejects unknown SDK commands rather than exposing an extensible command surface", () => {
  window.onSpotifyWebPlaybackSDKReady();
  sendParentMessage({ version: 1, type: "command", requestId: 9, playerId: "p1", command: "invoke-tauri" });

  expect(parent.postMessage).toHaveBeenCalledWith({
    version: 1,
    type: "command-result",
    requestId: 9,
    ok: false,
    error: "spotify_command_not_allowed",
  }, "*");
});
