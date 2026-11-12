// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import { useToastStore } from "../../stores/useToastStore";

afterEach(() => {
  cleanup();
  useToastStore.setState({ toasts: [] });
});

it("disables the toast entrance animation for reduced-motion users without removing dismissal", () => {
  useToastStore.setState({ toasts: [{ id: 1, type: "info", message: "Saved" }] });
  render(<ToastContainer />);

  const message = screen.getByText("Saved");
  const toast = message.parentElement as HTMLDivElement;
  expect(toast.className).toContain("motion-reduce:animate-none");

  fireEvent.click(toast);
  expect(screen.queryByText("Saved")).toBeNull();
});
