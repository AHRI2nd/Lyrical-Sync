import type { LrcDocument } from "../types/lrc";
import { isRecord, isFiniteNumber, isNullableString } from "./storage";
const KEY = "lyrical-sync-recovery";
export interface RecoverySnapshot {
  doc: LrcDocument;
  lrcPath: string | null;
  audioPath: string | null;
  lrcBookmark: string | null;
  audioBookmark: string | null;
  savedAt: number;
  sessionId?: string;
}

function validDocument(value: unknown): value is LrcDocument {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.extraTags) || !Array.isArray(value.lines)) return false;
  const metadata = value.metadata;
  if (!["title", "artist", "album", "by"].every((key) => typeof metadata[key] === "string") || !isFiniteNumber(metadata.offset)) return false;
  if (!Object.values(value.extraTags).every((tag) => typeof tag === "string")) return false;
  return value.lines.every((line: unknown) => isRecord(line) && typeof line.id === "string" && typeof line.text === "string" &&
    (line.timestamp === null || isFiniteNumber(line.timestamp)) &&
    (line.syllables === undefined || (Array.isArray(line.syllables) && line.syllables.every((token: unknown) =>
      isRecord(token) && typeof token.text === "string" && (token.time === null || isFiniteNumber(token.time))))));
}

export function saveRecoverySnapshot(doc: LrcDocument, lrcPath: string | null, audioPath: string | null,
  lrcBookmark: string | null = null, audioBookmark: string | null = null, sessionId?: string): boolean {
  try {
    if (!validDocument(doc)) return false;
    localStorage.setItem(KEY, JSON.stringify({ doc, lrcPath, audioPath, lrcBookmark, audioBookmark, savedAt: Date.now(), sessionId }));
    return true;
  } catch { return false; }
}

function parseSnapshot(raw: string): RecoverySnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !validDocument(value.doc) || !isFiniteNumber(value.savedAt) ||
        !isNullableString(value.lrcPath) || !isNullableString(value.audioPath) ||
        (value.lrcBookmark !== undefined && !isNullableString(value.lrcBookmark)) ||
        (value.audioBookmark !== undefined && !isNullableString(value.audioBookmark)) ||
        (value.sessionId !== undefined && typeof value.sessionId !== "string")) return null;
    return { doc: value.doc, lrcPath: value.lrcPath as string | null, audioPath: value.audioPath as string | null,
      lrcBookmark: (value.lrcBookmark ?? null) as string | null, audioBookmark: (value.audioBookmark ?? null) as string | null,
      savedAt: value.savedAt, ...(value.sessionId !== undefined ? { sessionId: value.sessionId as string } : {}) };
  } catch { return null; }
}

export function loadRecoverySnapshot(): RecoverySnapshot | null {
  try { const raw = localStorage.getItem(KEY); return raw ? parseSnapshot(raw) : null; }
  catch { return null; }
}

export function clearRecoverySnapshot(expected?: RecoverySnapshot): boolean {
  try {
    if (expected) {
      const raw = localStorage.getItem(KEY);
      if (!raw || JSON.stringify(parseSnapshot(raw)) !== JSON.stringify(expected)) return true;
    }
    localStorage.removeItem(KEY);
    return true;
  } catch { return false; }
}
