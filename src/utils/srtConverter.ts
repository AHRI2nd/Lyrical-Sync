import { LrcDocument, defaultDocument } from "../types/lrc";
import { nextCueEnd } from "./exportFormats";

// SubRip 시간 형식: HH:MM:SS,mmm
function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
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
const SRT_TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function parseSrtTime(str: string): number | null {
  const m = SRT_TIME_RE.exec(str.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) / 1000;
  return h * 3600 + min * 60 + s + frac;
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

  const cues: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "") continue; // 빈 줄 = 경계 전용
    const start = line.timestamp as number;
    const end = nextCueEnd(timed, i, start, lastCueEnd);
    cues.push({ start, end, text: line.text });
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
 * Import cue starts and join multiline bodies with spaces. Intermediate gaps become
 * blank timed boundaries. Original overlaps and final cue ends are not stored.
 */
export function parseSrt(raw: string): LrcDocument {
  const doc = defaultDocument();
  let lineId = 0;

  // CRLF 정규화 후 빈 줄 기준으로 블록 분할
  const blocks = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\s*\n/);

  // 1) cue(start, end, text) 수집
  const cues: { start: number; end: number; text: string }[] = [];
  for (const block of blocks) {
    const rows = block.split("\n").map((r) => r.trim()).filter((r) => r !== "");
    if (rows.length === 0) continue;

    // 시간 줄(--> 포함)을 찾음. 그 앞은 인덱스 번호(있으면), 그 뒤는 본문.
    const arrowIdx = rows.findIndex((r) => r.includes("-->"));
    if (arrowIdx === -1) continue;

    const [startStr, endStr] = rows[arrowIdx].split("-->");
    const start = parseSrtTime(startStr);
    if (start === null) continue;
    const end = parseSrtTime(endStr ?? "");

    const text = rows.slice(arrowIdx + 1).join(" ").trim();
    cues.push({ start, end: end ?? start, text });
  }

  cues.sort((a, b) => a.start - b.start);

  // 2) cue → 가사 줄 + 가사 사이 갭에 빈 줄(경계) 삽입
  const cs = (s: number) => Math.round(s * 100); // 센티초(LRC 정밀도) 기준 비교
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    doc.lines.push({ id: String(lineId++), timestamp: cue.start, text: cue.text });

    // 다음 cue가 있고, 종료 시각이 현재 시작보다 뒤·다음 시작보다 앞이면(갭 존재) 빈 줄 삽입
    const next = cues[i + 1];
    if (next && cs(cue.end) > cs(cue.start) && cs(cue.end) < cs(next.start)) {
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
