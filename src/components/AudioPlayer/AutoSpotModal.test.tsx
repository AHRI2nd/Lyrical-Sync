// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../utils/decodeAudioSamples", () => ({ decodeAudioSamples: vi.fn() }));
import { decodeAudioSamples } from "../../utils/decodeAudioSamples";
import { useI18nStore } from "../../stores/useI18nStore";
import { useLrcStore } from "../../stores/useLrcStore";
import { defaultDocument } from "../../types/lrc";
import { AutoSpotModal } from "./AutoSpotModal";

beforeEach(() => {
  vi.mocked(decodeAudioSamples).mockReset();
  useLrcStore.setState({ audioPath: "/song.mp3", audioBookmark: "grant", _documentSession: 1, _audioSelection: 1 });
});
afterEach(cleanup);

it("aborts analysis immediately when the user closes the modal", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(decodeAudioSamples).mockImplementation((_path, _bookmark, requestedSignal) => {
    signal = requestedSignal;
    return new Promise(() => {});
  });
  render(<AutoSpotModal onClose={vi.fn()} />);
  await waitFor(() => expect(decodeAudioSamples).toHaveBeenCalledOnce());

  fireEvent.click(screen.getByRole("button", { name: useI18nStore.getState().t.autoSpotCancel }));

  expect(signal?.aborted).toBe(true);
});

it("aborts the previous owner when audio selection changes and ignores its late result", async () => {
  const pending: Array<{ signal?: AbortSignal; resolve: (value: Awaited<ReturnType<typeof decodeAudioSamples>>) => void }> = [];
  vi.mocked(decodeAudioSamples).mockImplementation((_path, _bookmark, signal) => new Promise((resolve) => {
    pending.push({ signal, resolve });
  }));
  render(<AutoSpotModal onClose={vi.fn()} />);
  await waitFor(() => expect(pending).toHaveLength(1));

  act(() => useLrcStore.setState({ audioPath: "/next.mp3", audioBookmark: null, _audioSelection: 2 }));

  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0].signal?.aborted).toBe(true);
  expect(pending[1].signal?.aborted).toBe(false);
  await act(async () => pending[0].resolve({ samples: new Float32Array([0]), sampleRate: 1, file: { path: "/song.mp3", bookmark: "grant" } }));
  expect(screen.queryByText(useI18nStore.getState().t.autoSpotDecodeError)).toBeNull();
});

it("aborts analysis on unmount", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(decodeAudioSamples).mockImplementation((_path, _bookmark, requestedSignal) => {
    signal = requestedSignal;
    return new Promise(() => {});
  });
  const view = render(<AutoSpotModal onClose={vi.fn()} />);
  await waitFor(() => expect(decodeAudioSamples).toHaveBeenCalledOnce());

  view.unmount();

  expect(signal?.aborted).toBe(true);
});

it("keeps a successful analysis and refreshed bookmark without showing an error", async () => {
  vi.mocked(decodeAudioSamples).mockResolvedValue({
    samples: new Float32Array([0]), sampleRate: 1, file: { path: "/song.mp3", bookmark: "fresh-grant" },
  });
  render(<AutoSpotModal onClose={vi.fn()} />);

  await waitFor(() => expect(useLrcStore.getState().audioBookmark).toBe("fresh-grant"));
  expect(decodeAudioSamples).toHaveBeenCalledOnce();
  expect(screen.queryByText(useI18nStore.getState().t.autoSpotDecodeError)).toBeNull();
  expect(screen.queryByText(useI18nStore.getState().t.autoSpotDecoding)).toBeNull();
});

it("uses the displayed zero dB threshold for preview and inserted segments", async () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [] } });
  vi.mocked(decodeAudioSamples).mockResolvedValue({
    samples: new Float32Array(500).fill(0.1), sampleRate: 1000, file: { path: "/song.mp3", bookmark: "grant" },
  });
  const t = useI18nStore.getState().t;
  render(<AutoSpotModal onClose={vi.fn()} />);
  const count = (value: number) => screen.getAllByText((_, element) => element?.textContent?.trim() === `${value} ${t.autoSpotSegmentsFound}`)
    .find((element) => element.tagName === "SPAN");

  await waitFor(() => expect(count(1)).toBeTruthy());
  fireEvent.change(screen.getByDisplayValue("-35"), { target: { value: "0" } });
  await waitFor(() => expect(count(0)).toBeTruthy());
  expect((screen.getByRole("button", { name: t.autoSpotApply }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "-21" } });
  await waitFor(() => expect(count(1)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: t.autoSpotApply }));
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
});

