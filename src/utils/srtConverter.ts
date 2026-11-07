import { LrcDocument, defaultDocument } from "../types/lrc";
import { nextCueEnds } from "./exportFormats";

export const SRT_UNREPRESENTABLE_CONTENT_CODE = "SRT_UNREPRESENTABLE_CONTENT";
export const SRT_INVALID_TIMESTAMP_CODE = "SRT_INVALID_TIMESTAMP";
export const SRT_MALFORMED_CUE_CODE = "SRT_MALFORMED_CUE";

/** A cue-like SRT block could not be imported without dropping or changing data. */
export class SrtMalformedCueError extends Error {
  readonly code = SRT_MALFORMED_CUE_CODE;

  constructor(blockNumber: number, operation: "import" | "save" = "import") {
    super(`Malformed SRT cue timestamp or position settings in block ${blockNumber}; ${operation} was cancelled to prevent data loss.`);
    this.name = "SrtMalformedCueError";
  }
}

export class SrtInvalidTimestampError extends Error {
  readonly code = SRT_INVALID_TIMESTAMP_CODE;

  constructor() {
    super("SRT timestamp cannot be represented as safe integer milliseconds.");
    this.name = "SrtInvalidTimestampError";
  }
}

export const SRT_LOSSY_DOCUMENT_CODE = "SRT_LOSSY_DOCUMENT";

export class SrtLossyDocumentError extends Error {
  readonly code = SRT_LOSSY_DOCUMENT_CODE;

  constructor() {
    super("SRT cannot preserve LRC metadata, untimed rows, translations, or timed syllables.");
    this.name = "SrtLossyDocumentError";
  }
}

export function assertSrtDocumentLossless(doc: LrcDocument): void {
  const { metadata } = doc;
  if (metadata.title || metadata.artist || metadata.album || metadata.by || metadata.offset !== 0 || Object.keys(doc.extraTags).length > 0 ||
      doc.lines.some((line) => line.timestamp === null || line.translation !== undefined || line.syllables?.some((syllable) => syllable.time !== null))) {
    throw new SrtLossyDocumentError();
  }
}

export class SrtUnrepresentableContentError extends Error {
  readonly code = SRT_UNREPRESENTABLE_CONTENT_CODE;

  constructor() {
    super("SRT cannot preserve blank paragraph rows or a terminal line break in a cue.");
    this.name = "SrtUnrepresentableContentError";
  }
}

function assertSrtBodyRepresentable(value: string | undefined): void {
  if (value === undefined || value.trim() === "") return;
  if (value.endsWith("\n") || value.endsWith("\r")) throw new SrtUnrepresentableContentError();
  const rows = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (rows.length && rows[rows.length - 1].trim() === "") rows.pop();
  if (rows.some((row) => row.trim() === "")) throw new SrtUnrepresentableContentError();
}

function decodeSrtEntities(value: string): string {
  return value.replace(/&(amp|lt|gt);/g, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    return ">";
  });
}

// SubRip 시간 형식: HH:MM:SS,mmm
function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  if (!Number.isSafeInteger(totalMs)) throw new SrtInvalidTimestampError();
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const s = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const m = totalMins % 60;
  const h = Math.floor(totalMins / 60);
  return (
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`
  );
}

// HH:MM:SS,mmm 또는 H:MM:SS.mmm 등 허용 (콤마/마침표 모두)
const SRT_TIME_RE = /^(\d+):([0-5]\d):([0-5]\d)[.,](\d{1,3})(?=\s|$)/;

// Keep original SubRip X1/X2/Y1/Y2 coordinates and other already-accepted
// single-line extensions. A bounded value without line/control characters
// cannot create another cue or timing row, including after JSON recovery.
const SRT_UNSAFE_CUE_SETTINGS_RE = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029]/;
const MAX_SRT_CUE_SETTINGS_LENGTH = 256;

function validSrtCueSettings(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_SRT_CUE_SETTINGS_LENGTH && value === value.trim() &&
    !SRT_UNSAFE_CUE_SETTINGS_RE.test(value) && !value.includes("-->");
}

function parseSrtTime(str: string, allowSettings = false): number | null {
  const trimmed = str.trim();
  const m = SRT_TIME_RE.exec(trimmed);
  if (!m) return null;
  // SRT cue settings such as X1:10/X2:20 follow the *end* timestamp.
  // Anything after a start timestamp is malformed, not a second timestamp.
  if (!allowSettings && m[0].length !== trimmed.length) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) / 1000;
  const seconds = h * 3600 + min * 60 + s + frac;
  return Number.isFinite(seconds) ? seconds : null;
}

function parseSrtEnd(str: string): { time: number; settings?: string } | null {
  // Check before trimming: Unicode line separators at the edge of the field
  // would otherwise disappear and turn a malformed cue into a lossy import.
  if (SRT_UNSAFE_CUE_SETTINGS_RE.test(str)) return null;
  const trimmed = str.trim();
  const match = SRT_TIME_RE.exec(trimmed);
  const time = parseSrtTime(trimmed, true);
  if (!match || time === null) return null;
  const settings = trimmed.slice(match[0].length).trim();
  if (!settings) return { time };
  if (!validSrtCueSettings(settings)) return null;
  return { time, settings };
}

/**
 * Export text cues ending at the next strictly later timed line (including blanks),
 * a finite later audio duration, or a four-second fallback. Coincident starts share an end.
 */
export function serializeSrt(doc: LrcDocument, lastCueEnd?: number): string {
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const fallbackEnds = nextCueEnds(timed, lastCueEnd);
  const cues: { start: number; end: number; text: string; settings?: string }[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "" && !line.translation?.trim()) continue; // Empty rows provide boundaries only.
    const start = line.timestamp as number;
    const importedEnd = line.srtEndTime;
    const settings = line.srtCueSettings;
    if (settings !== undefined && !validSrtCueSettings(settings)) {
      throw new SrtMalformedCueError(i + 1, "save");
    }
    if (importedEnd !== undefined &&
        (!Number.isFinite(importedEnd) || Math.round(importedEnd * 1000) <= Math.round(start * 1000))) {
      throw new SrtInvalidTimestampError();
    }
    const end = importedEnd !== undefined
      ? importedEnd
      : fallbackEnds[i];
    const rawText = line.text.trim() === "" ? (line.translation ?? "") : line.translation ? `${line.text}\n${line.translation}` : line.text;
    // Encode literal text so SRT players do not interpret LRC-like text as markup.
    const text = rawText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    assertSrtBodyRepresentable(text);
    cues.push({ start, end, text, settings });
  }

  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}${c.settings ? ` ${c.settings}` : ""}\n${c.text}`
      )
      .join("\n\n") + "\n"
  );
}

