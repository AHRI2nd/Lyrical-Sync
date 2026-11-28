// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TransportControls } from "./TransportControls";
import { useI18nStore } from "../../stores/useI18nStore";

afterEach(() => cleanup());

function renderControls() {
  const t = useI18nStore.getState().t;
  render(
    <TransportControls
      t={t}
      audioPath={null}
      isPlaying={false}
      togglePlay={() => {}}
      skip={() => {}}
      stopAndReset={() => {}}
      isLooping={false}
      onToggleLoop={() => {}}
      showMarkers={false}
      onToggleMarkers={() => {}}
      showSpectrogram={false}
      onToggleSpectrogram={() => {}}
    />,
  );
  return t;
}

it("exposes More state and closes on Escape while restoring trigger focus", () => {
  const t = renderControls();
  const trigger = screen.getByRole("button", { name: t.playerMore });

  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(screen.getByRole("group", { name: t.playerMore }), { key: "Escape" });

  expect(screen.queryByRole("group", { name: t.playerMore })).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("keeps More open for an IME Escape event", () => {
  const t = renderControls();
  const trigger = screen.getByRole("button", { name: t.playerMore });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("group", { name: t.playerMore }), { key: "Escape", isComposing: false, keyCode: 229 });

  expect(screen.getByRole("group", { name: t.playerMore })).toBeTruthy();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("shows the skip duration on each transport button", () => {
  const t = renderControls();
  for (const [name, value] of [[t.tooltipSkipBack5, "5"], [t.tooltipSkipBack1, "1"], [t.tooltipSkipFwd1, "1"], [t.tooltipSkipFwd5, "5"]] as const) {
    expect(screen.getByRole("button", { name }).textContent).toContain(value);
  }
});
