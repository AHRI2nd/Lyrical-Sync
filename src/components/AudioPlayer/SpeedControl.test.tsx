// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpeedControl } from "./SpeedControl";
import { useI18nStore } from "../../stores/useI18nStore";
afterEach(cleanup);
it("exposes the current speed and adjusts it while preserving keyboard focus", () => {
  const t = useI18nStore.getState().t;
  const up = vi.fn();
  render(<SpeedControl t={t} playbackRate={0.25} speedMin={0.25} speedMax={2} onSpeedDown={() => {}} onSpeedUp={up} />);
  const trigger = screen.getByRole("button", { name: `${t.playerSpeed}: 0.25×` });
  fireEvent.click(trigger);
  expect(screen.getByRole("button", { name: t.tooltipSpeedDown }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t.tooltipSpeedUp }));
  expect(up).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole("group", { name: t.playerSpeed }), { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
});
