import { LrcDocument } from "./lrc";

// 스토어엔 로케일 문자열이 아닌 태그만 저장 — 표시 시 t.historyLabels[label]로 해석해
// 언어 전환 후에도 과거 히스토리 라벨이 깨지지 않게 함.
export type HistoryLabel =
  | "commitSyllables"
  | "clearSyllables"
  | "stampLine"
  | "setLines"
  | "addLine"
  | "insertLines"
  | "addLinesFromSpeech"
  | "deleteLine"
  | "duplicateLine"
  | "mergeLine"
  | "splitLine"
  | "moveLine"
  | "scaleTimestamps"
  | "deleteLines"
  | "shiftLines"
  | "clearTimestamps"
  | "loadDoc"
  | "applyOffset"
  | "shiftTimeRange"
  | "replaceAll"
  | "aiSync"
  | "snapBeatGrid"
  | "editText"
  | "editMetadata";

export interface HistoryEntry {
  doc: LrcDocument;
  timestamp: number;
  label: HistoryLabel;
  /** replaceAll처럼 개수가 의미 있는 라벨에서만 사용 */
  count?: number;
}
