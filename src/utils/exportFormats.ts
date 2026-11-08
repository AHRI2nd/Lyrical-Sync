import { LrcDocument, LrcLine } from "../types/lrc";

// Blank timed lines mark cue ends without becoming subtitles themselves.
// SRT, VTT and ASS share strictly later boundaries, valid duration, or a four-second fallback.
interface Cue { start: number; end: number; line: LrcLine; }

export const ASS_UNREPRESENTABLE_CONTENT_CODE = "ASS_UNREPRESENTABLE_CONTENT";
export const ASS_UNREPRESENTABLE_CUE_END_CODE = "ASS_UNREPRESENTABLE_CUE_END";
export const SUBTITLE_TIMESTAMP_UNREPRESENTABLE_CODE = "SUBTITLE_TIMESTAMP_UNREPRESENTABLE";
export const VTT_UNREPRESENTABLE_CONTENT_CODE = "VTT_UNREPRESENTABLE_CONTENT";
export const VTT_INVALID_SYLLABLE_TIME_CODE = "VTT_INVALID_SYLLABLE_TIME";

export class VttUnrepresentableContentError extends Error {
  readonly code = VTT_UNREPRESENTABLE_CONTENT_CODE;

  constructor() {
    super("VTT cannot preserve blank paragraph rows in a cue.");
    this.name = "VttUnrepresentableContentError";
  }
}

export class VttInvalidSyllableTimeError extends Error {
  readonly code = VTT_INVALID_SYLLABLE_TIME_CODE;

  constructor() {
    super("VTT cannot represent these syllable timestamps within the cue.");
    this.name = "VttInvalidSyllableTimeError";
  }
}

function assertVttBodyRepresentable(value: string): void {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.endsWith("\n")) throw new VttUnrepresentableContentError();
  const rows = normalized.split("\n");
  if (rows.some((row) => row.trim() === "")) throw new VttUnrepresentableContentError();
}

export class AssUnrepresentableContentError extends Error {
  readonly code = ASS_UNREPRESENTABLE_CONTENT_CODE;

  constructor() {
    super("ASS cannot preserve this text literally.");
    this.name = "AssUnrepresentableContentError";
  }
}

export class AssUnrepresentableCueEndError extends Error {
  readonly code = ASS_UNREPRESENTABLE_CUE_END_CODE;

  constructor() {
    super("ASS centisecond precision cannot preserve this subtitle cue duration.");
    this.name = "AssUnrepresentableCueEndError";
  }
}

export class SubtitleTimestampUnrepresentableError extends Error {
  readonly code = SUBTITLE_TIMESTAMP_UNREPRESENTABLE_CODE;

  constructor() {
    super("Subtitle timestamp cannot be represented at the output format precision.");
    this.name = "SubtitleTimestampUnrepresentableError";
  }
}

// Precompute the next strictly later boundary per output-precision group in O(n).
export function nextCueEnds(timed: readonly LrcLine[], lastCueEnd?: number, timeUnitsPerSecond = 1000): number[] {
  const startUnits = timed.map((line) => Math.max(0, Math.round((line.timestamp ?? 0) * timeUnitsPerSecond)));
  const nextBoundaries: (number | undefined)[] = new Array(timed.length);
  let groupStart = 0;
  for (let index = 1; index < timed.length; index++) {
    if (startUnits[index] === startUnits[groupStart]) continue;
    const boundary = timed[index].timestamp ?? undefined;
    for (let grouped = groupStart; grouped < index; grouped++) nextBoundaries[grouped] = boundary;
    groupStart = index;
  }

  return timed.map((line, index) => {
    const start = line.timestamp ?? 0;
    const startUnit = startUnits[index];
    const next = nextBoundaries[index];
    if (next !== undefined && Math.round(next * timeUnitsPerSecond) > startUnit) return next;
    if (lastCueEnd !== undefined && Number.isFinite(lastCueEnd) &&
        Math.round(lastCueEnd * timeUnitsPerSecond) > startUnit) return lastCueEnd;
    return Math.max(0, start) + 4;
  });
}

