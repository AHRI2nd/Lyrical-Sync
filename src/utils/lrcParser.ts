import { LrcDocument, LrcLine, LrcMetadata, LrcSyllable, defaultDocument } from "../types/lrc";

export type SyncUnit = "char" | "word";

// 줄 텍스트를 글자/단어 토큰으로 분할. 공백도 토큰으로 보존(연결 시 원문 복원).
export function tokenizeText(text: string, unit: SyncUnit): LrcSyllable[] {
  if (text === "") return [];
  const pieces =
    unit === "char"
      ? Array.from(text)
      : text.split(/(\s+)/).filter((s) => s !== "");
  return pieces.map((p) => ({ text: p, time: null }));
}

// 공백뿐인 토큰은 스탬프 대상이 아님
export const isStampable = (s: LrcSyllable): boolean => s.text.trim() !== "";

// 스탬프 시각을 이웃(시각이 있는) 토큰 사이로 클램프 → 글자 시각이 항상 단조 증가(유효한 A2 보장)
export function clampToNeighbors(syl: LrcSyllable[], index: number, time: number): number {
  let lo = 0;
  let hi = Infinity;
  for (let i = index - 1; i >= 0; i--) { const t = syl[i].time; if (t !== null) { lo = t; break; } }
  for (let i = index + 1; i < syl.length; i++) { const t = syl[i].time; if (t !== null) { hi = t; break; } }
  return Math.max(lo, Math.min(hi, Math.max(0, time)));
}

const META_TAGS: Record<string, keyof LrcMetadata> = {
  ti: "title",
  ar: "artist",
  al: "album",
  by: "by",
  offset: "offset",
};

const META_RE = /^\[(\w+):([^\]]*)\]$/;
// 줄 맨 앞의 타임스탬프 토큰: [mm:ss.xx] / [mm:ss.xxx] / [mm:ss] (센티초 선택)
// 한 줄에 여러 토큰이 올 수 있음 (후렴 반복: [t1][t2]가사)
const TS_TOKEN_RE = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/;

// Enhanced LRC 인라인 단어 타임스탬프 <mm:ss.xx>
const INLINE_TS_RE = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/g;

// 줄 텍스트(앞쪽 [..] 제거 후) 안의 <mm:ss.xx> 인라인 태그를 파싱해 토큰 배열로.
// 인라인 태그가 없으면 null.
function parseInlineSyllables(rest: string): LrcSyllable[] | null {
  if (!rest.includes("<")) return null;
  INLINE_TS_RE.lastIndex = 0;
  const tags: { time: number; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = INLINE_TS_RE.exec(rest)) !== null) {
    tags.push({
      time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + fracToSeconds(m[3]),
      start: m.index,
      end: INLINE_TS_RE.lastIndex,
    });
  }
  if (tags.length === 0) return null;

  const syl: LrcSyllable[] = [];
  // 첫 태그 앞의 텍스트는 타임스탬프 없는 선행 텍스트
  if (tags[0].start > 0) syl.push({ text: rest.slice(0, tags[0].start), time: null });
  for (let i = 0; i < tags.length; i++) {
    const textStart = tags[i].end;
    const textEnd = i + 1 < tags.length ? tags[i + 1].start : rest.length;
    syl.push({ text: rest.slice(textStart, textEnd), time: tags[i].time });
  }
  return syl;
}

// 소수 부분 문자열을 초로 변환 ("5"→0.5, "34"→0.34, "345"→0.345)
function fracToSeconds(frac: string | undefined): number {
  if (!frac) return 0;
  return parseInt(frac, 10) / Math.pow(10, frac.length);
}

// 단일 타임스탬프 토큰 문자열을 초로 파싱 (뒤따르는 텍스트는 무시)
export function parseTimestamp(ts: string): number | null {
  const m = TS_TOKEN_RE.exec(ts);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + fracToSeconds(m[3]);
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
    // 줄 앞의 타임스탬프 토큰을 모두 추출 → 토큰 개수만큼 같은 텍스트로 줄 분리
    const timestamps: number[] = [];
    let rest = line;
    let tok: RegExpExecArray | null;
    while ((tok = TS_TOKEN_RE.exec(rest)) !== null) {
      timestamps.push(
        parseInt(tok[1], 10) * 60 + parseInt(tok[2], 10) + fracToSeconds(tok[3])
      );
      rest = rest.slice(tok[0].length);
    }
    if (timestamps.length > 0) {
      const syllables = parseInlineSyllables(rest);
      const text = syllables ? syllables.map((s) => s.text).join("") : rest.trim();
      for (const ts of timestamps) {
        doc.lines.push({
          id: String(lineId++),
          timestamp: ts,
          text,
          // 반복 줄([t1][t2]…)마다 토큰을 복제해 공유 참조 방지
          ...(syllables ? { syllables: syllables.map((s) => ({ ...s })) } : {}),
        });
      }
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

// enhanced=false면 글자/단어 동기화 태그를 제거하고 일반 LRC로 출력
export function serializeLrc(doc: LrcDocument, enhanced = true): string {
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
    // Enhanced LRC(A2): 토큰에 시각이 하나라도 있으면 <mm:ss.xx> 인라인으로 출력
    const timedSyl = enhanced && line.syllables?.some((s) => s.time !== null);
    if (timedSyl && line.syllables) {
      const times = line.syllables.filter((s) => s.time !== null).map((s) => s.time as number);
      const lineTs = line.timestamp ?? Math.min(...times);
      let out = `[${formatTimestamp(lineTs)}]`;
      for (const s of line.syllables) {
        if (s.time !== null) out += `<${formatTimestamp(s.time)}>`;
        out += s.text;
      }
      parts.push(out);
    } else if (line.timestamp !== null) {
      parts.push(`[${formatTimestamp(line.timestamp)}]${line.text}`);
    } else if (line.text) {
      parts.push(line.text);
    }
  }

  return parts.join("\n");
}
