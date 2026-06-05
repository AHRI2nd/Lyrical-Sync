import { LrcDocument, defaultDocument } from "../types/lrc";

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
 * LRC 문서를 SubRip(SRT) 문자열로 직렬화.
 * 각 자막의 종료 시간 = 다음(시간 있는) 줄의 시작 시간.
 * 빈 줄(text:"")은 자막으로 출력하지 않고 직전 자막의 종료 경계로만 사용됨.
 * 마지막 줄은 다음 줄이 없으므로 lastCueEnd(있으면) 또는 start + 4초로 종료.
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
    const next = timed[i + 1];
    let end: number;
    if (next) {
      end = next.timestamp as number;
    } else if (lastCueEnd !== undefined && lastCueEnd > start) {
      end = lastCueEnd;
    } else {
      end = start + 4;
    }
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
 * SubRip(SRT) 문자열을 LRC 문서로 파싱.
 * 각 자막 cue의 시작 시간만 LRC 타임스탬프로 변환하고 종료 시간은 버림.
 * cue 본문이 여러 줄이면 공백으로 합쳐 한 줄로 만듦.
 */
export function parseSrt(raw: string): LrcDocument {
  const doc = defaultDocument();
  let lineId = 0;

  // CRLF 정규화 후 빈 줄 기준으로 블록 분할
  const blocks = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\s*\n/);

  for (const block of blocks) {
    const rows = block.split("\n").map((r) => r.trim()).filter((r) => r !== "");
    if (rows.length === 0) continue;

    // 시간 줄(--> 포함)을 찾음. 그 앞은 인덱스 번호(있으면), 그 뒤는 본문.
    const arrowIdx = rows.findIndex((r) => r.includes("-->"));
    if (arrowIdx === -1) continue;

    const start = parseSrtTime(rows[arrowIdx].split("-->")[0]);
    if (start === null) continue;

    const text = rows.slice(arrowIdx + 1).join(" ").trim();
    doc.lines.push({ id: String(lineId++), timestamp: start, text });
  }

  doc.lines.sort((a, b) => {
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return a.timestamp - b.timestamp;
  });

  return doc;
}
