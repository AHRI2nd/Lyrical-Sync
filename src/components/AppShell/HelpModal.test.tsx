// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { HelpModal } from "./HelpModal";
import { useI18nStore } from "../../stores/useI18nStore";
import { translations } from "../../i18n/translations";
import { useToastStore } from "../../stores/useToastStore";
afterEach(() => { cleanup(); vi.resetAllMocks(); useToastStore.setState({ toasts: [] }); });
it.each(["ko", "en", "ja"] as const)("opens the %s policy through the native browser command", async lang => {
  useI18nStore.setState({ lang, t: translations[lang] });
  vi.mocked(invoke).mockResolvedValue(undefined);
  render(<HelpModal onClose={() => {}} />);
  fireEvent.click(screen.getByTestId("privacy-policy-link"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_privacy_policy", { language: lang }));
});
it("reports a browser launch failure without closing Help", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("No browser"));
  const close = vi.fn();
  render(<HelpModal onClose={close} />);
  fireEvent.click(screen.getByTestId("privacy-policy-link"));
  await waitFor(() => expect(useToastStore.getState().toasts.slice(-1)[0]?.type).toBe("error"));
  expect(close).not.toHaveBeenCalled();
});
