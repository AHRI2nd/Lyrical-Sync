// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { HistoryPanel } from "./HistoryPanel";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";

afterEach(() => cleanup());

it("exposes expanded state and closes on Escape while restoring trigger focus", () => {
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "before", timestamp: null }] },
    _history: [], _future: [], _lastEditKey: null,
  });
  useLrcStore.getState().updateLine("a", { text: "after" });
  const t = useI18nStore.getState().t;
  const { getByRole, queryByRole } = render(<HistoryPanel />);
  const trigger = getByRole("button", { name: t.historyPanelTitle });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const menu = getByRole("group", { name: t.historyPanelTitle });
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(queryByRole("group", { name: t.historyPanelTitle })).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("labels history states with the action that produced each state", () => {
  useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "before", timestamp: null }] },
    _history: [], _future: [], _lastEditKey: null,
  });
  useLrcStore.getState().updateLine("a", { text: "after" });
  useLrcStore.getState().addLine("new row");
  const t = useI18nStore.getState().t;
  const { getByRole } = render(<HistoryPanel />);
  fireEvent.click(getByRole("button", { name: t.historyPanelTitle }));

  fireEvent.click(getByRole("button", { name: new RegExp(t.historyLabels.editText) }));

  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["after"]);
});
