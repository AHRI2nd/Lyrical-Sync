import { useEffect, useRef, useState } from "react";
import { useServiceStore, type SpotifyTrack } from "../../stores/useServiceStore";
import { activateSpotifyPlayer } from "../../utils/spotifyPlayer";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";

interface Playlist {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
}

interface Props {
  onClose: () => void;
}

export function SpotifySearchModal({ onClose }: Props) {
  const { t } = useI18nStore();
  const { ensureToken, playTrack } = useServiceStore();
  const setSpotifyMode = useSettingsStore((s) => s.setSpotifyMode);
  const [tab, setTab] = useState<"search" | "playlists">("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyTrack[] | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Load playlists when tab switches
  useEffect(() => {
    if (tab !== "playlists" || playlists.length > 0) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await ensureToken();
        const resp = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const text = await resp.text();
          console.error("[playlists] fetch failed:", resp.status, text);
          setError(`플레이리스트 로드 실패 (${resp.status})`);
          setLoading(false);
          return;
        }
        const data = await resp.json();
        setPlaylists(
          ((data.items ?? []) as { id: string; name: string; images: { url: string }[]; tracks: { total: number } }[])
            .filter(Boolean)
            .map((p) => ({
              id: p.id,
              name: p.name,
              imageUrl: p.images?.[0]?.url ?? null,
              trackCount: p.tracks?.total ?? 0,
            }))
        );
      } catch (e) {
        console.error("[playlists] error:", e);
        setError(String(e));
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const token = await ensureToken();
        const resp = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=20`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await resp.json();
        setSearchResults(
          (data.tracks.items as {
            uri: string; name: string;
            artists: { name: string }[];
            album: { name: string; images: { url: string }[] };
            duration_ms: number;
          }[]).map((item) => ({
            uri: item.uri,
            name: item.name,
            artistName: item.artists.map((a) => a.name).join(", "),
            albumName: item.album.name,
            albumArtUrl: item.album.images[0]?.url ?? null,
            durationMs: item.duration_ms,
          }))
        );
      } catch { /* ignore */ }
      setLoading(false);
    }, 400);
  };

  const openPlaylist = async (pl: Playlist) => {
    setSelectedPlaylist(pl);
    setPlaylistTracks(null);
    setLoading(true);
    try {
      const token = await ensureToken();
      const resp = await fetch(
        `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50&fields=items(track(uri,name,artists,album,duration_ms))`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resp.json();
      setPlaylistTracks(
        (data.items as { track: {
          uri: string; name: string;
          artists: { name: string }[];
          album: { name: string; images: { url: string }[] };
          duration_ms: number;
        } | null }[])
          .filter((i) => i.track)
          .map((i) => ({
            uri: i.track!.uri,
            name: i.track!.name,
            artistName: i.track!.artists.map((a) => a.name).join(", "),
            albumName: i.track!.album.name,
            albumArtUrl: i.track!.album.images[0]?.url ?? null,
            durationMs: i.track!.duration_ms,
          }))
      );
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSelectTrack = async (track: SpotifyTrack) => {
    setError(null);
    try {
      await activateSpotifyPlayer(); // unlock audio context on user gesture
      await playTrack(track.uri);
      setSpotifyMode(true);
      onClose();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("NO_ACTIVE_DEVICE") || msg.includes("No active device")) {
        setError("재생 가능한 Spotify 기기가 없습니다. Spotify 앱(폰 또는 PC)을 먼저 열어주세요.");
      } else {
        setError(`재생 실패: ${msg}`);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.spotifySearchTitle}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          <TabBtn active={tab === "search"} onClick={() => { setTab("search"); setSelectedPlaylist(null); setPlaylistTracks(null); }}>
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
              <div className="p-3 sticky top-0 bg-zinc-900 z-10">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={t.spotifySearchPlaceholder}
                  className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              {loading && <LoadingRow />}
              {!loading && query && searchResults.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-8">{t.spotifyNoResults}</p>
              )}
              {searchResults.map((track) => (
                <TrackRow key={track.uri} track={track} onSelect={handleSelectTrack} />
              ))}
            </div>
          )}

          {tab === "playlists" && !selectedPlaylist && (
            <div className="flex flex-col">
              {loading && <LoadingRow />}
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => openPlaylist(pl)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800 transition-colors text-left"
                >
                  {pl.imageUrl
                    ? <img src={pl.imageUrl} alt={pl.name} className="w-10 h-10 rounded shrink-0 object-cover" />
                    : <div className="w-10 h-10 rounded bg-zinc-700 shrink-0" />
                  }
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm text-zinc-100 truncate">{pl.name}</span>
                    <span className="text-xs text-zinc-500">{pl.trackCount} tracks</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {tab === "playlists" && selectedPlaylist && (
            <div className="flex flex-col">
              <button
                onClick={() => { setSelectedPlaylist(null); setPlaylistTracks(null); }}
                className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors sticky top-0 bg-zinc-900 border-b border-zinc-800"
              >
                ← {selectedPlaylist.name}
              </button>
              {loading && <LoadingRow />}
              {playlistTracks?.map((track) => (
                <TrackRow key={track.uri} track={track} onSelect={handleSelectTrack} />
              ))}
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
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800 transition-colors text-left w-full"
    >
      {track.albumArtUrl
        ? <img src={track.albumArtUrl} alt={track.albumName} className="w-9 h-9 rounded shrink-0 object-cover" />
        : <div className="w-9 h-9 rounded bg-zinc-700 shrink-0" />
      }
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm text-zinc-100 truncate">{track.name}</span>
        <span className="text-xs text-zinc-400 truncate">{track.artistName}</span>
      </div>
    </button>
  );
}

function LoadingRow() {
  return <div className="px-4 py-6 text-xs text-zinc-500 text-center">loading...</div>;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active ? "text-green-400 border-green-500" : "text-zinc-400 border-transparent hover:text-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
