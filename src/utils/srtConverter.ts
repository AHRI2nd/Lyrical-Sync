import { LrcDocument, defaultDocument } from "../types/lrc";
import { nextCueEnd } from "./exportFormats";

export const SRT_UNREPRESENTABLE_CONTENT_CODE = "SRT_UNREPRESENTABLE_CONTENT";
export const SRT_MALFORMED_CUE_CODE = "SRT_MALFORMED_CUE";

export class SrtMalformedCueError extends Error {
  readonly code = SRT_MALFORMED_CUE_CODE;

  constructor(blockNumber: number) {
    super(`Malformed SRT cue timestamp in block ${blockNumber}; import was cancelled to prevent data loss.`);
    this.name = "SrtMalformedCueError";
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
  if (metadata.title || metadata.artist || metadata.album || metadata.by || metadata.offset !== 0 ||
      Object.keys(doc.extraTags).length > 0 ||
      doc.lines.some((line) => line.timestamp === null || line.translation !== undefined ||
        line.syllables?.some((syllable) => syllable.time !== null))) {
    throw new SrtLossyDocumentError();
  }

  const expectedBoundaries = doc.lines
    .filter((line) => line.timestamp !== null && line.text.trim() === "" && !line.translation?.trim())
    .map((line) => Math.round((line.timestamp as number) * 1000));
  if (expectedBoundaries.length > 0) {
    const roundTripped = parseSrt(serializeSrt(doc));
    const representedTimes = new Set(roundTripped.lines
      .filter((line) => line.timestamp !== null)
      .map((line) => Math.round((line.timestamp as number) * 1000)));
    if (expectedBoundaries.some((time) => !representedTimes.has(time))) throw new SrtLossyDocumentError();
  }
}

export class SrtUnrepresentableContentError extends Error {
  readonly code = SRT_UNREPRESENTABLE_CONTENT_CODE;

  constructor() {
    super("SRT cannot preserve blank paragraph rows in a cue.");
    this.name = "SrtUnrepresentableContentError";
  }
}

function assertSrtBodyRepresentable(value: string | undefined): void {
  if (value === undefined || value.trim() === "") return;
  const rows = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (rows.length && rows[rows.length - 1].trim() === "") rows.pop();
  if (rows.some((row) => row.trim() === "")) throw new SrtUnrepresentableContentError();
}

// SubRip 시간 형식: HH:MM:SS,mmm
function formatSrtTime(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  if (!Number.isFinite(seconds) || !Number.isSafeInteger(totalMs) || seconds < 0) {
    throw new Error("SRT timestamps must be finite, non-negative, and representable in milliseconds.");
  }
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

function parseSrtTime(str: string): number | null {
  const m = SRT_TIME_RE.exec(str.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) / 1000;
  const seconds = h * 3600 + min * 60 + s + frac;
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Export text cues ending at the next strictly later timed line (including blanks),
 * a finite later audio duration, or a four-second fallback. Coincident starts share an end.
 */
export function serializeSrt(doc: LrcDocument, lastCueEnd?: number): string {
  if (!doc.lines.every((line) =>
    (line.timestamp === null || (Number.isFinite(line.timestamp) && line.timestamp >= 0)) &&
    (line.srtEndTime === undefined || (Number.isFinite(line.srtEndTime) && line.srtEndTime >= 0)) &&
    (line.syllables?.every((syllable) => syllable.time === null || (Number.isFinite(syllable.time) && syllable.time >= 0)) ?? true)
  )) throw new Error("SRT timestamps must be finite and non-negative.");
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const cues: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "" && !line.translation?.trim()) continue; // Empty rows provide boundaries only.
    const text = line.text.trim() === "" ? (line.translation ?? "") : line.translation ? `${line.text}\n${line.translation}` : line.text;
    assertSrtBodyRepresentable(text);
    const start = line.timestamp as number;
    const importedEnd = line.srtEndTime;
    const end = Number.isFinite(importedEnd) && (importedEnd as number) > start
      ? importedEnd as number
      : nextCueEnd(timed, i, start, lastCueEnd);
    cues.push({ start, end, text });
  }

  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}`
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
  const cues: { start: number; end: number; text: string }[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const rows = block.split("\n");
    while (rows.length && rows[rows.length - 1] === "") rows.pop();
    if (rows.length === 0) continue;

    const hasIndex = /^\d+$/.test(rows[0].trim());
    const arrowIdx = rows.findIndex((row, index) => {
      const arrow = row.indexOf("-->");
      if (arrow < 0) return false;
      const left = row.slice(0, arrow);
      const right = row.slice(arrow + 3);
      const shapedTimestamp = /^\s*\d+:[^\s:]*:[^\s:]*/;
      return shapedTimestamp.test(left) || shapedTimestamp.test(right) ||
        (hasIndex && /\d+:[^\s:]*:[^\s:]*/.test(left)) ||
        (hasIndex && index === 1);
    });
    if (arrowIdx === -1) continue;

    const pieces = rows[arrowIdx].split("-->");
    if (pieces.length !== 2) throw new SrtMalformedCueError(blockIndex + 1);
    const [startStr, endStr] = pieces;
    const start = parseSrtTime(startStr);
    const end = parseSrtTime(endStr);
    if (start === null || end === null) throw new SrtMalformedCueError(blockIndex + 1);

    const text = rows.slice(arrowIdx + 1).join("\n");
    cues.push({ start, end, text });
  }

  cues.sort((a, b) => a.start - b.start);

  // 2) cue → 가사 줄 + 가사 사이 갭에 빈 줄(경계) 삽입
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    doc.lines.push({ id: String(lineId++), timestamp: cue.start, srtEndTime: cue.end, text: cue.text });

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