// Compare boundaries at the output format precision so rounding cannot create an empty cue.
export function nextCueEnd(timed: readonly LrcLine[], index: number, start: number, lastCueEnd?: number, timeUnitsPerSecond = 1000): number {
  if (index >= 0 && index < timed.length && timed[index].timestamp === start) {
    return nextCueEnds(timed, lastCueEnd, timeUnitsPerSecond)[index];
  }
  const startUnit = Math.max(0, Math.round(start * timeUnitsPerSecond));
  if (lastCueEnd !== undefined && Number.isFinite(lastCueEnd) && Math.round(lastCueEnd * timeUnitsPerSecond) > startUnit) return lastCueEnd;
  return Math.max(0, start) + 4;
}

function buildCues(doc: LrcDocument, lastCueEnd?: number, timeUnitsPerSecond = 1000): Cue[] {
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  const fallbackEnds = nextCueEnds(timed, lastCueEnd, timeUnitsPerSecond);

  const cues: Cue[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "" && !line.translation?.trim()) continue; // Empty rows provide boundaries only.
    const start = line.timestamp as number;
    const explicitEnd = line.srtEndTime;
    const explicitEndIsRepresentable = Number.isFinite(explicitEnd) &&
      Math.round((explicitEnd as number) * timeUnitsPerSecond) > Math.round(start * timeUnitsPerSecond);
    if (timeUnitsPerSecond === 100 && Number.isFinite(explicitEnd) &&
        (explicitEnd as number) > start && !explicitEndIsRepresentable) {
      throw new AssUnrepresentableCueEndError();
    }
    const end = explicitEndIsRepresentable
      ? explicitEnd as number
      : fallbackEnds[i];
    cues.push({ start, end, line });
  }
  return cues;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const p3 = (n: number) => String(n).padStart(3, "0");

