// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { YouTubeModal } from "./YouTubeModal";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

afterEach(() => { cleanup(); useSettingsStore.setState({ youtubeDisclaimerAccepted: false }); });

it("keeps composing Enter and Escape from submitting or dismissing the YouTube dialog", () => {
  useSettingsStore.setState({ youtubeDisclaimerAccepted: true });
  const onLoad = vi.fn();
  const onClose = vi.fn();
  const { t } = useI18nStore.getState();
  render(<YouTubeModal t={t} ytUrl="https://youtu.be/example" ytLoading={false} ytError={null}
    onChangeUrl={() => {}} onLoad={onLoad} onCancel={() => {}} onClose={onClose} />);
  const input = screen.getByRole("textbox");

  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });

  expect(onLoad).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: t.youtubeModalTitle })).toBeTruthy();
});
