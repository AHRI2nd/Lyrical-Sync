import type { LrcDocument } from "../types/lrc";

// 미저장 작업 자동 복구: 작업 중 문서를 주기적으로 localStorage에 스냅샷하고,
// 재시작 시 남아 있으면 복구를 제안한다. 저장 경로(lrcPath)가 없어도 보호된다.
const KEY = "lyrical-sync-recovery";

export interface RecoverySnapshot {
  doc: LrcDocument;
  lrcPath: string | null;
  audioPath: string | null;
  savedAt: number;
}

export function saveRecoverySnapshot(doc: LrcDocument, lrcPath: string | null, audioPath: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ doc, lrcPath, audioPath, savedAt: Date.now() }));
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