it("isolates Auto Spot as a named dialog, labels its fields and ignores composing Escape", async () => {
  vi.mocked(decodeAudioSamples).mockResolvedValue({
    samples: new Float32Array([0]), sampleRate: 1, file: { path: "/song.mp3", bookmark: "grant" },
  });
  const closed = vi.fn();
  const t = useI18nStore.getState().t;
  render(<AutoSpotModal onClose={closed} />);

  const dialog = await screen.findByRole("dialog", { name: t.autoSpotTitle });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  const close = screen.getByRole("button", { name: t.close });
  const threshold = screen.getByRole("textbox", { name: t.autoSpotThreshold });
  expect(screen.getByRole("textbox", { name: t.autoSpotMinSilence })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t.autoSpotMinSpeech })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t.autoSpotPadding })).toBeTruthy();
  expect(document.activeElement).toBe(close);

  fireEvent.keyDown(threshold, { key: "Escape", isComposing: true });
  expect(closed).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: t.autoSpotTitle })).toBeTruthy();
});

it("keeps focus inside Auto Spot and restores the opener after normal Escape", async () => {
  vi.mocked(decodeAudioSamples).mockResolvedValue({
    samples: new Float32Array([0]), sampleRate: 1, file: { path: "/song.mp3", bookmark: "grant" },
  });
  const opener = document.createElement("button");
  opener.textContent = "Open Auto Spot";
  document.body.append(opener);
  opener.focus();

  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <AutoSpotModal onClose={() => setOpen(false)} /> : null;
  }
  render(<Harness />);
  const t = useI18nStore.getState().t;
  const threshold = await screen.findByRole("textbox", { name: t.autoSpotThreshold });
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  expect(screen.getByRole("dialog", { name: t.autoSpotTitle }).contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(threshold, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: t.autoSpotTitle })).toBeNull());
  expect(document.activeElement).toBe(opener);
  opener.remove();
  outside.remove();
});

it("applies an unchanged Auto Spot preview only once as one undoable insertion", async () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [] }, _history: [], _future: [] });
  vi.mocked(decodeAudioSamples).mockResolvedValue({
    samples: new Float32Array(500).fill(0.1), sampleRate: 1000, file: { path: "/song.mp3", bookmark: "grant" },
  });
  const t = useI18nStore.getState().t;
  render(<AutoSpotModal onClose={vi.fn()} />);
  const apply = await screen.findByRole("button", { name: t.autoSpotApply }) as HTMLButtonElement;

  fireEvent.click(apply);
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  expect(apply.disabled).toBe(true);
  fireEvent.click(apply);
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState()._history).toHaveLength(1);

  fireEvent.change(screen.getByDisplayValue("100"), { target: { value: "101" } });
  expect(apply.disabled).toBe(false);

  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines).toHaveLength(0);
});

it("clears the prior Apply result when a new audio selection is analyzed", async () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [] }, _history: [], _future: [] });
  const decoded = (path: string) => ({
    samples: new Float32Array(500).fill(0.1), sampleRate: 1000, file: { path, bookmark: "grant" },
  });
  vi.mocked(decodeAudioSamples).mockResolvedValueOnce(decoded("/song.mp3")).mockResolvedValueOnce(decoded("/next.mp3"));
  const t = useI18nStore.getState().t;
  render(<AutoSpotModal onClose={vi.fn()} />);
  const apply = await screen.findByRole("button", { name: t.autoSpotApply }) as HTMLButtonElement;
  fireEvent.click(apply);
  expect(apply.disabled).toBe(true);

  act(() => useLrcStore.setState({ audioPath: "/next.mp3", audioBookmark: "grant", _audioSelection: 2 }));
  await waitFor(() => expect(decodeAudioSamples).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(`1 ${t.autoSpotAddedLabel}`)).toBeNull());
  expect((screen.getByRole("button", { name: t.autoSpotApply }) as HTMLButtonElement).disabled).toBe(false);
});
