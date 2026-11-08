// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { DevicePickerModal } from "./DevicePickerModal";
import { useServiceStore } from "../../stores/useServiceStore";
import { useI18nStore } from "../../stores/useI18nStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const device = (id: string, name: string) => ({ id, name, type: "Computer", is_active: false, volume_percent: null });

beforeEach(() => { useI18nStore.getState().setLang("en"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps the newest device list when refresh responses finish out of order", async () => {
  const first = deferred<ReturnType<typeof device>[]>();
  const second = deferred<ReturnType<typeof device>[]>();
  const fetchDevices = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  useServiceStore.setState({ fetchDevices, isPlaying: false });
  render(<DevicePickerModal onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.devicePicker.refresh }));
  await act(async () => { second.resolve([device("new", "New Device")]); await second.promise; });
  expect(screen.getByText("New Device")).toBeTruthy();
  await act(async () => { first.resolve([device("old", "Old Device")]); await first.promise; });
  expect(screen.getByText("New Device")).toBeTruthy();
  expect(screen.queryByText("Old Device")).toBeNull();
});

it("keeps selection locked through a manual refresh until the active transfer settles", async () => {
  const refresh = deferred<ReturnType<typeof device>[]>();
  const transfer = deferred<void>();
  const fetchDevices = vi.fn()
    .mockResolvedValueOnce([device("phone", "Phone")])
    .mockReturnValueOnce(refresh.promise);
  useServiceStore.setState({ fetchDevices, transferToDevice: vi.fn(() => transfer.promise), isPlaying: false });
  vi.useFakeTimers();
  render(<DevicePickerModal onClose={() => {}} />);

  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const phone = screen.getByRole("button", { name: /Phone/ });
  fireEvent.click(phone);
  expect(phone.hasAttribute("disabled")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.devicePicker.refresh }));
  await vi.waitFor(() => expect(fetchDevices).toHaveBeenCalledTimes(2));
  await act(async () => { refresh.resolve([device("phone", "Phone")]); await refresh.promise; });
  expect(screen.getByRole("button", { name: /Phone/ }).hasAttribute("disabled")).toBe(true);

  await act(async () => { transfer.resolve(); await transfer.promise; });
  expect(screen.getByRole("button", { name: /Phone/ }).hasAttribute("disabled")).toBe(false);
});

it("shows device-load failures separately from an empty device list", async () => {
  useServiceStore.setState({ fetchDevices: vi.fn().mockRejectedValue(new Error("403")) });
  render(<DevicePickerModal onClose={() => {}} />);

  expect(await screen.findByText(useI18nStore.getState().t.devicePicker.error)).toBeTruthy();
  expect(screen.queryByText(useI18nStore.getState().t.devicePicker.empty)).toBeNull();
});

it("shows transfer failures and releases the busy state", async () => {
  useServiceStore.setState({
    fetchDevices: vi.fn().mockResolvedValue([device("phone", "Phone")]),
    transferToDevice: vi.fn().mockRejectedValue(new Error("403")),
    isPlaying: false,
  });
  render(<DevicePickerModal onClose={() => {}} />);

  const target = await screen.findByRole("button", { name: /Phone/ });
  fireEvent.click(target);
  expect(await screen.findByText(useI18nStore.getState().t.devicePicker.transferFailed)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Phone/ }).hasAttribute("disabled")).toBe(false);
});

it("preserves a later transfer when the prior transfer's delayed refresh fires", async () => {
  vi.useFakeTimers();
  const secondTransfer = deferred<void>();
  useServiceStore.setState({
    fetchDevices: vi.fn().mockResolvedValue([device("phone", "Phone"), device("speaker", "Speaker")]),
    transferToDevice: vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(secondTransfer.promise),
    isPlaying: false,
  });
  render(<DevicePickerModal onClose={() => {}} />);

  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: /Phone/ }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: /Speaker/ }));
  expect(screen.getByRole("button", { name: /Speaker/ }).hasAttribute("disabled")).toBe(true);

  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  await act(async () => { secondTransfer.reject(new Error("403")); await secondTransfer.promise.catch(() => {}); });

  expect(screen.getByText(useI18nStore.getState().t.devicePicker.transferFailed)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Speaker/ }).hasAttribute("disabled")).toBe(false);
});

it("recovers the mounted guard across React StrictMode effect replay", async () => {
  const first = deferred<ReturnType<typeof device>[]>();
  const second = deferred<ReturnType<typeof device>[]>();
  const fetchDevices = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  useServiceStore.setState({ fetchDevices });
  render(<StrictMode><DevicePickerModal onClose={() => {}} /></StrictMode>);
  await vi.waitFor(() => expect(fetchDevices).toHaveBeenCalledTimes(2));

  await act(async () => { second.resolve([device("fresh", "Fresh Device")]); await second.promise; });
  expect(screen.getByText("Fresh Device")).toBeTruthy();
});
