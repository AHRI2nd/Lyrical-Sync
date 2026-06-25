// 사용자 재설정 가능한 전역 단축키. Cmd/Ctrl 조합(실행취소/찾기)·Escape 등은
// 시스템 예약으로 두고, 단일 키(수식자 없음)만 바인딩 대상으로 한다.

export type KeyAction =
  | "skipBack5" | "skipBack1" | "playPause" | "skipFwd1" | "skipFwd5" | "stop"
  | "stamp" | "prevLine";

export const KEY_ACTIONS: KeyAction[] = [
  "skipBack5", "skipBack1", "playPause", "skipFwd1", "skipFwd5", "stop", "stamp", "prevLine",
];

// 재생 트랜스포트 동작(줄/글자 모드 공통, 입력창 외에서 동작)
export const PLAYBACK_ACTIONS: KeyAction[] = [
  "skipBack5", "skipBack1", "playPause", "skipFwd1", "skipFwd5", "stop",
];

export const DEFAULT_KEYBINDINGS: Record<KeyAction, string> = {
  skipBack5: "Digit1",
  skipBack1: "Digit2",
  playPause: "Digit3",
  skipFwd1: "Digit4",
  skipFwd5: "Digit5",
  stop: "Digit6",
  stamp: "Space",
  prevLine: "Backspace",
};

// 바인딩 불가(시스템 예약) 키
export const RESERVED_CODES = new Set(["Escape", "Tab"]);

// 넘패드 숫자를 일반 숫자와 동일 취급(기존 동작 유지)
function normalizeCode(code: string): string {
  const m = /^Numpad(\d)$/.exec(code);
  return m ? `Digit${m[1]}` : code;
}

// 저장된 바인딩을 기본값으로 보정(키 누락 방지)
export function normalizeKeybindings(kb?: Partial<Record<KeyAction, string>>): Record<KeyAction, string> {
  const out = { ...DEFAULT_KEYBINDINGS };
  if (kb) for (const a of KEY_ACTIONS) if (kb[a]) out[a] = kb[a] as string;
  return out;
}

// 키 코드가 어느 동작인지(없으면 null). 넘패드 정규화 적용.
export function matchAction(code: string, kb: Record<KeyAction, string>): KeyAction | null {
  const c = normalizeCode(code);
  for (const a of KEY_ACTIONS) {
    if (normalizeCode(kb[a]) === c) return a;
  }
  return null;
}

// 같은 코드를 이미 다른 동작이 쓰고 있으면 그 동작을 반환(충돌). 자기 자신은 제외.
export function conflictingAction(
  code: string,
  action: KeyAction,
  kb: Record<KeyAction, string>,
): KeyAction | null {
  const c = normalizeCode(code);
  for (const a of KEY_ACTIONS) {
    if (a !== action && normalizeCode(kb[a]) === c) return a;
  }
  return null;
}

// 표시용 라벨
export function keyLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code === "Backspace") return "⌫";
  if (code === "Enter") return "Enter";
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `№${numpad[1]}`;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const fkey = /^(F\d{1,2})$/.exec(code);
  if (fkey) return fkey[1];
  const arrows: Record<string, string> = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  };
  if (arrows[code]) return arrows[code];
  const sym: Record<string, string> = {
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
  };
  if (sym[code]) return sym[code];
  return code;
}
