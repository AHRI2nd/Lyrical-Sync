// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LineNavigator } from "./LineNavigator";
afterEach(cleanup);
it("names every line, exposes selection and selects an untimed line once", () => {
  const select = vi.fn();
  const lines = [{ id: "a", text: "완료", timestamp: 1, syllables: [{ text: "완료", time: 1 }] }, { id: "b", text: "未登録", timestamp: null }];
  const { getByRole, rerender } = render(<LineNavigator lines={lines} activeIdx={0} onSelect={select} />);
  expect(getByRole("button", { name: "1. 완료" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(getByRole("button", { name: "2. 未登録" }));
  expect(select).toHaveBeenCalledExactlyOnceWith("b");
  rerender(<LineNavigator lines={lines} activeIdx={1} onSelect={select} />);
  expect(getByRole("button", { name: "2. 未登録" }).getAttribute("aria-pressed")).toBe("true");
});

it("notifies pointer selection once after selecting a line", async () => {
  const calls: string[] = [];
  const { getByRole } = render(<LineNavigator lines={[{ id: "a", text: "First", timestamp: null }]}
    activeIdx={0} onSelect={id => calls.push(id)} onPointerSelect={() => calls.push("pointer")} />);
  await userEvent.setup().click(getByRole("button", { name: "1. First" }));
  expect(calls).toEqual(["a", "pointer"]);
});

it.each(["{Enter}", " "])("preserves keyboard focus and selection with %s", async key => {
  const user = userEvent.setup();
  const select = vi.fn();
  const pointer = vi.fn();
  const { getByRole } = render(<LineNavigator lines={[
    { id: "a", text: "First", timestamp: null }, { id: "b", text: "Second", timestamp: null },
  ]} activeIdx={0} onSelect={select} onPointerSelect={pointer} />);
  await user.tab();
  await user.keyboard(key);
  expect(select).toHaveBeenCalledExactlyOnceWith("a");
  expect(pointer).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(getByRole("button", { name: "1. First" }));
  await user.tab();
  expect(document.activeElement).toBe(getByRole("button", { name: "2. Second" }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(getByRole("button", { name: "1. First" }));
});

it("preserves focus for a synthetic assistive click", () => {
  const select = vi.fn();
  const pointer = vi.fn();
  const { getByRole } = render(<LineNavigator lines={[{ id: "a", text: "First", timestamp: null }]}
    activeIdx={0} onSelect={select} onPointerSelect={pointer} />);
  const button = getByRole("button");
  button.focus();
  fireEvent.click(button, { detail: 0 });
  expect(select).toHaveBeenCalledExactlyOnceWith("a");
  expect(pointer).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button);
});
