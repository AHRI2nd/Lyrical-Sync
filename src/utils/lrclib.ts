// LRCLIB (lrclib.net) 가사 검색 — 무료·무인증·CORS 지원, 프론트 fetch 직접 호출.

const BASE = "https://lrclib.net/api";

export interface LrcLibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LrcLibQuery {
  title?: string;
  artist?: string;
  album?: string;
}

// 검색: track_name이 있으면 필드 검색, 없으면 q(합성어)로 폴백.
export async function lrclibSearch(q: LrcLibQuery): Promise<LrcLibResult[]> {
  const title = q.title?.trim() ?? "";
  const artist = q.artist?.trim() ?? "";
  const album = q.album?.trim() ?? "";

  const params = new URLSearchParams();
  if (title) {
    params.set("track_name", title);
    if (artist) params.set("artist_name", artist);
    if (album) params.set("album_name", album);
  } else {
    const query = [artist, album].filter(Boolean).join(" ").trim();
    if (!query) return [];
    params.set("q", query);
  }

  const res = await fetch(`${BASE}/search?${params.toString()}`);
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as LrcLibResult[]) : [];
}

// 문자열 정규화 후 0~1 유사도
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  const sa = new Set(na.split(" "));
  const sb = new Set(nb.split(" "));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const uni = new Set([...sa, ...sb]).size;
  return uni ? (inter / uni) * 0.6 : 0;
}

// 제목 > 아티스트 > 앨범 우선순위로 현재 곡과의 정확도 점수.
// 사용자가 입력한 필드만 점수에 반영(빈 필드는 정렬에 영향 없음).
export function scoreResult(r: LrcLibResult, q: LrcLibQuery): number {
  let s = 0;
  if (q.title?.trim()) s += 100 * similarity(r.trackName, q.title);
  if (q.artist?.trim()) s += 10 * similarity(r.artistName, q.artist);
  if (q.album?.trim()) s += 1 * similarity(r.albumName, q.album);
  return s;
}

export function sortByAccuracy(results: LrcLibResult[], q: LrcLibQuery): LrcLibResult[] {
  return results
    .map((r) => ({ r, s: scoreResult(r, q) }))
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      // 정확도가 같으면 동기화 가사를 위로
      return (b.r.syncedLyrics ? 1 : 0) - (a.r.syncedLyrics ? 1 : 0);
    })
    .map((x) => x.r);
}
