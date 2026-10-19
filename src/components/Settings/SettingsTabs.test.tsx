// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SettingsTabBar, TabBtn } from "./SettingsTabs";
afterEach(cleanup);
it("preserves translated names and independent native button actions", () => {
  const general = vi.fn(), shortcuts = vi.fn();
  const { getByRole } = render(<SettingsTabBar><TabBtn active onClick={general}>一般</TabBtn><TabBtn active={false} onClick={shortcuts}>ショートカット</TabBtn></SettingsTabBar>);
  expect(getByRole("button", { name: "一般" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(getByRole("button", { name: "ショートカット" }));
  expect(shortcuts).toHaveBeenCalledOnce();
  expect(general).not.toHaveBeenCalled();
});
