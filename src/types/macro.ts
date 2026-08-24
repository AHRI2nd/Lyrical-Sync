// 매크로 레코더: 새 스크립트 언어/샌드박스 없이, 기존 useLrcStore 액션 호출을
// 기록해뒀다가 재생하는 방식. id 기반 액션(deleteLine 등)은 기록 당시 id가 재생
// 시점엔 다른 줄을 가리키거나 존재하지 않을 수 있어 제외 — 아래 6개만 허용목록.
// 선택 범위 기반 액션(shiftLines/clearTimestamps/deleteLines)은 id 자체를 기록하지
// 않고, 재생 시점의 현재 선택(비어있으면 전체)으로 매번 새로 해석한다.
export type MacroStep =
  | { action: "scaleTimestamps"; params: { factor: number } }
  | { action: "applyOffset"; params: Record<string, never> }
  | { action: "replaceAll"; params: { find: string; replace: string; caseSensitive: boolean } }
  | { action: "shiftLines"; params: { delta: number } }
  | { action: "clearTimestamps"; params: Record<string, never> }
  | { action: "deleteLines"; params: Record<string, never> };

export type RecordableAction = MacroStep["action"];

export interface SavedMacro {
  id: string;
  name: string;
  steps: MacroStep[];
  createdAt: number;
}
