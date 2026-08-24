import { LrcDocument, LrcLine } from "../types/lrc";

// 타임스탬프 있는 줄을 자막 cue로 변환. 빈 줄(text:"")은 직전 cue의 종료 경계로만 사용.
// (srtConverter와 동일한 규칙 — start=줄 시각, end=다음 시각 줄/총 길이/+4초)
interface Cue { start: number; end: number; line: LrcLine; }

function buildCues(doc: LrcDocument, lastCueEnd?: number): Cue[] {
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const cues: Cue[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "") continue; // 빈 줄 = 경계 전용
    const start = line.timestamp as number;
    const next = timed[i + 1];
    let end: number;
    if (next) end = next.timestamp as number;
    else if (lastCueEnd !== undefined && lastCueEnd > start) end = lastCueEnd;
    else end = start + 4;
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

// 글자/단어 동기화가 있으면 VTT 인라인 타임스탬프(<HH:MM:SS.mmm>)로 카라오케 표현.
// 번역 줄이 있으면 WebVTT가 기본 지원하는 개행으로 본문 아래에 덧붙임.
function vttText(line: LrcLine): string {
  const main = line.syllables?.some((s) => s.time !== null)
    ? line.syllables
        .map((s) => (s.time !== null ? `<${vttTime(s.time)}>` : "") + s.text)
        .join("")
    : line.text;
  return line.translation ? `${main}\n${line.translation}` : main;
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

// ASS 텍스트: 글자 동기화가 있으면 \k(센티초 지속) 카라오케 태그로.
// 번역 줄이 있으면 ASS의 줄바꿈 태그 \N으로 본문 아래에 덧붙임.
function assText(line: LrcLine, cueEnd: number): string {
  const syl = line.syllables;
  let main: string;
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
    main = out;
  } else {
    main = line.text;
  }
  return line.translation ? `${main}\\N${line.translation}` : main;
}

export function serializeAss(doc: LrcDocument, lastCueEnd?: number): string {
  const cues = buildCues(doc, lastCueEnd);
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
