import type { LrcDocument } from "../types/lrc";

// 미저장 작업 자동 복구: 작업 중 문서를 주기적으로 localStorage에 스냅샷하고,
// 재시작 시 남아 있으면 복구를 제안한다. 저장 경로(lrcPath)가 없어도 보호된다.
const KEY = "lyrical-sync-recovery";

export interface RecoverySnapshot {
  doc: LrcDocument;
  lrcPath: string | null;
  audioPath: string | null;
  // App Sandbox 보안 스코프 북마크(base64) — 재시작 후 lrcPath/audioPath 접근 권한 복원용.
  // 없으면(null) 구버전 스냅샷이거나 북마크 생성 실패 — 원래 경로로 best-effort 시도.
  lrcBookmark: string | null;
  audioBookmark: string | null;
  savedAt: number;
}

export function saveRecoverySnapshot(
  doc: LrcDocument,
  lrcPath: string | null,
  audioPath: string | null,
  lrcBookmark: string | null = null,
  audioBookmark: string | null = null
): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ doc, lrcPath, audioPath, lrcBookmark, audioBookmark, savedAt: Date.now() })
    );
  } catch {
    // 용량 초과 등 — 복구는 best-effort
  }
}

export function loadRecoverySnapshot(): RecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.doc && Array.isArray(s.doc.lines)) return s as RecoverySnapshot;
    return null;
  } catch {
    return null;
  }
}

export function clearRecoverySnapshot(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
