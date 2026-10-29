import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSpotifyAuthLeaseCurrent,
  spotifyApiRequest,
  spotifyAuthLease,
  useServiceStore,
  type SpotifyTrack,
} from "../../stores/useServiceStore";
import { activateSpotifyPlayer } from "../../utils/spotifyPlayer";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";

interface Playlist {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
}

interface SpotifyTrackPayload {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
  duration_ms: number;
}

function toSpotifyTrack(item: SpotifyTrackPayload): SpotifyTrack {
  return {
    uri: item.uri,
    name: item.name,
    artistName: item.artists.map((artist) => artist.name).join(", "),
    albumName: item.album.name,
    albumArtUrl: item.album.images[0]?.url ?? null,
    durationMs: item.duration_ms,
  };
}

function validateNextPage(next: string | null | undefined, expectedPath: string): string | null {
  if (!next) return null;
  const url = new URL(next);
  if (url.origin !== "https://api.spotify.com" || url.pathname !== expectedPath) {
    throw new Error("invalid_spotify_pagination_url");
  }
  return url.toString();
}

interface Props {
  onClose: () => void;
}

export function SpotifySearchModal({ onClose }: Props) {
  const { t } = useI18nStore();
  const playTrack = useServiceStore((s) => s.playTrack);
  const authGeneration = useServiceStore((s) => s._authGeneration);
  const setSpotifyMode = useSettingsStore((s) => s.setSpotifyMode);
  const [tab, setTab] = useState<"search" | "playlists">("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
  const [nextSearchUrl, setNextSearchUrl] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyTrack[] | null>(null);
  const [nextPlaylistUrl, setNextPlaylistUrl] = useState<string | null>(null);
  const [nextTrackUrl, setNextTrackUrl] = useState<string | null>(null);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGeneration = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const playlistGeneration = useRef(0);
  const playlistDetailGeneration = useRef(0);
  const playlistAbort = useRef<AbortController | null>(null);
  const playlistDetailAbort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const observedAuthGeneration = useRef(authGeneration);

  const loadPlaylistPage = useCallback(async (nextUrl: string | null, append: boolean) => {
    const requestId = ++playlistGeneration.current;
    playlistAbort.current?.abort();
    const controller = new AbortController();
    playlistAbort.current = controller;
    const lease = spotifyAuthLease();
    const path = "/v1/me/playlists";
    setLoading(true);
    setError(null);
    try {
      const url = nextUrl ? validateNextPage(nextUrl, path)! : `https://api.spotify.com${path}?limit=50`;
      const page = await spotifyApiRequest(url, { signal: controller.signal }, (response) => response.json(), lease);
      if (!mounted.current || requestId !== playlistGeneration.current || !isSpotifyAuthLeaseCurrent(lease)) return;
      const items = ((page.items ?? []) as { id: string; name: string; images?: { url: string }[]; tracks?: { total: number } }[])
        .filter((item) => item && typeof item.id === "string")
        .map((item) => ({
          id: item.id,
          name: item.name,
          imageUrl: item.images?.[0]?.url ?? null,
          trackCount: item.tracks?.total ?? 0,
        }));
      setPlaylists((current) => append ? [...current, ...items] : items);
      setNextPlaylistUrl(validateNextPage(page.next, path));
      setPlaylistsLoaded(true);
    } catch (requestError) {
      if (!mounted.current || requestId !== playlistGeneration.current || controller.signal.aborted) return;
      if (isSpotifyAuthLeaseCurrent(lease)) {
        const status = typeof requestError === "object" && requestError !== null && "status" in requestError
          ? String(requestError.status)
          : "";
        setError(status
          ? t.spotifyPlaylistLoadFailed.replace("{status}", status)
          : t.spotifySearchFailed);
      }
    } finally {
      if (mounted.current && requestId === playlistGeneration.current) setLoading(false);
    }
  }, [t.spotifyPlaylistLoadFailed, t.spotifySearchFailed]);

  const loadPlaylistTrackPage = useCallback(async (playlist: Playlist, nextUrl: string | null, append: boolean) => {
    const requestId = ++playlistDetailGeneration.current;
    playlistDetailAbort.current?.abort();
    const controller = new AbortController();
    playlistDetailAbort.current = controller;
    const lease = spotifyAuthLease();
    const path = `/v1/playlists/${encodeURIComponent(playlist.id)}/tracks`;
    setLoading(true);
    setError(null);
    try {
      const url = nextUrl
        ? validateNextPage(nextUrl, path)!
        : `https://api.spotify.com${path}?limit=50&fields=items(track(uri,name,artists,album,duration_ms)),next`;
      const page = await spotifyApiRequest(url, { signal: controller.signal }, (response) => response.json(), lease);
      if (!mounted.current || requestId !== playlistDetailGeneration.current || !isSpotifyAuthLeaseCurrent(lease)) return;
      const tracks = ((page.items ?? []) as { track: SpotifyTrackPayload | null }[])
        .filter((item) => item?.track)
        .map((item) => toSpotifyTrack(item.track!));
      setPlaylistTracks((current) => append ? [...(current ?? []), ...tracks] : tracks);
      setNextTrackUrl(validateNextPage(page.next, path));
    } catch (requestError) {
      if (!mounted.current || requestId !== playlistDetailGeneration.current || controller.signal.aborted) return;
      if (isSpotifyAuthLeaseCurrent(lease)) {
        const status = typeof requestError === "object" && requestError !== null && "status" in requestError
          ? String(requestError.status)
          : "";
        setError(status
          ? t.spotifyPlaylistLoadFailed.replace("{status}", status)
          : t.spotifySearchFailed);
      }
    } finally {
      if (mounted.current && requestId === playlistDetailGeneration.current) setLoading(false);
    }
  }, [t.spotifyPlaylistLoadFailed, t.spotifySearchFailed]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      searchGeneration.current += 1;
      playlistGeneration.current += 1;
      playlistDetailGeneration.current += 1;
      searchAbort.current?.abort();
      playlistAbort.current?.abort();
      playlistDetailAbort.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (observedAuthGeneration.current === authGeneration) return;
    observedAuthGeneration.current = authGeneration;
    searchGeneration.current += 1;
    playlistGeneration.current += 1;
    playlistDetailGeneration.current += 1;
    searchAbort.current?.abort();
    playlistAbort.current?.abort();
    playlistDetailAbort.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(false);
    setError(null);
    setSearchResults([]);
    setNextSearchUrl(null);
    setPlaylists([]);
    setPlaylistsLoaded(false);
    setNextPlaylistUrl(null);
    setPlaylistTracks(null);
    setNextTrackUrl(null);
    setSelectedPlaylist(null);
  }, [authGeneration]);

  useEffect(() => {
    if (tab === "playlists") {
      searchGeneration.current += 1;
      searchAbort.current?.abort();
      searchAbort.current = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!playlistsLoaded) void loadPlaylistPage(null, false);
      else setLoading(false);
    } else {
      playlistGeneration.current += 1;
      playlistDetailGeneration.current += 1;
      playlistAbort.current?.abort();
      playlistDetailAbort.current?.abort();
      setLoading(false);
    }
  }, [tab, playlistsLoaded, loadPlaylistPage]);

  const loadSearchPage = useCallback(async (q: string, nextUrl: string | null, append: boolean) => {
    const requestId = ++searchGeneration.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const lease = spotifyAuthLease();
    setLoading(true);
    setError(null);
    try {
      const url = nextUrl
        ? validateNextPage(nextUrl, "/v1/search")!
        : `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=50`;
      const data = await spotifyApiRequest(url, { signal: controller.signal }, (response) => response.json(), lease);
      if (!mounted.current || requestId !== searchGeneration.current || !isSpotifyAuthLeaseCurrent(lease)) return;
      const tracks = ((data.tracks?.items ?? []) as SpotifyTrackPayload[]).map(toSpotifyTrack);
      setSearchResults((current) => append ? [...current, ...tracks] : tracks);
      setNextSearchUrl(validateNextPage(data.tracks?.next, "/v1/search"));
    } catch {
      if (mounted.current && requestId === searchGeneration.current && !controller.signal.aborted && isSpotifyAuthLeaseCurrent(lease)) {
        setError(t.spotifySearchFailed);
      }
    } finally {
      if (mounted.current && requestId === searchGeneration.current) setLoading(false);
    }
  }, [t.spotifySearchFailed]);

  const handleSearch = (q: string) => {
    const queryGeneration = ++searchGeneration.current;
    searchAbort.current?.abort();
    searchAbort.current = null;
    setQuery(q);
    setSearchResults([]);
    setNextSearchUrl(null);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setLoading(false); return; }
    debounceRef.current = setTimeout(async () => {
      if (queryGeneration === searchGeneration.current) void loadSearchPage(q, null, false);
    }, 400);
  };

  const openPlaylist = (pl: Playlist) => {
    playlistDetailAbort.current?.abort();
    setSelectedPlaylist(pl);
    setPlaylistTracks([]);
    setNextTrackUrl(null);
    void loadPlaylistTrackPage(pl, null, false);
  };

  const backToPlaylists = () => {
    playlistDetailGeneration.current += 1;
    playlistDetailAbort.current?.abort();
    setSelectedPlaylist(null);
    setPlaylistTracks(null);
    setNextTrackUrl(null);
    setLoading(false);
    setError(null);
  };

  const handleSelectTrack = async (track: SpotifyTrack) => {
    const lease = spotifyAuthLease();
    setError(null);
    try {
      await activateSpotifyPlayer(); // unlock audio context on user gesture
      if (!isSpotifyAuthLeaseCurrent(lease)) return;
      await playTrack(track.uri);
      if (!isSpotifyAuthLeaseCurrent(lease)) return;
      setSpotifyMode(true);
      onClose();
    } catch (e) {
      if (!isSpotifyAuthLeaseCurrent(lease)) return;
      const msg = String(e);
      if (msg.includes("NO_ACTIVE_DEVICE") || msg.includes("No active device")) {
        setError(t.spotifyNoPlayableDevices);
      } else {
        setError(t.spotifyPlaybackFailed.replace("{error}", msg));
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden max-h-[calc(100%-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
          <span className="font-semibold text-[var(--ls-text)]">{t.spotifySearchTitle}</span>
          <button onClick={onClose} aria-label={t.close} className="ls-button hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--ls-border-subtle)] shrink-0">
          <TabBtn active={tab === "search"} onClick={() => { setTab("search"); backToPlaylists(); }}>
            {t.spotifySearchPlaceholder.split(",")[0]}
          </TabBtn>
          <TabBtn active={tab === "playlists"} onClick={() => setTab("playlists")}>
            {t.spotifyMyPlaylists}
          </TabBtn>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {error && <p className="px-4 py-3 text-xs text-red-400 bg-red-900/20">{error}</p>}
          {tab === "search" && (
            <div className="flex flex-col">
              <div className="p-3 sticky top-0 bg-[var(--ls-surface)] z-10">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={t.spotifySearchPlaceholder}
                  className="ls-field w-full text-sm"
                />
              </div>
              {loading && <LoadingRow />}
              {!loading && query && searchResults.length === 0 && (
                <p className="text-xs text-[var(--ls-text-secondary)] text-center py-8">{t.spotifyNoResults}</p>
              )}
              {searchResults.map((track) => (
                <TrackRow key={track.uri} track={track} onSelect={handleSelectTrack} />
              ))}
              {nextSearchUrl && (
                <button
                  onClick={() => void loadSearchPage(query, nextSearchUrl, true)}
                  disabled={loading}
                  className="ls-button text-sm transition-colors"
                >
                  {t.spotifyLoadMore}
                </button>
              )}
            </div>
          )}

          {tab === "playlists" && !selectedPlaylist && (
            <div className="flex flex-col">
              {loading && <LoadingRow />}
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => openPlaylist(pl)}
                  className="ls-button flex items-center gap-3 transition-colors text-left"
                >
                  {pl.imageUrl
                    ? <img src={pl.imageUrl} alt={pl.name} className="w-10 h-10 rounded shrink-0 object-cover" />
                    : <div className="w-10 h-10 rounded bg-[var(--ls-control)] shrink-0" />
                  }
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm text-[var(--ls-text)] truncate">{pl.name}</span>
                    <span className="text-xs text-[var(--ls-text-secondary)]">{pl.trackCount} tracks</span>
                  </div>
                </button>
              ))}
              {nextPlaylistUrl && (
                <button
                  onClick={() => void loadPlaylistPage(nextPlaylistUrl, true)}
                  disabled={loading}
                  className="ls-button text-sm transition-colors"
                >
                  {t.spotifyLoadMore}
                </button>
              )}
            </div>
          )}

          {tab === "playlists" && selectedPlaylist && (
            <div className="flex flex-col">
              <button
                onClick={backToPlaylists}
                className="ls-button flex items-center gap-2 text-xs transition-colors sticky top-0 border-b"
              >
                ← {selectedPlaylist.name}
              </button>
              {loading && <LoadingRow />}
              {playlistTracks?.map((track) => (
                <TrackRow key={track.uri} track={track} onSelect={handleSelectTrack} />
              ))}
              {nextTrackUrl && (
                <button
                  onClick={() => selectedPlaylist && void loadPlaylistTrackPage(selectedPlaylist, nextTrackUrl, true)}
                  disabled={loading}
                  className="ls-button text-sm transition-colors"
                >
                  {t.spotifyLoadMore}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrackRow({ track, onSelect }: { track: SpotifyTrack; onSelect: (t: SpotifyTrack) => void }) {
  return (
    <button
      onClick={() => onSelect(track)}
      className="ls-button flex items-center gap-3 transition-colors text-left w-full"
    >
      {track.albumArtUrl
        ? <img src={track.albumArtUrl} alt={track.albumName} className="w-9 h-9 rounded shrink-0 object-cover" />
        : <div className="w-9 h-9 rounded bg-[var(--ls-control)] shrink-0" />
      }
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm text-[var(--ls-text)] truncate">{track.name}</span>
        <span className="text-xs text-[var(--ls-text-secondary)] truncate">{track.artistName}</span>
      </div>
    </button>
  );
}

function LoadingRow() {
  return <div className="px-4 py-6 text-xs text-[var(--ls-text-secondary)] text-center">loading...</div>;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`ls-button ${[
        "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active ? "text-green-400 border-green-500" : "text-[var(--ls-text-secondary)] border-transparent hover:text-[var(--ls-text)]",
      ].join(" ")}`}
    >
      {children}
    </button>
  );
}
