import type { LrcDocument } from "../types/lrc";
import { isRecord, isFiniteNumber, isNullableString } from "./storage";
const KEY = "lyrical-sync-recovery";
const KEY_PREFIX = `${KEY}:`;
const RECOVERY_INSTANCE_ID = createRecoveryInstanceId();
export interface RecoverySnapshot {
  doc: LrcDocument;
  lrcPath: string | null;
  audioPath: string | null;
  lrcBookmark: string | null;
  audioBookmark: string | null;
  savedAt: number;
  sessionId?: string;
  documentSession?: number;
  editRevision?: number;
  lrcFileHash?: string | null;
  storageKey?: string;
}

function createRecoveryInstanceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* Use the fallback when Web Crypto is unavailable. */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function keyForSession(sessionId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(sessionId)}`;
}

function validDocument(value: unknown): value is LrcDocument {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.extraTags) || !Array.isArray(value.lines)) return false;
  const metadata = value.metadata;
  if (!["title", "artist", "album", "by"].every((key) => typeof metadata[key] === "string") || !isFiniteNumber(metadata.offset)) return false;
  if (!Object.values(value.extraTags).every((tag) => typeof tag === "string")) return false;
  if (value.invalidControlTags !== undefined && (!Array.isArray(value.invalidControlTags) || value.invalidControlTags.some((tag: unknown) =>
    !isRecord(tag) || typeof tag.key !== "string" || typeof tag.value !== "string"
  ))) return false;
  if (value.metadataTagSequence !== undefined && (!Array.isArray(value.metadataTagSequence) || value.metadataTagSequence.some((tag: unknown) =>
    !isRecord(tag) || typeof tag.key !== "string" || typeof tag.value !== "string"
  ))) return false;
  return value.lines.every((line: unknown) => isRecord(line) && typeof line.id === "string" && typeof line.text === "string" &&
    (line.timestamp === null || isFiniteNumber(line.timestamp)) &&
    (line.translation === undefined || typeof line.translation === "string") &&
    (line.syllables === undefined || (Array.isArray(line.syllables) && line.syllables.every((token: unknown) =>
      isRecord(token) && typeof token.text === "string" && (token.time === null || isFiniteNumber(token.time))))));
}

export function saveRecoverySnapshot(doc: LrcDocument, lrcPath: string | null, audioPath: string | null,
  lrcBookmark: string | null = null, audioBookmark: string | null = null, sessionId = RECOVERY_INSTANCE_ID,
  documentSession?: number, editRevision?: number, lrcFileHash: string | null = null): boolean {
  try {
    if (!validDocument(doc) ||
        (lrcFileHash !== null && !/^[0-9a-f]{64}$/.test(lrcFileHash))) return false;
    const owner = sessionId || RECOVERY_INSTANCE_ID;
    const key = keyForSession(owner);
    localStorage.setItem(key, JSON.stringify({ doc, lrcPath, audioPath, lrcBookmark, audioBookmark, lrcFileHash, savedAt: Date.now(), sessionId: owner, documentSession, editRevision }));
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
        (value.lrcFileHash !== undefined && value.lrcFileHash !== null &&
          (typeof value.lrcFileHash !== "string" || !/^[0-9a-f]{64}$/.test(value.lrcFileHash))) ||
        (value.sessionId !== undefined && typeof value.sessionId !== "string") ||
        (value.documentSession !== undefined && !isFiniteNumber(value.documentSession)) ||
        (value.editRevision !== undefined && !isFiniteNumber(value.editRevision))) return null;
    return { doc: value.doc, lrcPath: value.lrcPath as string | null, audioPath: value.audioPath as string | null,
      lrcBookmark: (value.lrcBookmark ?? null) as string | null, audioBookmark: (value.audioBookmark ?? null) as string | null,
      lrcFileHash: (value.lrcFileHash ?? null) as string | null,
      savedAt: value.savedAt, ...(value.sessionId !== undefined ? { sessionId: value.sessionId as string } : {}),
      ...(value.documentSession !== undefined ? { documentSession: value.documentSession as number } : {}),
      ...(value.editRevision !== undefined ? { editRevision: value.editRevision as number } : {}) };
  } catch { return null; }
}

export function loadRecoverySnapshot(): RecoverySnapshot | null {
  try {
    const candidates: RecoverySnapshot[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || (key !== KEY && !key.startsWith(KEY_PREFIX))) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const snapshot = parseSnapshot(raw);
      if (snapshot) candidates.push({ ...snapshot, storageKey: key });
    }
    return candidates.reduce<RecoverySnapshot | null>((latest, candidate) =>
      !latest || candidate.savedAt >= latest.savedAt ? candidate : latest, null);
  }
  catch { return null; }
}

export function clearRecoverySnapshot(expected?: RecoverySnapshot): boolean {
  try {
    const key = expected?.storageKey ?? keyForSession(RECOVERY_INSTANCE_ID);
    if (expected) {
      const raw = localStorage.getItem(key);
      const current = raw ? parseSnapshot(raw) : null;
      if (!current || JSON.stringify({ ...current, storageKey: key }) !== JSON.stringify(expected)) return true;
    }
    localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

// Check if recovery snapshot belongs to current session
export function isRecoverySnapshotCurrent(snapshot: RecoverySnapshot, currentDocumentSession: number, currentEditRevision: number): boolean {
  return snapshot.documentSession === currentDocumentSession && snapshot.editRevision === currentEditRevision;
}
