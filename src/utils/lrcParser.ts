import { LrcDocument, LrcLine, LrcMetadata, defaultDocument } from "../types/lrc";

const META_TAGS: Record<string, keyof LrcMetadata> = {
  ti: "title",
  ar: "artist",
  al: "album",
  by: "by",
  offset: "offset",
};

// [mm:ss.xx] or [mm:ss.xxx]
const TIMESTAMP_RE = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;
const META_RE = /^\[(\w+):([^\]]*)\]$/;

export function parseTimestamp(ts: string): number | null {
  const m = TIMESTAMP_RE.exec(ts);
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  const secs = parseInt(m[2], 10);
  const frac = m[3].length === 2 ? parseInt(m[3], 10) / 100 : parseInt(m[3], 10) / 1000;
  return mins * 60 + secs + frac;
}

// MM:SS.xx 형식의 사용자 입력을 초(number)로 파싱
export function parseTimestampInput(input: string): number | null {
  const m = /^(\d+):(\d{2})\.(\d{2,3})$/.exec(input.trim());
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  const secs = parseInt(m[2], 10);
  const frac = m[3].length === 2 ? parseInt(m[3], 10) / 100 : parseInt(m[3], 10) / 1000;
  return mins * 60 + secs + frac;
}

// LRC 파일 직렬화용 [MM:SS.xx]
export function formatTimestamp(seconds: number): string {
  const totalCs = Math.round(seconds * 100);
  const cs = totalCs % 100;
  const totalSecs = Math.floor(totalCs / 100);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// UI 표시용 H:MM:SS.mmm
export function formatDisplayTime(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const s = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const m = totalMins % 60;
  const h = Math.floor(totalMins / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export type LineWarning = "outOfOrder" | "duplicate";

// 타임스탬프 줄의 순서 역전·중복을 검사해 lineId → 경고 맵 반환
export function validateTimestamps(lines: LrcLine[]): Map<string, LineWarning> {
  const warnings = new Map<string, LineWarning>();

  // 중복 검사 (센티초 단위 = LRC 정밀도)
  const seen = new Map<number, string[]>();
  for (const l of lines) {
    if (l.timestamp === null) continue;
    const cs = Math.round(l.timestamp * 100);
    const ids = seen.get(cs) ?? [];
    ids.push(l.id);
    seen.set(cs, ids);
  }
  for (const ids of seen.values()) {
    if (ids.length > 1) ids.forEach((id) => warnings.set(id, "duplicate"));
  }

  // 순서 역전 검사 (배열 순서 = 가사 순서, 타임스탬프는 오름차순이어야 함)
  let lastTs: number | null = null;
  for (const l of lines) {
    if (l.timestamp === null) continue;
    if (lastTs !== null && l.timestamp < lastTs) {
      // 중복 경고가 우선이 아니면 순서 경고로 표시
      if (!warnings.has(l.id)) warnings.set(l.id, "outOfOrder");
    }
    lastTs = l.timestamp;
  }

  return warnings;
}

export function parseLrc(raw: string): LrcDocument {
  const doc = defaultDocument();
  let lineId = 0;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // 타임스탬프 줄을 META_RE보다 먼저 검사
    // ([MM:SS.xx] 형식이 META_RE에도 매칭되므로 순서가 중요)
    const tsMatch = TIMESTAMP_RE.exec(line);
    if (tsMatch) {
      const timestamp = parseTimestamp(line);
      const text = tsMatch[4].trim();
      doc.lines.push({ id: String(lineId++), timestamp, text });
      continue;
    }

    const metaMatch = META_RE.exec(line);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      const value = metaMatch[2].trim();
      const field = META_TAGS[key];
      if (field) {
        if (field === "offset") {
          doc.metadata.offset = parseInt(value, 10) || 0;
        } else {
          (doc.metadata as unknown as Record<string, string>)[field] = value;
        }
      } else {
        doc.extraTags[key] = value;
      }
      continue;
    }

    doc.lines.push({ id: String(lineId++), timestamp: null, text: line });
  }

  doc.lines.sort((a, b) => {
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return a.timestamp - b.timestamp;
  });

  return doc;
}

export function serializeLrc(doc: LrcDocument): string {
  const { metadata, lines, extraTags } = doc;
  const parts: string[] = [];

  if (metadata.title) parts.push(`[ti:${metadata.title}]`);
  if (metadata.artist) parts.push(`[ar:${metadata.artist}]`);
  if (metadata.album) parts.push(`[al:${metadata.album}]`);
  if (metadata.by) parts.push(`[by:${metadata.by}]`);
  if (metadata.offset !== 0) parts.push(`[offset:${metadata.offset}]`);
  for (const [key, val] of Object.entries(extraTags)) {
    parts.push(`[${key}:${val}]`);
  }
  parts.push("");

  for (const line of lines) {
    if (line.timestamp !== null) {
      parts.push(`[${formatTimestamp(line.timestamp)}]${line.text}`);
    } else if (line.text) {
      parts.push(line.text);
    }
  }

  return parts.join("\n");
}
