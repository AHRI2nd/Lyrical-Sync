// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

it("dismisses the oldest toast with Escape after the notification region receives focus", () => {
  useToastStore.setState({ toasts: [
    { id: 1, type: "error", message: "Save failed" },
    { id: 2, type: "success", message: "Saved" },
  ] });
  render(<ToastContainer />);
  const region = screen.getByRole("region", { name: "Notifications" });
  region.focus();
  fireEvent.keyDown(region, { key: "Escape" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Saved");
});
