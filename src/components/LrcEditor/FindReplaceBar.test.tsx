// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FindReplaceBar } from "./FindReplaceBar";
import { translations, type Lang } from "../../i18n/translations";
import { useI18nStore } from "../../stores/useI18nStore";

const originalLanguage = useI18nStore.getState();
afterEach(() => { cleanup(); useI18nStore.setState(originalLanguage); });

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

it.each(["ko", "en", "ja"] as const)("exposes localized case-toggle state and keyboard explanation (%s)", async (lang: Lang) => {
  const user = userEvent.setup();
  useI18nStore.setState({ lang, t: translations[lang] });
  const onCaseSensitiveToggle = vi.fn();
  const { getByRole, rerender } = render(<FindReplaceBar
    findText="a" replaceText="b" caseSensitive={false} matchCount={1} matchPos={0}
    onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={onCaseSensitiveToggle}
    onPrev={vi.fn()} onNext={vi.fn()} onReplace={vi.fn()} onReplaceAll={vi.fn()}
    onClose={vi.fn()} findInputRef={{ current: null }}
  />);
  const label = translations[lang].caseSensitive;
  const toggle = getByRole("button", { name: label });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(toggle);
  const tooltip = getByRole("tooltip");
  expect(toggle.getAttribute("aria-describedby")).toBe(tooltip.id);
  expect(tooltip.className).toContain("group-focus-within/aa:block");
  await user.keyboard(" ");
  expect(onCaseSensitiveToggle).toHaveBeenCalledOnce();

  rerender(<FindReplaceBar
    findText="a" replaceText="b" caseSensitive matchCount={1} matchPos={0}
    onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={onCaseSensitiveToggle}
    onPrev={vi.fn()} onNext={vi.fn()} onReplace={vi.fn()} onReplaceAll={vi.fn()}
    onClose={vi.fn()} findInputRef={{ current: null }}
  />);
  expect(getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
});
