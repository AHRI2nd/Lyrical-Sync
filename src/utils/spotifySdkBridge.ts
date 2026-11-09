const SDK_FRAME_PATH = "/spotify-sdk-frame.html";
const REQUEST_TIMEOUT_MS = 15_000;
const PLAYER_EVENTS = new Set([
  "ready",
  "player_state_changed",
  "not_ready",
  "initialization_error",
  "authentication_error",
  "account_error",
  "playback_error",
]);

type TokenCallback = (callback: (token: string) => void) => void;
type PlayerListener = (value: any) => void;
type PlayerOptions = { getOAuthToken: TokenCallback };
type PlayerCommand = "create-player" | "connect" | "disconnect" | "activate" | "set-volume" | "get-volume";

type WireMessage = {
  version: 1;
  type: "command";
  requestId: number;
  playerId: string;
  command: PlayerCommand;
  value?: number;
};

type PendingRequest = {
  command: PlayerCommand;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PlayerRecord = {
  getOAuthToken: TokenCallback;
  listeners: Map<string, Set<PlayerListener>>;
  closed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INVALID_EVENT = Symbol("invalid-spotify-sdk-event");

function boundedString(value: unknown, limit = 4096): value is string {
  return typeof value === "string" && value.length <= limit;
}

function sanitizeTrack(value: unknown): Record<string, unknown> | null | typeof INVALID_EVENT {
  if (value === null) return null;
  if (!isRecord(value) || !boundedString(value.uri) || !boundedString(value.name)) return INVALID_EVENT;
  if (!Array.isArray(value.artists) || value.artists.length > 32 || !isRecord(value.album)) return INVALID_EVENT;
  const artists = value.artists.map((artist) => {
    if (!isRecord(artist) || !boundedString(artist.name)) return null;
    return { name: artist.name, uri: boundedString(artist.uri) ? artist.uri : "" };
  });
  if (artists.some((artist) => artist === null)) return INVALID_EVENT;
  const images = value.album.images;
  if (!Array.isArray(images) || images.length > 8 || images.some((image) => !isRecord(image) || !boundedString(image.url))) {
    return INVALID_EVENT;
  }
  if (!boundedString(value.album.name) || !boundedString(value.album.uri)) return INVALID_EVENT;
  const duration = value.duration_ms;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) return INVALID_EVENT;
  return {
    id: boundedString(value.id) ? value.id : null,
    uri: value.uri,
    type: boundedString(value.type) ? value.type : "track",
    name: value.name,
    duration_ms: duration,
    artists,
    album: { name: value.album.name, uri: value.album.uri, images },
  };
}

function sanitizePlayerEvent(event: string, value: unknown): unknown | typeof INVALID_EVENT {
  if (event === "player_state_changed") {
    if (value === null) return null;
    if (!isRecord(value) || typeof value.paused !== "boolean" ||
      typeof value.position !== "number" || !Number.isFinite(value.position) || value.position < 0 ||
      typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0 ||
      ![0, 1, 2].includes(value.repeat_mode as number) || !isRecord(value.track_window)) return INVALID_EVENT;
    const track = sanitizeTrack(value.track_window.current_track);
    if (track === INVALID_EVENT) return INVALID_EVENT;
    return {
      paused: value.paused,
      position: value.position,
      duration: value.duration,
      repeat_mode: value.repeat_mode,
      track_window: { current_track: track },
    };
  }
  if (event === "ready") {
    if (!isRecord(value) || !boundedString(value.device_id, 256) || value.device_id.length === 0) return INVALID_EVENT;
    return { device_id: value.device_id };
  }
  if (event.endsWith("_error")) {
    if (!isRecord(value) || !boundedString(value.message, 2048)) return INVALID_EVENT;
    return { message: value.message };
  }
  return undefined;
}

export class SpotifySdkBridge {
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private nextRequestId = 0;
  private nextPlayerId = 0;
  private queue: WireMessage[] = [];
  private pending = new Map<number, PendingRequest>();
  private players = new Map<string, PlayerRecord>();

  constructor(
    private readonly hostWindow: Window = window,
    private readonly hostDocument: Document = document,
  ) {
    this.hostWindow.addEventListener("message", this.onMessage);
  }

  createPlayer(options: PlayerOptions): Spotify.Player {
    this.ensureFrame();
    const playerId = `spotify-player-${++this.nextPlayerId}`;
    const record: PlayerRecord = {
      getOAuthToken: options.getOAuthToken,
      listeners: new Map(),
      closed: false,
    };
    this.players.set(playerId, record);
    void this.request(playerId, "create-player").catch(() => undefined);

    return {
      addListener: (event: string, listener: (...args: any[]) => void) => {
        if (!PLAYER_EVENTS.has(event) || record.closed) return false;
        const listeners = record.listeners.get(event) ?? new Set<PlayerListener>();
        listeners.add(listener as PlayerListener);
        record.listeners.set(event, listeners);
        return true;
      },
      connect: () => this.request(playerId, "connect", undefined, record) as Promise<boolean>,
      disconnect: () => {
        if (record.closed) return;
        record.closed = true;
        record.listeners.clear();
        if (!this.ready) {
          this.cancelQueuedPlayer(playerId);
          this.players.delete(playerId);
          return;
        }
        void this.request(playerId, "disconnect").catch(() => undefined).finally(() => this.players.delete(playerId));
      },
      activateElement: () => this.request(playerId, "activate", undefined, record) as Promise<void>,
      setVolume: (volume: number) => this.request(playerId, "set-volume", volume, record) as Promise<void>,
      getVolume: () => this.request(playerId, "get-volume", undefined, record) as Promise<number>,
    } as unknown as Spotify.Player;
  }

  dispose(): void {
    this.hostWindow.removeEventListener("message", this.onMessage);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("spotify_sdk_bridge_disposed"));
      this.pending.delete(id);
    }
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
  }

  private ensureFrame(): void {
    if (this.frame?.isConnected) return;
    const frame = this.hostDocument.createElement("iframe");
    frame.dataset.spotifySdkFrame = "true";
    frame.title = "Spotify playback service";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("allow", "autoplay; encrypted-media");
    frame.referrerPolicy = "no-referrer";
    frame.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0;";
    frame.src = SDK_FRAME_PATH;
    this.frame = frame;
    this.ready = false;
    this.hostDocument.body.appendChild(frame);
  }

  private request(playerId: string, command: PlayerCommand, value?: number, player?: PlayerRecord): Promise<unknown> {
    if (player?.closed) return Promise.reject(new Error("spotify_player_disconnected"));
    const message: WireMessage = {
      version: 1,
      type: "command",
      requestId: ++this.nextRequestId,
      playerId,
      command,
      ...(value === undefined ? {} : { value }),
    };
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        this.queue = this.queue.filter((queued) => queued.requestId !== message.requestId);
        reject(new Error("spotify_sdk_request_timeout"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(message.requestId, { command, resolve, reject, timer });
    });
    this.queue.push(message);
    this.flush();
    return result;
  }

  private cancelQueuedPlayer(playerId: string): void {
    this.queue = this.queue.filter((message) => {
      if (message.playerId !== playerId) return true;
      const pending = this.pending.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("spotify_player_disconnected"));
        this.pending.delete(message.requestId);
      }
      return false;
    });
  }

  private flush(): void {
    const target = this.frame?.contentWindow;
    if (!this.ready || !target) return;
    for (const message of this.queue.splice(0)) {
      try {
        target.postMessage(message, "*");
      } catch {
        const pending = this.pending.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("spotify_sdk_bridge_send_failed"));
          this.pending.delete(message.requestId);
        }
      }
    }
  }

  private readonly onMessage = (event: MessageEvent): void => {
    const frame = this.frame;
    if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== "null") return;
    const message = event.data;
    if (!isRecord(message) || message.version !== 1 || typeof message.type !== "string") return;

    if (message.type === "sdk-ready") {
      this.ready = true;
      this.flush();
      return;
    }

    if (message.type === "sdk-error") {
      this.failPending(new Error("spotify_sdk_load_failed"));
      return;
    }

    if (message.type === "token-request" && typeof message.playerId === "string" && typeof message.tokenRequestId === "number") {
      const player = this.players.get(message.playerId);
      if (!player || player.closed) return;
      const respond = (token: string) => {
        if (!player.closed && this.players.get(message.playerId as string) === player) {
          this.postToFrame({ version: 1, type: "token-response", tokenRequestId: message.tokenRequestId, token });
        }
      };
      try {
        player.getOAuthToken(respond);
      } catch {
        respond("");
      }
      return;
    }

    if (message.type === "player-event" && typeof message.playerId === "string" &&
      typeof message.event === "string" && PLAYER_EVENTS.has(message.event)) {
      const player = this.players.get(message.playerId);
      if (!player || player.closed) return;
      const value = sanitizePlayerEvent(message.event, message.value);
      if (value === INVALID_EVENT) return;
      for (const listener of player.listeners.get(message.event) ?? []) listener(value);
      return;
    }

    if (message.type === "command-result" && typeof message.requestId === "number") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.ok === true && this.isValidCommandResult(pending.command, message.value)) pending.resolve(message.value);
      else if (message.ok === true) pending.reject(new Error("spotify_sdk_invalid_result"));
      else pending.reject(new Error(typeof message.error === "string" ? message.error : "spotify_sdk_command_failed"));
    }
  };

  private isValidCommandResult(command: PlayerCommand, value: unknown): boolean {
    if (command === "connect") return typeof value === "boolean";
    if (command === "get-volume") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
    return value === true;
  }

  private failPending(error: Error): void {
    this.queue = [];
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private postToFrame(message: Record<string, unknown>): void {
    try {
      this.frame?.contentWindow?.postMessage(message, "*");
    } catch {
      // The pending request will expire and surface through the existing player error path.
    }
  }
}

let sharedBridge: SpotifySdkBridge | null = null;

export function createSpotifySdkPlayer(options: PlayerOptions): Spotify.Player {
  sharedBridge ??= new SpotifySdkBridge();
  return sharedBridge.createPlayer(options);
}
