// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ComponentProps } from "react";
import { LrcLineRow } from "./LrcLineRow";
import { type Translations } from "../../i18n/translations";

type LrcLineRowProps = ComponentProps<typeof LrcLineRow>;

function makeProps(overrides: Partial<LrcLineRowProps> = {}): LrcLineRowProps {
  const noop = () => {};
  return {
    t: {
      reorderLine: "Reorder line",
      linePlaceholder: "Lyrics",
      translationPlaceholder: "Translation",
      loopLine: "Loop line",
      mergeLineUp: "Merge up",
      duplicateLine: "Duplicate",
      deleteLine: "Delete",
      warnDuplicate: "Duplicate timestamp",
      warnOutOfOrder: "Out of order",
      confidence: "Confidence",
      charSync: { badge: "Character sync" },
    } as unknown as Translations,
    line: { id: "line-1", timestamp: 1, text: "First line" },
    idx: 0,
    isActive: false,
    isSelected: false,
    confidence: undefined,
    isMatch: false,
    isCurrentMatch: false,
    warning: undefined,
    loopLineId: null,
    lyricsFontScale: 1,
    showSpellCheck: false,
    showTranslationLines: false,
    serviceActive: false,
    dragIdx: null,
    showInsertionBefore: false,
    showInsertionAfter: false,
    onReorderPointerDown: noop,
    editingTsId: null,
    editTsValue: "",
    onEditTsChange: noop,
    onStartTsEdit: noop,
    onCommitTsEdit: noop,
    onCancelTsEdit: noop,
    onStampCurrentLine: noop,
    onRowClick: noop,
    onToggleLoop: noop,
    onTextChange: noop,
    onTranslationChange: noop,
    onKeyDown: noop,
    onPaste: noop,
    onFocus: noop,
    onMergeUp: noop,
    onDuplicate: noop,
    onDelete: noop,
    inputRef: noop,
    rowRef: noop,
    ...overrides,
  };
}

describe("LrcLineRow drag handle", () => {
  afterEach(cleanup);

  it("starts reordering by pointer without starting an HTML drag", () => {
    const onReorderPointerDown = vi.fn();
    render(<LrcLineRow {...makeProps({ onReorderPointerDown })} />);
    const handle = screen.getByTitle("Reorder line");

    expect(handle.getAttribute("draggable")).toBe("false");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });

    expect(onReorderPointerDown).toHaveBeenCalledOnce();
  });
});
