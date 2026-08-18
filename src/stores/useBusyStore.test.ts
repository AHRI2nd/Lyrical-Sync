import { describe, it, expect, beforeEach } from "vitest";
import { useBusyStore } from "./useBusyStore";

describe("useBusyStore", () => {
  beforeEach(() => useBusyStore.setState({ reasons: new Set() }));

  it("starts with no busy reasons", () => {
    expect(useBusyStore.getState().reasons.size).toBe(0);
  });

  it("markBusy adds a reason", () => {
    useBusyStore.getState().markBusy("model-download");
    expect(useBusyStore.getState().reasons.has("model-download")).toBe(true);
  });

  it("markBusy is idempotent (adding the same id twice keeps a single entry)", () => {
    useBusyStore.getState().markBusy("model-download");
    useBusyStore.getState().markBusy("model-download");
    expect(useBusyStore.getState().reasons.size).toBe(1);
  });

  it("tracks multiple independent busy reasons", () => {
    useBusyStore.getState().markBusy("model-download");
    useBusyStore.getState().markBusy("youtube-download");
    expect(useBusyStore.getState().reasons.size).toBe(2);
  });

  it("clearBusy removes only the given reason", () => {
    useBusyStore.getState().markBusy("model-download");
    useBusyStore.getState().markBusy("youtube-download");
    useBusyStore.getState().clearBusy("model-download");
    const reasons = useBusyStore.getState().reasons;
    expect(reasons.has("model-download")).toBe(false);
    expect(reasons.has("youtube-download")).toBe(true);
  });

  it("clearBusy on an id that isn't tracked is a no-op (no re-render churn)", () => {
    const before = useBusyStore.getState().reasons;
    useBusyStore.getState().clearBusy("never-marked");
    expect(useBusyStore.getState().reasons).toBe(before);
  });
});
