// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ScaleBar } from "./ScaleBar";
import { TimeShiftBar } from "./TimeShiftBar";
import { useI18nStore } from "../../stores/useI18nStore";

afterEach(() => {
  cleanup();
  document.querySelector('[data-test-modal="true"]')?.remove();
  document.querySelector('[data-test-search="true"]')?.remove();
});

it("applies scaling only from its own unmodified input and never double-applies button Enter", () => {
  let timestamps = [10, 20];
  const onApply = vi.fn((factor: number) => { timestamps = timestamps.map((time) => time * factor); });
  const onClose = vi.fn();
  const { getByRole } = render(<ScaleBar onApply={onApply} onClose={onClose} />);
  const input = getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "2" } });

  const search = document.createElement("input");
  search.dataset.testSearch = "true";
  document.body.append(search);
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onApply).not.toHaveBeenCalled();
  expect(timestamps).toEqual([10, 20]);

  input.focus();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenLastCalledWith(2);
  expect(document.activeElement).toBe(input);

  const applyButton = getByRole("button", { name: useI18nStore.getState().t.timeShiftApply });
  fireEvent.keyDown(applyButton, { key: "Enter" });
  fireEvent.click(applyButton);
  expect(onApply).toHaveBeenCalledTimes(2);
});

it.each([{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { defaultPrevented: true }])(
  "ignores scale Enter during composition or when another key owner claims it (%j)",
  (modifiers) => {
    const onApply = vi.fn();
    const { getByRole } = render(<ScaleBar onApply={onApply} onClose={vi.fn()} />);
    const input = getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "2" } });
    if (modifiers.defaultPrevented) input.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    if (modifiers.isComposing) {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      Object.defineProperty(event, "isComposing", { value: true });
      input.dispatchEvent(event);
    } else {
      fireEvent.keyDown(input, { key: "Enter", ...modifiers });
    }
    expect(onApply).not.toHaveBeenCalled();
  },
);

it("does not let scale Enter apply while a higher modal is open and preserves Escape handling", () => {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const { getByRole } = render(<ScaleBar onApply={onApply} onClose={onClose} />);
  const input = getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "2" } });
  const modal = document.createElement("div");
  modal.className = "fixed inset-0";
  modal.dataset.testModal = "true";
  document.body.append(modal);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onApply).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("applies time shift only for Ctrl/Cmd+Enter inside its own controls", () => {
  const onApply = vi.fn();
  render(<TimeShiftBar lineCount={4} defaultFrom={1} onApply={onApply} onClose={vi.fn()} />);
  const deltaInput = document.querySelectorAll('input[type="number"]')[2] as HTMLInputElement;
  fireEvent.change(deltaInput, { target: { value: "2" } });

  const search = document.createElement("input");
  search.dataset.testSearch = "true";
  document.body.append(search);
  fireEvent.keyDown(search, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(search, { key: "Enter", metaKey: true });
  expect(onApply).not.toHaveBeenCalled();

  deltaInput.focus();
  fireEvent.keyDown(deltaInput, { key: "Enter", ctrlKey: true });
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenLastCalledWith(0, 3, 2);
  expect(document.activeElement).toBe(deltaInput);
  fireEvent.keyDown(deltaInput, { key: "Enter", metaKey: true });
  expect(onApply).toHaveBeenCalledTimes(2);
});

it.each([{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { defaultPrevented: true }])(
  "ignores time shift shortcuts during composition or when another key owner claims them (%j)",
  (modifiers) => {
    const onApply = vi.fn();
    render(<TimeShiftBar lineCount={4} defaultFrom={1} onApply={onApply} onClose={vi.fn()} />);
    const deltaInput = document.querySelectorAll('input[type="number"]')[2] as HTMLInputElement;
    fireEvent.change(deltaInput, { target: { value: "2" } });
    if (modifiers.defaultPrevented) deltaInput.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    if (modifiers.isComposing) {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ctrlKey: true });
      Object.defineProperty(event, "isComposing", { value: true });
      deltaInput.dispatchEvent(event);
    } else {
      fireEvent.keyDown(deltaInput, { key: "Enter", ctrlKey: true, ...modifiers });
    }
    expect(onApply).not.toHaveBeenCalled();
  },
);
