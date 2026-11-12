import type { LrcDocument } from "../types/lrc";
import { isRecord, isFiniteNumber, isNullableString } from "./storage";
const KEY = "lyrical-sync-recovery";
const SESSION_KEY_PREFIX = `${KEY}:session:`;
const sessionKey = (sessionId: string) => `${SESSION_KEY_PREFIX}${encodeURIComponent(sessionId)}`;
export interface RecoverySnapshot {
  doc: LrcDocument;
  lrcPath: string | null;
  audioPath: string | null;
  lrcBookmark: string | null;
  audioBookmark: string | null;
  savedAt: number;
  sessionId?: string;
}

function validSyllables(value: unknown, lineText: string): boolean {
  if (!Array.isArray(value)) return false;
  let combinedText = "";
  for (const token of value) {
    if (!isRecord(token) || typeof token.text !== "string" || (token.time !== null && !isFiniteNumber(token.time))) return false;
    combinedText += token.text;
  }
  return combinedText === lineText;
}

function validDocument(value: unknown): value is LrcDocument {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.extraTags) || !Array.isArray(value.lines)) return false;
  const metadata = value.metadata;
  if (!["title", "artist", "album", "by"].every((key) => typeof metadata[key] === "string") || !isFiniteNumber(metadata.offset)) return false;
  if (!Object.values(value.extraTags).every((tag) => typeof tag === "string")) return false;
  if (value.metadataTagSequence !== undefined && (!Array.isArray(value.metadataTagSequence) || value.metadataTagSequence.some((entry: unknown) =>
    !isRecord(entry) || typeof entry.key !== "string" || typeof entry.value !== "string"
  ))) return false;
  return value.lines.every((line: unknown) => isRecord(line) && typeof line.id === "string" && typeof line.text === "string" &&
    (line.timestamp === null || isFiniteNumber(line.timestamp)) &&
    (line.srtEndTime === undefined || (line.timestamp !== null && isFiniteNumber(line.srtEndTime) && line.srtEndTime > line.timestamp)) &&
    (line.translation === undefined || typeof line.translation === "string") &&
    (line.syllables === undefined || validSyllables(line.syllables, line.text)));
}

export function saveRecoverySnapshot(doc: LrcDocument, lrcPath: string | null, audioPath: string | null,
  lrcBookmark: string | null = null, audioBookmark: string | null = null, sessionId?: string): boolean {
  try {
    if (!validDocument(doc)) return false;
    const storageKey = sessionId ? sessionKey(sessionId) : KEY;
    localStorage.setItem(storageKey, JSON.stringify({ doc, lrcPath, audioPath, lrcBookmark, audioBookmark, savedAt: Date.now(), sessionId }));
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

export function loadRecoverySnapshot(sessionId?: string): RecoverySnapshot | null {
  try {
    const snapshots: RecoverySnapshot[] = [];
    const add = (raw: string | null) => {
      if (!raw) return;
      const snapshot = parseSnapshot(raw);
      if (snapshot && (!sessionId || snapshot.sessionId === sessionId)) snapshots.push(snapshot);
    };
    add(sessionId ? localStorage.getItem(sessionKey(sessionId)) : localStorage.getItem(KEY));
    if (!sessionId) {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(SESSION_KEY_PREFIX)) add(localStorage.getItem(key));
      }
    }
    return snapshots.reduce<RecoverySnapshot | null>((latest, snapshot) =>
      !latest || snapshot.savedAt >= latest.savedAt ? snapshot : latest, null);
  } catch { return null; }
}

export function clearRecoverySnapshot(expected?: RecoverySnapshot): boolean {
  try {
    if (expected) {
      const key = expected.sessionId ? sessionKey(expected.sessionId) : KEY;
      const raw = localStorage.getItem(key);
      if (!raw || JSON.stringify(parseSnapshot(raw)) !== JSON.stringify(expected)) return true;
      localStorage.removeItem(key);
      return true;
    }
    const keys = [KEY];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(SESSION_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    return true;
  } catch { return false; }
}
