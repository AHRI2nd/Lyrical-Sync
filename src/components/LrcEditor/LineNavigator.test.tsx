// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
