// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useI18nStore } from "../../stores/useI18nStore";
import { HelpModal } from "./HelpModal";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

afterEach(() => cleanup());

it("exposes the selected Help category as pressed state", () => {
  useI18nStore.getState().setLang("en");
  render(<HelpModal onClose={vi.fn()} />);

  const shortcuts = screen.getByRole("button", { name: "Shortcuts" });
  const aiGuide = screen.getByRole("button", { name: "AI Guide" });
  expect(shortcuts.getAttribute("aria-pressed")).toBe("true");
  expect(aiGuide.getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(aiGuide);
  expect(shortcuts.getAttribute("aria-pressed")).toBe("false");
  expect(aiGuide.getAttribute("aria-pressed")).toBe("true");
});
