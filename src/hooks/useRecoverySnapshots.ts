import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../stores/useLrcStore";
import { clearRecoverySnapshot, loadRecoverySnapshot, saveRecoverySnapshot, type RecoverySnapshot } from "../utils/recovery";

export function useRecoverySnapshots(pendingRecovery: boolean): boolean {
  const session = useLrcStore((state) => state._documentSession);
  const dirty = useLrcStore((state) => state.isDirty);
  const prefix = useRef(crypto.randomUUID());
  const owned = useRef<RecoverySnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (pendingRecovery) return;
    if (!dirty) {
      if (!owned.current) setFailed(false);
      const clear = () => {
        if (!owned.current) return;
        const ok = clearRecoverySnapshot(owned.current);
        setFailed(!ok);
        if (ok) owned.current = null;
      };
      clear();
      if (owned.current) {
        const interval = setInterval(clear, 5000);
        return () => clearInterval(interval);
      }
      return;
    }
    const flush = () => {
      const state = useLrcStore.getState();
      if (!state.isDirty || state._documentSession !== session) return;
      const ok = saveRecoverySnapshot(state.doc, state.lrcPath, state.audioPath, state.lrcBookmark, state.audioBookmark, `${prefix.current}:${session}`);
      if (ok) {
        const snapshot = loadRecoverySnapshot();
        if (snapshot?.sessionId === `${prefix.current}:${session}`) owned.current = snapshot;
        setFailed(!snapshot);
      } else setFailed(true);
    };
    flush();
    const interval = setInterval(flush, 5000);
    return () => clearInterval(interval);
  }, [dirty, session, pendingRecovery]);
  return failed;
}
