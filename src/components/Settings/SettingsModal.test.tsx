// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { useI18nStore } from "../../stores/useI18nStore";
afterEach(cleanup);
it("opens directly at character shortcuts and returns focus to its trigger", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger); trigger.focus();
  const onClose = vi.fn();
  const view = render(<SettingsModal {...{onClose,onUpdateFound:vi.fn(),initialTab:"shortcuts" as const}} />);
  expect(document.activeElement).toBe(screen.getByRole("heading",{name:useI18nStore.getState().t.charSync.modeChar}));
  fireEvent.click(screen.getByRole("button",{name:useI18nStore.getState().t.close}));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
