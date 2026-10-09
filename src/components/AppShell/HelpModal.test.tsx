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

it("shows bundled third-party notices as plain text inside Help", async () => {
  vi.mocked(invoke).mockResolvedValue("WaveSurfer 7.12.6\nBSD 3-Clause License\n<script>untrusted()</script>");
  const close = vi.fn();
  render(<HelpModal onClose={close} />);
  fireEvent.click(screen.getByTestId("third-party-notices"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("read_third_party_notices"));
  expect((screen.getByTestId("third-party-notices-text") as HTMLTextAreaElement).value).toContain("BSD 3-Clause");
  expect(document.querySelector("script")).toBeNull();
  expect(close).not.toHaveBeenCalled();
});
it("reports a notice read failure and preserves Help", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Missing notices"));
  const close = vi.fn();
  render(<HelpModal onClose={close} />);
  fireEvent.click(screen.getByTestId("third-party-notices"));
  await waitFor(() => expect(useToastStore.getState().toasts.slice(-1)[0]?.type).toBe("error"));
  expect(close).not.toHaveBeenCalled();
});
