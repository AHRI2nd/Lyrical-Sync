import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// zustand persist(useSettingsStore/useI18nStore)용 최소 localStorage 폴리필 (node 환경)
if (typeof globalThis.localStorage === "undefined") {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const pushErrorToast = vi.fn();
vi.mock("./useToastStore", () => ({ toast: { error: (m: string) => pushErrorToast(m) } }));

import { useDeviceStore } from "./useDeviceStore";
import { useSettingsStore } from "./useSettingsStore";

describe("useDeviceStore — failure notification", () => {
  beforeEach(() => {
    invoke.mockReset();
    pushErrorToast.mockClear();
    useSettingsStore.getState().setDeviceMode(false);
    useDeviceStore.setState({ hasSession: false, isPlaying: false, positionMs: 0 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    useDeviceStore.getState().stopPolling();
    vi.useRealTimers();
  });

  it("shows a toast once when the adapter fails, then stops repeating it while still failing", async () => {
    invoke.mockRejectedValue(new Error("adapter broken"));
    useSettingsStore.getState().setDeviceMode(true);

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate poll

    expect(pushErrorToast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // 2nd poll, still failing
    await vi.advanceTimersByTimeAsync(1000); // 3rd poll, still failing

    expect(pushErrorToast).toHaveBeenCalledTimes(1);
  });

  it("re-notifies after a successful poll resets the streak and it fails again", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    invoke.mockRejectedValueOnce(new Error("adapter broken"));

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushErrorToast).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValueOnce(null); // recovers — no active session, but call succeeds
    await vi.advanceTimersByTimeAsync(1000);

    invoke.mockRejectedValueOnce(new Error("adapter broken again"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(pushErrorToast).toHaveBeenCalledTimes(2);
  });

  it("does not poll or notify while device mode is off", async () => {
    useSettingsStore.getState().setDeviceMode(false);
    invoke.mockRejectedValue(new Error("adapter broken"));

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).not.toHaveBeenCalled();
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("starting polling again resets the failure streak flag", async () => {
    useSettingsStore.getState().setDeviceMode(true);
    invoke.mockRejectedValue(new Error("adapter broken"));

    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushErrorToast).toHaveBeenCalledTimes(1);

    useDeviceStore.getState().stopPolling();
    useDeviceStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(pushErrorToast).toHaveBeenCalledTimes(2);
  });
});
