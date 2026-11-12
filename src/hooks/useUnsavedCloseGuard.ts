import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useUnsavedCloseGuard(isDirty: () => boolean, onRequest: () => void): void {
  const dirtyRef = useRef(isDirty);
  const onRequestRef = useRef(onRequest);
  dirtyRef.current = isDirty;
  onRequestRef.current = onRequest;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWindow().onCloseRequested((event) => {
        if (!dirtyRef.current()) return;
        event.preventDefault();
        onRequestRef.current();
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => {});
    } catch {
      // App can also render in a plain browser where Tauri window APIs are absent.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
