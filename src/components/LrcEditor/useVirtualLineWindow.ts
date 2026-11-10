import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LrcLine } from "../../types/lrc";
import {
  buildLineOffsets,
  getVirtualLineRange,
  includePinnedLineIndices,
  LINE_GAP,
  VIRTUAL_LINE_THRESHOLD,
} from "./virtualLineWindow";

interface ScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
  viewportWidth: number;
}

export function useVirtualLineWindow(
  lines: readonly LrcLine[],
  layoutKey: string,
  pinnedLineIds: readonly (string | null)[],
  pinnedIndex: number | null,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const lineMeasurementsRef = useRef(new WeakMap<LrcLine, number>());
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ scrollTop: 0, viewportHeight: 640, viewportWidth: 0 });
  const effectiveLayoutKey = `${layoutKey}:${metrics.viewportWidth}`;
  const appliedLayoutKeyRef = useRef(effectiveLayoutKey);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const linesById = useMemo(() => new Map(lines.map((line, index) => [line.id, { line, index }])), [lines]);
  const linesByIdRef = useRef(linesById);
  linesByIdRef.current = linesById;
  const isVirtualized = lines.length > VIRTUAL_LINE_THRESHOLD;
  const isVirtualizedRef = useRef(isVirtualized);
  isVirtualizedRef.current = isVirtualized;

  const rowOffsets = useMemo(() => {
    const canUseMeasurements = appliedLayoutKeyRef.current === effectiveLayoutKey;
    return buildLineOffsets(
      lines.length,
      (index) => canUseMeasurements ? lineMeasurementsRef.current.get(lines[index]) : undefined,
    );
  }, [lines, effectiveLayoutKey, measurementRevision]);

  const lineIndices = useMemo(() => {
    const indices = new Map<string, number>();
    for (let index = 0; index < lines.length; index += 1) indices.set(lines[index].id, index);
    return indices;
  }, [lines]);

  const updateMeasurement = useCallback((line: LrcLine | undefined, element: HTMLDivElement) => {
    if (!line) return;
    const height = element.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) return;
    const previous = lineMeasurementsRef.current.get(line);
    if (previous !== undefined && Math.abs(previous - height) < 0.5) return;
    lineMeasurementsRef.current.set(line, height);
    setMeasurementRevision((revision) => revision + 1);
  }, []);

  useLayoutEffect(() => {
    if (appliedLayoutKeyRef.current === effectiveLayoutKey) return;
    appliedLayoutKeyRef.current = effectiveLayoutKey;
    lineMeasurementsRef.current = new WeakMap<LrcLine, number>();
    for (const [id, element] of rowElementsRef.current) {
      updateMeasurement(linesByIdRef.current.get(id)?.line, element);
    }
    setMeasurementRevision((revision) => revision + 1);
  }, [effectiveLayoutKey, updateMeasurement]);

  const registerRow = useCallback((line: LrcLine, element: HTMLDivElement | null) => {
    const previous = rowElementsRef.current.get(line.id);
    if (!element) {
      if (previous) resizeObserverRef.current?.unobserve(previous);
      rowElementsRef.current.delete(line.id);
      return;
    }
    rowElementsRef.current.set(line.id, element);
    if (!isVirtualizedRef.current) return;
    resizeObserverRef.current?.observe(element);
    updateMeasurement(line, element);
  }, [updateMeasurement]);

  useEffect(() => {
    if (!isVirtualized) {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const syncMetrics = (height: number, width: number) => {
      setMetrics((previous) => previous.viewportHeight === height && previous.viewportWidth === width
        ? previous
        : { ...previous, viewportHeight: height || 640, viewportWidth: width });
    };
    const measureContainer = () => syncMetrics(container.clientHeight, container.clientWidth);
    measureContainer();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === container) {
            syncMetrics(entry.contentRect.height, entry.contentRect.width);
            continue;
          }
          const element = entry.target as HTMLDivElement;
          const record = linesByIdRef.current.get(element.dataset.lineId ?? "");
          updateMeasurement(record?.line, element);
        }
      });
    resizeObserverRef.current = observer;
    observer?.observe(container);
    for (const element of rowElementsRef.current.values()) observer?.observe(element);
    if (!observer) {
      window.addEventListener("resize", measureContainer);
      for (const [id, element] of rowElementsRef.current) {
        updateMeasurement(linesByIdRef.current.get(id)?.line, element);
      }
    }
    return () => {
      observer?.disconnect();
      if (resizeObserverRef.current === observer) resizeObserverRef.current = null;
      window.removeEventListener("resize", measureContainer);
    };
  }, [isVirtualized, updateMeasurement]);

  const visibleRange = isVirtualized
    ? getVirtualLineRange(rowOffsets, metrics.scrollTop, metrics.viewportHeight)
    : { start: 0, end: lines.length };
  const pinnedIndices = pinnedLineIds.map((id) => id ? lineIndices.get(id) ?? null : null);
  const indices = isVirtualized
    ? includePinnedLineIndices(visibleRange, lines.length, [...pinnedIndices, pinnedIndex])
    : Array.from({ length: lines.length }, (_, index) => index);

  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop;
    setMetrics((previous) => previous.scrollTop === scrollTop ? previous : { ...previous, scrollTop });
  }, []);

  const scrollToIndex = useCallback((index: number, align: "nearest" | "center" | "start" = "nearest") => {
    const container = containerRef.current;
    if (!container || index < 0 || index >= lines.length) return;
    const line = lines[index];
    const row = rowElementsRef.current.get(line.id);
    if (row && align !== "start") {
      row.scrollIntoView({ block: align });
      return;
    }
    const top = rowOffsets[index];
    const height = rowOffsets[index + 1] - top - LINE_GAP;
    const viewportHeight = container.clientHeight || metrics.viewportHeight;
    let nextTop = top;
    if (align === "center") nextTop -= Math.max(0, (viewportHeight - height) / 2);
    else if (align === "nearest" && top + height > container.scrollTop + viewportHeight) {
      nextTop = top + height - viewportHeight;
    } else if (align === "nearest" && top >= container.scrollTop) {
      return;
    }
    const maximum = Math.max(0, rowOffsets[lines.length] - viewportHeight);
    nextTop = Math.max(0, Math.min(nextTop, maximum));
    container.scrollTop = nextTop;
    setMetrics((previous) => previous.scrollTop === nextTop ? previous : { ...previous, scrollTop: nextTop });
  }, [lines, metrics.viewportHeight, rowOffsets]);

  return {
    containerRef,
    indices,
    isVirtualized,
    lineIndices,
    onScroll,
    registerRow,
    rowOffsets,
    scrollToIndex,
  };
}