// WebVTT 시간: HH:MM:SS.mmm
function vttTime(seconds: number): string {
  // Clamp negative timestamps to 0 (VTT doesn't support negative times)
  const clampedSeconds = Math.max(0, seconds);
  const ms = Math.max(0, Math.round(clampedSeconds * 1000));
  if (!Number.isSafeInteger(ms)) throw new SubtitleTimestampUnrepresentableError();
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)}.${p3(ms % 1000)}`;
}

export function escapeVttText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Timed glyphs use VTT inline timestamps for karaoke.
function vttText(line: LrcLine, cueStart: number, cueEnd: number): string {
  if (line.text.trim() === "") return escapeVttText(line.translation ?? "");
  if (line.syllables?.some((s) => s.time !== null)) {
    const startUnit = Math.round(cueStart * 1000);
    
    let lastUnit = startUnit;
    let sawTimed = false;
    let out = "";
    for (const syllable of line.syllables) {
      if (syllable.time !== null) {
        const syllableTime = syllable.time;
        if (!Number.isFinite(syllableTime) || syllableTime < cueStart || syllableTime >= cueEnd) {
          throw new VttInvalidSyllableTimeError();
        }
        const unit = Math.round(syllableTime * 1000);
        // WebVTT cannot contain an inline timestamp equal to the cue start.
        // Its timing is already implicit, even when untimed text precedes it.
        const implicitCueStart = unit === startUnit && !sawTimed;
        // Validate: timestamps must be within cue boundaries (>= cueStart, < cueEnd)
        // and strictly increasing for subsequent timestamps
        if (unit < Math.round(cueStart * 1000) || unit >= Math.round(cueEnd * 1000) ||
            (sawTimed && unit <= lastUnit) || (unit === Math.round(cueStart * 1000) && !implicitCueStart)) {
          throw new VttInvalidSyllableTimeError();
        }
        if (!implicitCueStart) out += `<${vttTime(syllableTime)}>`;
        lastUnit = unit;
        sawTimed = true;
      }
      out += escapeVttText(syllable.text);
    }
    return out;
  }
  return escapeVttText(line.text);
}

export function serializeVtt(doc: LrcDocument, lastCueEnd?: number): string {
  const cues = buildCues(doc, lastCueEnd);
  const body = cues
    .map((c) => {
      const text = c.line.text.trim() ? `${c.line.text}${c.line.translation ? `\n${c.line.translation}` : ""}` : c.line.translation ?? "";
      assertVttBodyRepresentable(text);
      return `${vttTime(c.start)} --> ${vttTime(c.end)}\n${vttText(c.line, c.start, c.end)}${c.line.text.trim() && c.line.translation ? `\n${escapeVttText(c.line.translation)}` : ""}`;
    })
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

// ASS 시간: H:MM:SS.cc (센티초)
function assTime(seconds: number): string {
  // Clamp negative timestamps to 0 (ASS doesn't support negative times)
  const clampedSeconds = Math.max(0, seconds);
  const cs = Math.max(0, Math.round(clampedSeconds * 100));
  if (!Number.isSafeInteger(cs)) throw new SubtitleTimestampUnrepresentableError();
  return `${Math.floor(cs / 360000)}:${p2(Math.floor(cs / 6000) % 60)}:${p2(Math.floor(cs / 100) % 60)}.${p2(cs % 100)}`;
}

// Timed glyphs use ASS karaoke tags with centisecond durations.
function assertAssTextLiteral(text: string): void {
  if (/[{}]|\\[Nnh]/.test(text)) throw new AssUnrepresentableContentError();
}

function escapeAssText(text: string): string {
  assertAssTextLiteral(text);
  return text.replace(/\r\n|\r|\n/g, "\\N");
}

function assText(line: LrcLine, cueStart: number, cueEnd: number): string {
  if (line.text.trim() === "") return escapeAssText(line.translation ?? "");
  const syl = line.syllables;
  if (syl?.some((s) => s.time !== null)) {
    // Generated karaoke tags separate literal runs. Validate each contiguous
    // run as a whole so a forbidden ASS escape cannot be assembled across
    // adjacent glyph tokens that each look safe in isolation.
    let literalRun = "";
    for (const syllable of syl) {
      if (syllable.time !== null) {
        assertAssTextLiteral(literalRun);
        literalRun = syllable.text;
      } else {
        literalRun += syllable.text;
      }
    }
    assertAssTextLiteral(literalRun);

    let out = "";
    const firstTimed = syl.find((syllable) => syllable.time !== null);
    if (firstTimed?.time !== null && firstTimed) {
      const delay = Math.round((firstTimed.time as number) * 100) - Math.round(cueStart * 100);
      if (delay > 0) out += `{\\k${delay}}`;
    }
    for (let i = 0; i < syl.length; i++) {
      const s = syl[i];
      if (s.time === null) { out += escapeAssText(s.text); continue; }
      let nextT = cueEnd;
      for (let j = i + 1; j < syl.length; j++) {
        if (syl[j].time !== null) { nextT = syl[j].time as number; break; }
      }
      const startCs = Math.round((s.time as number) * 100);
      const endCs = Math.round(nextT * 100);
      const durCs = Math.max(0, endCs - startCs);
      out += `{\\k${durCs}}${escapeAssText(s.text)}`;
    }
    return out;
  }
  return escapeAssText(line.text);
}

export function serializeAss(doc: LrcDocument, lastCueEnd?: number): string {
  const title = doc.metadata.title || "Lyrical Sync";
  if (/[\r\n]/.test(title)) throw new AssUnrepresentableContentError();
  const cues = buildCues(doc, lastCueEnd, 100);
  for (const cue of cues) {
    let previous = cue.start;
    const cueEndCentiseconds = Math.round(cue.end * 100);
    for (const syllable of cue.line.syllables ?? []) {
      if (syllable.time === null) continue;
      const syllableCentiseconds = Math.round(syllable.time * 100);
      if (!Number.isFinite(syllable.time) || syllableCentiseconds < Math.round(previous * 100) ||
          syllableCentiseconds > cueEndCentiseconds) {
        throw new AssUnrepresentableContentError();
      }
      previous = syllable.time;
    }
  }
  const header =
`[Script Info]
Title: ${title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H00E8A33D,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,2,2,80,80,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = cues
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.line, c.start, c.end)}${c.line.text.trim() && c.line.translation ? `\\N${escapeAssText(c.line.translation)}` : ""}`)
    .join("\n");
  return header + events + "\n";
}
