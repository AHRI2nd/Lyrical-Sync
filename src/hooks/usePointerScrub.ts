import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Scrub = { id: number; context: string; start: number; end: number; left: number; width: number; element: HTMLElement };
export function usePointerScrub({ contextKey, start, end, onCommit, enabled = true }: {
  contextKey: string; start: number; end: number; onCommit: (seconds: number) => void; enabled?: boolean;
}) {
  const pointer = useRef<Scrub | null>(null);
  const latest = useRef({ contextKey, onCommit, enabled });
  latest.current = { contextKey, onCommit, enabled };
  const [preview, setPreview] = useState<{ position: number; start: number; end: number; context: string } | null>(null);
  const release = (active: Scrub) => {
    try { if (active.element.hasPointerCapture?.(active.id)) active.element.releasePointerCapture(active.id); } catch { /* Capture may already have been lost. */ }
  };
  const cancel = useCallback(() => {
    const active = pointer.current; pointer.current = null;
    if (active) release(active);
    setPreview(null);
  }, []);
  useEffect(() => { cancel(); }, [contextKey, enabled, cancel]);
  useEffect(() => {
    const positionAt = (active: Scrub, x: number) => active.start + Math.max(0, Math.min(1, (x - active.left) / active.width)) * (active.end - active.start);
    const matches = (e: PointerEvent) => pointer.current?.id === e.pointerId;
    const move = (e: PointerEvent) => {
      const active = pointer.current;
      if (!active || !matches(e) || !Number.isFinite(e.clientX)) return;
      if (active.context !== latest.current.contextKey || !latest.current.enabled) { cancel(); return; }
      setPreview({ position: positionAt(active, e.clientX), start: active.start, end: active.end, context: active.context });
    };
    const up = (e: PointerEvent) => {
      const active = pointer.current;
      if (!active || !matches(e)) return;
      const valid = active.context === latest.current.contextKey && latest.current.enabled;
      const position = positionAt(active, e.clientX);
      cancel();
      if (valid && Number.isFinite(position)) latest.current.onCommit(position);
    };
    const aborted = (e: PointerEvent) => { if (matches(e)) cancel(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", aborted);
    window.addEventListener("lostpointercapture", aborted);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", aborted); window.removeEventListener("lostpointercapture", aborted);
      window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel);
      const active = pointer.current; pointer.current = null;
      if (active) release(active);
    };
  }, [cancel]);
  const begin = (e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || pointer.current || e.button !== 0 || e.isPrimary === false || e.defaultPrevented ||
        (e.target instanceof Element && e.target.closest("button,input,[role='button'],[data-scrub-ignore]"))) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || !Number.isFinite(e.clientX) || rect.width <= 0) return;
    e.preventDefault();
    const active = { id: e.pointerId, context: contextKey, start, end, left: rect.left, width: rect.width, element: e.currentTarget };
    pointer.current = active;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* Window listeners still track this pointer. */ }
    const position = start + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (end - start);
    setPreview({ position, start, end, context: contextKey });
  };
  const visible = preview?.context === contextKey && enabled ? preview : null;
  return { begin, cancel, preview: visible?.position ?? null, range: visible ? { start: visible.start, end: visible.end } : null };
}
