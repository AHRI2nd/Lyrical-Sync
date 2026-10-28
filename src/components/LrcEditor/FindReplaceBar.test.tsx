// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FindReplaceBar } from "./FindReplaceBar";

afterEach(cleanup);

function renderBar() {
  const onNext = vi.fn();
  const onReplace = vi.fn();
  const onClose = vi.fn();
  const findInputRef = { current: null } as React.RefObject<HTMLInputElement | null>;
  const view = render(<FindReplaceBar
    findText="a" replaceText="b" caseSensitive={false} matchCount={1} matchPos={0}
    onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={vi.fn()}
    onPrev={vi.fn()} onNext={onNext} onReplace={onReplace} onReplaceAll={vi.fn()}
    onClose={onClose} findInputRef={findInputRef}
  />);
  return { ...view, onNext, onReplace, onClose };
}

it.each([{ isComposing: true }, { keyCode: 229 }])("does not consume composition Enter or Escape (%j)", (composition) => {
  const { getAllByRole, onNext, onReplace, onClose } = renderBar();
  fireEvent.keyDown(getAllByRole("textbox")[0], { key: "Enter", ...composition });
  fireEvent.keyDown(getAllByRole("textbox")[1], { key: "Enter", ...composition });
  fireEvent.keyDown(window, { key: "Escape", ...composition });
  expect(onNext).not.toHaveBeenCalled();
  expect(onReplace).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps normal find shortcuts available", () => {
  const { getAllByRole, onNext, onReplace, onClose } = renderBar();
  fireEvent.keyDown(getAllByRole("textbox")[0], { key: "Enter" });
  fireEvent.keyDown(getAllByRole("textbox")[1], { key: "Enter" });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onNext).toHaveBeenCalledOnce();
  expect(onReplace).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});
