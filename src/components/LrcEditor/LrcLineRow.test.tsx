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
      aiConfidenceRelativeScore: "Relative AI alignment score within this result; not a probability.",
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
    seekSource: "local",
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

it("explains that the AI timestamp color is a relative score, not a probability", () => {
  const props = makeProps({ confidence: 0.5 });
  const { container } = render(<LrcLineRow {...props} />);
  expect(container.querySelector(".ls-time-button")?.getAttribute("title"))
    .toBe(props.t.aiConfidenceRelativeScore);
});

describe("LrcLineRow warnings", () => {
  afterEach(cleanup);

  it("exposes warning details to keyboard users and opens the visual tooltip on focus", () => {
    render(<LrcLineRow {...makeProps({ warning: "duplicate" })} />);

    const warning = screen.getByRole("button", { name: "Duplicate timestamp" });
    expect(warning.getAttribute("type")).toBe("button");
    expect(warning.className).toContain("focus-visible:outline");
    warning.focus();

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Duplicate timestamp");
    expect(warning.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.className).toContain("group-focus-within/warn:block");
  });
});

describe("LrcLineRow timestamp input", () => {
  afterEach(cleanup);
  it.each([{ isComposing: true }, { keyCode: 229 }])("keeps composition Enter and Escape in the timestamp input (%j)", (composition) => {
    const onCommitTsEdit = vi.fn();
    const onCancelTsEdit = vi.fn();
    render(<LrcLineRow {...makeProps({ editingTsId: "line-1", onCommitTsEdit, onCancelTsEdit })} />);
    const input = screen.getByPlaceholderText("H:MM:SS.mmm");
    fireEvent.keyDown(input, { key: "Enter", ...composition });
    fireEvent.keyDown(input, { key: "Escape", ...composition });
    expect(onCommitTsEdit).not.toHaveBeenCalled();
    expect(onCancelTsEdit).not.toHaveBeenCalled();
  });
});
