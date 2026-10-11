// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IconBtn } from "./IconBtn";
afterEach(cleanup);
it("exposes the localized action name for an icon-only button", () => {
  let clicks = 0;
  render(<IconBtn title="가사 열기" onClick={() => clicks++}><svg aria-hidden="true" /></IconBtn>);
  fireEvent.click(screen.getByRole("button", { name: "가사 열기" }));
  expect(clicks).toBe(1);
});
