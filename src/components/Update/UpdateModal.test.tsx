// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UpdateModal } from "./UpdateModal";
import { useUpdaterStore } from "../../stores/useUpdaterStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { useI18nStore } from "../../stores/useI18nStore";

beforeEach(() => {
  useBusyStore.setState({ reasons: new Set() });
  useUpdaterStore.setState({ status: "idle", version: null, body: null, progress: 0, error: null, _update: null });
});
afterEach(() => cleanup());

it("disables update install while a model operation owns a busy lease", () => {
  useBusyStore.getState().markBusy("model-download:ctc:run-1");
  useUpdaterStore.setState({ status: "available", version: "0.7.1", body: "notes" });
  const { getByRole } = render(<UpdateModal />);
  expect(getByRole("button", { name: useI18nStore.getState().t.updater.update }).hasAttribute("disabled")).toBe(true);
});

it("keeps the ready state visible but disables restart until model work settles", () => {
  useBusyStore.getState().markBusy("model-download:ctc:run-2");
  useUpdaterStore.setState({ status: "ready", version: "0.7.1" });
  const { getByRole } = render(<UpdateModal />);
  expect(getByRole("button", { name: useI18nStore.getState().t.updater.restart }).hasAttribute("disabled")).toBe(true);
  expect(getByRole("button", { name: useI18nStore.getState().t.updater.later }).hasAttribute("disabled")).toBe(false);
});
