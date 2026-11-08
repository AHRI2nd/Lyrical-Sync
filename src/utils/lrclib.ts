// LRCLIB (lrclib.net) 가사 검색 — 무료·무인증·CORS 지원, 프론트 fetch 직접 호출.

const BASE = "https://lrclib.net/api";
const SEARCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLrcLibResult(value: unknown): LrcLibResult | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) ||
      typeof value.trackName !== "string" || typeof value.artistName !== "string" ||
      (typeof value.albumName !== "string" && value.albumName !== null) ||
      typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0 ||
      typeof value.instrumental !== "boolean" ||
      (value.plainLyrics !== null && typeof value.plainLyrics !== "string") ||
      (value.syncedLyrics !== null && typeof value.syncedLyrics !== "string")) return null;
  return {
    id: value.id as number,
    trackName: value.trackName,
    artistName: value.artistName,
    albumName: typeof value.albumName === "string" ? value.albumName : "",
    duration: value.duration,
    instrumental: value.instrumental,
    plainLyrics: value.plainLyrics as string | null,
    syncedLyrics: value.syncedLyrics as string | null,
  };
}

// 검색: track_name이 있으면 필드 검색, 없으면 q(합성어)로 폴백.
export async function lrclibSearch(q: LrcLibQuery, signal?: AbortSignal): Promise<LrcLibResult[]> {
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

  // A caller's cancellation must not disable the search deadline.
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason ?? new DOMException("Search cancelled", "AbortError"));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("LRCLIB search timed out", "TimeoutError"));
  }, SEARCH_TIMEOUT_MS);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const res = await fetch(BASE + "/search?" + params.toString(), { signal: controller.signal });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!res.ok) throw new Error("LRCLIB " + res.status);

    // Bound streamed responses even when the server omits Content-Length.
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new Error("LRCLIB response too large: " + contentLength + " bytes (max " + MAX_RESPONSE_BYTES + ")");
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("LRCLIB response body is null");

    let receivedBytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (done) break;
      if (value) {
        receivedBytes += value.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          throw new Error("LRCLIB response exceeded " + MAX_RESPONSE_BYTES + " bytes");
        }
        chunks.push(value);
      }
    }

    // Concatenate all Uint8Array chunks into a single array.
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const concatenated = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      concatenated.set(chunk, offset);
      offset += chunk.length;
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(concatenated));
    if (!Array.isArray(data)) throw new Error("LRCLIB unexpected response shape");
    return data.map(parseLrcLibResult).filter((result): result is LrcLibResult => result !== null);
  } catch (error) {
    // Stop streaming a response after a parse, status or size error as well.
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
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
