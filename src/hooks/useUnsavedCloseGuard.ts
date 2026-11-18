import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useUnsavedCloseGuard(
  isDirty: () => boolean,
  onRequest: () => void,
  onCloseError: () => void,
): () => Promise<boolean> {
  const dirtyRef = useRef(isDirty);
  const onRequestRef = useRef(onRequest);
  const onCloseErrorRef = useRef(onCloseError);
  const unlistenRef = useRef<(() => void) | undefined>(undefined);
  const registrationRef = useRef<Promise<void>>(Promise.resolve());
  const disposedRef = useRef(true);
  const closingRef = useRef(false);
  dirtyRef.current = isDirty;
  onRequestRef.current = onRequest;
  onCloseErrorRef.current = onCloseError;

  const closeWindow = useCallback(async () => {
    if (closingRef.current) return false;
    closingRef.current = true;
    await registrationRef.current;
    unlistenRef.current?.();
    unlistenRef.current = undefined;

    try {
      await getCurrentWindow().close();
      return true;
    } catch {
      if (!disposedRef.current) {
        try {
          const stop = await getCurrentWindow().onCloseRequested(handleCloseRequested);
          if (disposedRef.current) stop();
          else unlistenRef.current = stop;
        } catch {
          // Keep the original close failure as the user-visible error.
        }
      }
      onCloseErrorRef.current();
      return false;
    } finally {
      closingRef.current = false;
    }
  }, []);

  function handleCloseRequested(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (dirtyRef.current()) onRequestRef.current();
    else void closeWindow();
  }

  useEffect(() => {
    let disposed = false;
    disposedRef.current = false;
    try {
      registrationRef.current = getCurrentWindow().onCloseRequested(handleCloseRequested).then((stop) => {
        if (disposed) stop();
        else unlistenRef.current = stop;
      }).catch(() => {});
    } catch {
      // App can also render in a plain browser where Tauri window APIs are absent.
    }
    return () => {
      disposed = true;
      disposedRef.current = true;
      unlistenRef.current?.();
      unlistenRef.current = undefined;
    };
  }, []);

  return closeWindow;
}
