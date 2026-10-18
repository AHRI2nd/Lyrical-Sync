// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SyncModeToggle } from "./SyncModeToggle";
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

it("exposes the selected sync mode and unit while preserving disabled transitions", () => {
  const t = translations.en, onSetSyncMode = vi.fn(), onUnitChange = vi.fn();
  const { getByRole, rerender } = render(<SyncModeToggle t={t} charMode={false} syncUnit="char" onSetSyncMode={onSetSyncMode} onUnitChange={onUnitChange} isRunning={false} />);
  expect(getByRole("button", { name: t.charSync.modeLine }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(getByRole("button", { name: t.charSync.modeChar }));
  expect(onSetSyncMode).toHaveBeenCalledExactlyOnceWith("char");
  rerender(<SyncModeToggle t={t} charMode syncUnit="word" onSetSyncMode={onSetSyncMode} onUnitChange={onUnitChange} isRunning />);
  expect(getByRole("button", { name: t.charSync.modeChar }).getAttribute("aria-pressed")).toBe("true");
  expect((getByRole("button", { name: t.charSync.modeChar }) as HTMLButtonElement).disabled).toBe(true);
  expect(getByRole("button", { name: t.charSync.unitWord }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(getByRole("button", { name: t.charSync.unitChar }));
  expect(onUnitChange).toHaveBeenCalledExactlyOnceWith("char");
});
