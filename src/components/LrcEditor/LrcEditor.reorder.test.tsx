// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { LrcEditor } from "./LrcEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";

describe("LrcEditor line reorder", () => {
  beforeEach(() => {
    useLrcStore.setState({
      doc: {
        metadata: { title: "", artist: "", album: "", by: "", offset: 0 },
        lines: [
          { id: "first", timestamp: 1, text: "First lyric" },
          { id: "second", timestamp: 2, text: "Second lyric" },
        ],
        extraTags: {},
      },
      activeLineId: null,
      syncMode: "line",
      _history: [],
      _future: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  const startOn = (index = 0) => {
    const handles = screen.getAllByTitle(useI18nStore.getState().t.reorderLine);
    const handle = handles[index];
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn(), configurable: true });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 10, clientY: index * 20 + 10 });
    return handle;
  };

  const pointAt = (target: Element | null) => {
    Object.defineProperty(document, "elementFromPoint", {
      value: vi.fn(() => target),
      configurable: true,
    });
  };

  const positionRows = () => {
    for (const row of document.querySelectorAll<HTMLElement>("[data-line-id]")) {
      Object.defineProperty(row, "getBoundingClientRect", {
        value: () => {
          const index = Array.from(row.parentElement!.children).indexOf(row);
          return { top: index * 20, bottom: index * 20 + 20, height: 20 };
        },
        configurable: true,
      });
    }
  };

  it("shows an insertion line between rows and drops into that exact gap", () => {
    const doc = useLrcStore.getState().doc;
    useLrcStore.setState({ doc: { ...doc, lines: [...doc.lines, { id: "third", timestamp: 3, text: "Third lyric" }] } });
    render(<LrcEditor onPreview={() => {}} />);
    positionRows();
    pointAt(screen.getByDisplayValue("Second lyric").closest("[data-line-id]")!.parentElement!);
    const handle = screen.getAllByTitle(useI18nStore.getState().t.reorderLine)[2];
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn(), configurable: true });

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 20 });

    const marker = screen.getByTestId("line-insertion-marker");
    expect(marker.parentElement?.getAttribute("data-line-id")).toBe("second");
    expect(marker.getAttribute("data-placement")).toBe("before");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 55 });
    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["first", "third", "second"]);
  });

  it("moves a line when its handle is dragged over another row with the pointer", () => {
    render(<LrcEditor onPreview={() => {}} />);
    positionRows();
    const target = screen.getByDisplayValue("Second lyric");
    pointAt(target);
    const handle = startOn();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 35 });
    const marker = screen.getByTestId("line-insertion-marker");
    expect(marker.parentElement?.getAttribute("data-line-id")).toBe("second");
    expect(marker.getAttribute("data-placement")).toBe("after");
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 35 });

    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["second", "first"]);
    expect(useLrcStore.getState()._history).toHaveLength(1);
  });

  it("shows a gap before the first line when dropping at the top", () => {
    render(<LrcEditor onPreview={() => {}} />);
    positionRows();
    pointAt(screen.getByDisplayValue("First lyric"));
    const handle = startOn(1);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 5 });

    const marker = screen.getByTestId("line-insertion-marker");
    expect(marker.parentElement?.getAttribute("data-line-id")).toBe("first");
    expect(marker.getAttribute("data-placement")).toBe("before");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 5 });
    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["second", "first"]);
  });

  it("does not create history when dropped beside its original position", () => {
    render(<LrcEditor onPreview={() => {}} />);
    positionRows();
    pointAt(screen.getByDisplayValue("Second lyric"));
    const handle = startOn();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 25 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 25 });

    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["first", "second"]);
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it("does not move a line after a short click", () => {
    render(<LrcEditor onPreview={() => {}} />);
    const handle = startOn();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 10 });

    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["first", "second"]);
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it("does not move a line when released outside the lyric rows", () => {
    render(<LrcEditor onPreview={() => {}} />);
    pointAt(null);
    const handle = startOn();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(screen.queryByTestId("line-insertion-marker")).toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 20 });

    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["first", "second"]);
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it("cancels reordering when the pointer is cancelled", () => {
    render(<LrcEditor onPreview={() => {}} />);
    pointAt(screen.getByDisplayValue("Second lyric"));
    const handle = startOn();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 20 });

    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["first", "second"]);
    expect(useLrcStore.getState()._history).toHaveLength(0);
  });

  it("uses current line IDs if the document order changes during the gesture", () => {
    render(<LrcEditor onPreview={() => {}} />);
    positionRows();
    pointAt(screen.getByDisplayValue("Second lyric"));
    const handle = startOn();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 35 });

    const current = useLrcStore.getState().doc;
    useLrcStore.setState({ doc: { ...current, lines: [...current.lines].reverse() } });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 5 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 5 });

    expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["first", "second"]);
    expect(useLrcStore.getState()._history).toHaveLength(1);
  });
});
