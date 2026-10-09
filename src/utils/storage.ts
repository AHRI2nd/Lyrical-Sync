import type { PersistStorage } from "zustand/middleware";
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const isNullableString = (value: unknown) => value === null || typeof value === "string";

// Resolve storage at operation time; unavailable storage must not block editing.
export function createSafeJSONStorage<S>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      try {
        const raw = globalThis.localStorage.getItem(name);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || !isRecord(parsed.state)) return null;
        return { state: parsed.state as S, version: isFiniteNumber(parsed.version) ? parsed.version : 0 };
      } catch { return null; }
    },
    setItem: (name, value) => { try { globalThis.localStorage.setItem(name, JSON.stringify(value)); } catch { /* Keep in-memory settings usable. */ } },
    removeItem: (name) => { try { globalThis.localStorage.removeItem(name); } catch { /* Storage may be unavailable. */ } },
  };
}