/**
 * Import cue starts and preserve multiline bodies and original cue ends.
 * Intermediate gaps also become blank timed boundaries for LRC-compatible editing.
 */
export function parseSrt(raw: string): LrcDocument {
  const doc = defaultDocument();
  let lineId = 0;

  // CRLF 정규화 후 빈 줄 기준으로 블록 분할
  const blocks = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\s*\n/);

  // 1) cue(start, end, text) 수집
  const cues: { start: number; end: number; text: string; settings?: string }[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const rows = block.split("\n");
    while (rows.length && rows[rows.length - 1] === "") rows.pop();
    if (rows.length === 0) continue;

    // Arbitrary preamble text may contain "-->". Recognize a cue by its
    // numeric index or a timestamp-shaped field on either side of the arrow.
    // Once recognized, invalid timestamps MUST fail the entire import rather
    // than silently dropping just that cue before a later save.
    const hasIndex = /^\d+$/.test(rows[0].trim());
    const arrowIdx = rows.findIndex((row, index) => {
      const arrow = row.indexOf("-->");
      if (arrow < 0) return false;
      const left = row.slice(0, arrow);
      const right = row.slice(arrow + 3);
      const shapedStart = /^\s*\d+:[^\s:]*:[^\s:]*/.test(left);
      const shapedEnd = /^\s*\d+:[^\s:]*:[^\s:]*/.test(right);
      const indexedMalformedStart = hasIndex && /\d+:[^\s:]*:[^\s:]*/.test(left);
      // A numbered non-cue note in a preamble is not automatically a cue.
      // After real cues start, a numbered block with an arrow must not be
      // silently dropped even if both timestamp fields are badly malformed.
      return shapedStart || shapedEnd || indexedMalformedStart || (hasIndex && cues.length > 0 && index === 1);
    });
    if (arrowIdx === -1) continue;

    const pieces = rows[arrowIdx].split("-->");
    if (pieces.length !== 2) throw new SrtMalformedCueError(blockIndex + 1);
    const [startStr, endStr] = pieces;
    const start = parseSrtTime(startStr);
    const parsedEnd = parseSrtEnd(endStr);
    if (start === null || parsedEnd === null) throw new SrtMalformedCueError(blockIndex + 1);

    const text = decodeSrtEntities(rows.slice(arrowIdx + 1).join("\n"));
    cues.push({ start, end: parsedEnd.time, text, settings: parsedEnd.settings });
  }

  cues.sort((a, b) => a.start - b.start);

  // 2) cue → 가사 줄 + 가사 사이 갭에 빈 줄(경계) 삽입
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    doc.lines.push({ id: String(lineId++), timestamp: cue.start, srtEndTime: cue.end, text: cue.text,
      ...(cue.settings !== undefined ? { srtCueSettings: cue.settings } : {}) });

    // Keep gap boundaries and the final cue end so imports retain their duration.
    const next = cues[i + 1];
    if (cue.end > cue.start && (!next || cue.end < next.start)) {
      doc.lines.push({ id: String(lineId++), timestamp: cue.end, text: "" });
    }
  }

  doc.lines.sort((a, b) => {
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return a.timestamp - b.timestamp;
  });

  return doc;
}
