(() => {
  "use strict";

  const players = new Map();
  const tokenCallbacks = new Map();
  const PLAYER_EVENTS = [
    "ready",
    "player_state_changed",
    "not_ready",
    "initialization_error",
    "authentication_error",
    "account_error",
    "playback_error",
  ];
  let sdkReady = false;
  let nextTokenRequestId = 0;

  function send(message) {
    window.parent.postMessage({ version: 1, ...message }, "*");
  }

  function projectTrack(track) {
    if (!track || typeof track !== "object") return null;
    const album = track.album && typeof track.album === "object" ? track.album : {};
    return {
      id: typeof track.id === "string" ? track.id : null,
      uri: typeof track.uri === "string" ? track.uri : "",
      type: typeof track.type === "string" ? track.type : "track",
      name: typeof track.name === "string" ? track.name : "",
      duration_ms: Number.isFinite(track.duration_ms) ? track.duration_ms : 0,
      artists: Array.isArray(track.artists)
        ? track.artists.slice(0, 32).map((artist) => ({
          name: typeof artist?.name === "string" ? artist.name : "",
          uri: typeof artist?.uri === "string" ? artist.uri : "",
        }))
        : [],
      album: {
        name: typeof album.name === "string" ? album.name : "",
        uri: typeof album.uri === "string" ? album.uri : "",
        images: Array.isArray(album.images)
          ? album.images.slice(0, 8).map((image) => ({ url: typeof image?.url === "string" ? image.url : "" }))
          : [],
      },
    };
  }

  function projectPlaybackState(state) {
    if (!state) return null;
    const trackWindow = state.track_window && typeof state.track_window === "object" ? state.track_window : {};
    return {
      paused: Boolean(state.paused),
      position: Number.isFinite(state.position) ? state.position : 0,
      duration: Number.isFinite(state.duration) ? state.duration : 0,
      repeat_mode: Number.isFinite(state.repeat_mode) ? state.repeat_mode : 0,
      track_window: { current_track: projectTrack(trackWindow.current_track) },
    };
  }

  function requestToken(playerId, callback) {
    const tokenRequestId = ++nextTokenRequestId;
    const timer = setTimeout(() => {
      tokenCallbacks.delete(tokenRequestId);
      callback("");
    }, 10_000);
    tokenCallbacks.set(tokenRequestId, (token) => {
      clearTimeout(timer);
      tokenCallbacks.delete(tokenRequestId);
      callback(typeof token === "string" ? token : "");
    });
    send({ type: "token-request", playerId, tokenRequestId });
  }

  function createPlayer(playerId) {
    if (!sdkReady || !window.Spotify?.Player) throw new Error("spotify_sdk_not_ready");
    const player = new window.Spotify.Player({
      name: "Lyrical Sync",
      volume: 1.0,
      getOAuthToken: (callback) => requestToken(playerId, callback),
    });
    for (const event of PLAYER_EVENTS) {
      player.addListener(event, (value) => {
        let projected = value;
        if (event === "player_state_changed") projected = projectPlaybackState(value);
        else if (event === "ready" && value) projected = { device_id: value.device_id };
        else if (event.endsWith("_error") && value) projected = { message: String(value.message ?? "") };
        send({ type: "player-event", playerId, event, value: projected });
      });
    }
    players.set(playerId, player);
  }

  async function runCommand(message) {
    const { command, playerId, requestId } = message;
    try {
      if (command === "create-player") {
        createPlayer(playerId);
        send({ type: "command-result", requestId, ok: true, value: true });
        return;
      }
      const player = players.get(playerId);
      if (!player) throw new Error("spotify_player_not_found");
      let value;
      switch (command) {
        case "connect":
          value = await player.connect();
          break;
        case "disconnect":
          player.disconnect();
          players.delete(playerId);
          value = true;
          break;
        case "activate":
          await player.activateElement();
          value = true;
          break;
        case "set-volume":
          if (!Number.isFinite(message.value) || message.value < 0 || message.value > 1) {
            throw new Error("spotify_volume_out_of_range");
          }
          await player.setVolume(message.value);
          value = true;
          break;
        case "get-volume":
          value = await player.getVolume();
          break;
        default:
          throw new Error("spotify_command_not_allowed");
      }
      send({ type: "command-result", requestId, ok: true, value });
    } catch (error) {
      send({
        type: "command-result",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : "spotify_sdk_command_failed",
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || typeof message !== "object" || message.version !== 1) return;
    if (message.type === "token-response" && Number.isSafeInteger(message.tokenRequestId)) {
      tokenCallbacks.get(message.tokenRequestId)?.(message.token);
      return;
    }
    if (message.type !== "command" || !Number.isSafeInteger(message.requestId) ||
      typeof message.playerId !== "string" || message.playerId.length > 64) return;
    if (!sdkReady && message.command !== "create-player") return;
    void runCommand(message);
  });

  window.onSpotifyWebPlaybackSDKReady = () => {
    sdkReady = true;
    send({ type: "sdk-ready" });
  };

  const script = document.createElement("script");
  script.src = "https://sdk.scdn.co/spotify-player.js";
  script.async = true;
  script.onerror = () => send({ type: "sdk-error" });
  document.head.appendChild(script);
})();
