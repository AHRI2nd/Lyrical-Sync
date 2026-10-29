// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ToastContainer } from "./ToastContainer";
import { useToastStore } from "../../stores/useToastStore";

afterEach(() => {
  cleanup();
  useToastStore.setState({ toasts: [] });
});

it("announces error toasts through an assertive live region", () => {
  useToastStore.setState({ toasts: [{ id: 1, type: "error", message: "Save failed" }] });
  render(<ToastContainer />);
  expect(screen.getByRole("alert").textContent).toContain("Save failed");
});
