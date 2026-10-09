import { LrcDocument, LrcLine } from "../types/lrc";

// Blank timed lines mark cue ends without becoming subtitles themselves.
// SRT, VTT and ASS share strictly later boundaries, valid duration, or a four-second fallback.
interface Cue { start: number; end: number; line: LrcLine; }

// Compare boundaries at the output format precision so rounding cannot create an empty cue.
export function nextCueEnd(timed: readonly LrcLine[], index: number, start: number, lastCueEnd?: number, timeUnitsPerSecond = 1000): number {
  const startUnit = Math.max(0, Math.round(start * timeUnitsPerSecond));
  const isLater = (time: number) => Number.isFinite(time) && Math.round(time * timeUnitsPerSecond) > startUnit;
  for (let i = index + 1; i < timed.length; i++) {
    const next = timed[i].timestamp;
    if (next !== null && isLater(next)) return next;
  }
  if (lastCueEnd !== undefined && isLater(lastCueEnd)) return lastCueEnd;
  return start + 4;
}

function buildCues(doc: LrcDocument, lastCueEnd?: number, timeUnitsPerSecond = 1000): Cue[] {
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const cues: Cue[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "") continue; // 빈 줄 = 경계 전용
    const start = line.timestamp as number;
    const end = nextCueEnd(timed, i, start, lastCueEnd, timeUnitsPerSecond);
    cues.push({ start, end, line });
  }
  return cues;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const p3 = (n: number) => String(n).padStart(3, "0");

// WebVTT 시간: HH:MM:SS.mmm
function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)}.${p3(ms % 1000)}`;
}

// 글자/단어 동기화가 있으면 VTT 인라인 타임스탬프(<HH:MM:SS.mmm>)로 카라오케 표현
function vttText(line: LrcLine): string {
  if (line.syllables?.some((s) => s.time !== null)) {
    return line.syllables
      .map((s) => (s.time !== null ? `<${vttTime(s.time)}>` : "") + s.text)
      .join("");
  }
  return line.text;
}

export function serializeVtt(doc: LrcDocument, lastCueEnd?: number): string {
  const cues = buildCues(doc, lastCueEnd);
  const body = cues
    .map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${vttText(c.line)}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

// ASS 시간: H:MM:SS.cc (센티초)
function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${p2(Math.floor(cs / 6000) % 60)}:${p2(Math.floor(cs / 100) % 60)}.${p2(cs % 100)}`;
}

// ASS 텍스트: 글자 동기화가 있으면 \k(센티초 지속) 카라오케 태그로
function assText(line: LrcLine, cueEnd: number): string {
  const syl = line.syllables;
  if (syl?.some((s) => s.time !== null)) {
    let out = "";
    for (let i = 0; i < syl.length; i++) {
      const s = syl[i];
      if (s.time === null) { out += s.text; continue; }
      let nextT = cueEnd;
      for (let j = i + 1; j < syl.length; j++) {
        if (syl[j].time !== null) { nextT = syl[j].time as number; break; }
      }
      const durCs = Math.max(0, Math.round((nextT - (s.time as number)) * 100));
      out += `{\\k${durCs}}${s.text}`;
    }
    return out;
  }
  return line.text;
}

export function serializeAss(doc: LrcDocument, lastCueEnd?: number): string {
  const cues = buildCues(doc, lastCueEnd, 100);
  const title = doc.metadata.title || "Lyrical Sync";
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
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.line, c.end)}`)
    .join("\n");
  return header + events + "\n";
}
