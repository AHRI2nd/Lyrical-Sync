// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FindReplaceBar } from "./FindReplaceBar";
import { translations, type Lang } from "../../i18n/translations";
import { useI18nStore } from "../../stores/useI18nStore";

const originalLanguage = useI18nStore.getState();
afterEach(() => { cleanup(); useI18nStore.setState(originalLanguage); });

it.each([
  ["ko", "이전 일치 (Shift+Enter)", "다음 일치 (Enter)", "닫기"],
  ["en", "Previous match (Shift+Enter)", "Next match (Enter)", "Close"],
  ["ja", "前の一致 (Shift+Enter)", "次の一致 (Enter)", "閉じる"],
])("localizes find navigation and close in %s without duplicate callbacks", (lang, previous, next, close) => {
  useI18nStore.setState({ lang: lang as Lang, t: translations[lang as Lang] });
  const onPrev = vi.fn(), onNext = vi.fn(), onClose = vi.fn();
  const { getByRole } = render(<FindReplaceBar findText="word" replaceText="next" caseSensitive={false} matchCount={1} matchPos={0}
    onFindChange={() => {}} onReplaceChange={() => {}} onCaseSensitiveToggle={() => {}} onPrev={onPrev} onNext={onNext}
    onReplace={() => {}} onReplaceAll={() => {}} onClose={onClose} findInputRef={createRef<HTMLInputElement>()} />);
  fireEvent.click(getByRole("button", { name: previous }));
  fireEvent.click(getByRole("button", { name: next }));
  fireEvent.click(getByRole("button", { name: close }));
  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

