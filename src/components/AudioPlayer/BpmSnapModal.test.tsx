// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../utils/decodeAudioSamples", () => ({ decodeAudioSamples: vi.fn() }));
vi.mock("../../stores/useI18nStore", () => ({ useI18nStore: () => ({ t: {
  bpmTitle: "Beat grid", bpmDetecting: "Detecting", bpmHint: "Check the estimate", bpmDetectFailed: "No tempo found",
  bpmDecodeError: "Decode failed", bpmLabel: "Tempo", bpmOffset: "Offset", bpmTapTempo: "Tap tempo",
  bpmScopeSelected: "Selected", bpmScopeAll: "All", bpmConfidence: "Confidence", bpmAppliedAll: "Applied all",
  bpmAppliedCount: "applied", bpmManualHint: "Without audio, enter a BPM or use Tap Tempo", cancelLabel: "Cancel", applyLabel: "Apply",
} }) }));
import { decodeAudioSamples } from "../../utils/decodeAudioSamples";
import { useLrcStore } from "../../stores/useLrcStore";
import { defaultDocument } from "../../types/lrc";
import { BpmSnapModal } from "./BpmSnapModal";

const pulse = new Float32Array(12000);
for (let start = 100; start < pulse.length; start += 500) pulse.fill(1, start, start + 20);
const decoded = (path = "/song.mp3", bookmark: string | null = "grant") => ({ samples: pulse, sampleRate: 1000, file: { path, bookmark } });

beforeEach(() => {
  vi.mocked(decodeAudioSamples).mockReset().mockResolvedValue(decoded());
  localStorage.clear();
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "Beat", timestamp: 1.34 }] },
    audioPath: "/song.mp3", audioBookmark: "grant", _documentSession: 0, _audioSelection: 0,
    _history: [], _future: [], isDirty: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("refreshes a moved audio grant and applies the estimate to the selected line", async () => {
  vi.mocked(decodeAudioSamples).mockResolvedValue(decoded("/moved/song.mp3", "fresh"));
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Tempo").value).toBe("120"));
  expect(useLrcStore.getState()).toMatchObject({ audioPath: "/moved/song.mp3", audioBookmark: "fresh" });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.1);
});

it.each(["Infinity", "NaN", "", "0", "-1", "5e-324"])("cannot apply an invalid manual BPM %s", async (value) => {
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  await screen.findByLabelText("Tempo");
  fireEvent.change(screen.getByLabelText("Tempo"), { target: { value } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Apply" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.34);
});

it.each(["Infinity", "NaN", ""])("cannot apply an invalid offset %s", async (value) => {
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  await screen.findByLabelText("Offset");
  fireEvent.change(screen.getByLabelText("Offset"), { target: { value } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Apply" }).disabled).toBe(true);
});

it("discards a late analysis after the same audio path is selected again", async () => {
  let finish!: (value: ReturnType<typeof decoded>) => void;
  vi.mocked(decodeAudioSamples).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  const previousSignal = vi.mocked(decodeAudioSamples).mock.calls[0][2];
  vi.mocked(decodeAudioSamples).mockReturnValue(new Promise(() => {}));
  act(() => useLrcStore.setState({ _audioSelection: 1 }));
  await act(async () => finish(decoded("/obsolete/song.mp3", "obsolete")));
  expect(previousSignal?.aborted).toBe(true);
  expect(useLrcStore.getState().audioPath).toBe("/song.mp3");
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
});

it("clears a completed estimate when a new document uses the same audio path", async () => {
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  await screen.findByLabelText("Tempo");
  vi.mocked(decodeAudioSamples).mockReturnValue(new Promise(() => {}));
  act(() => useLrcStore.setState({ _documentSession: 1 }));
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.34);
});

it("cancels a pending decode when dismissed", async () => {
  vi.mocked(decodeAudioSamples).mockReturnValue(new Promise(() => {}));
  const onClose = vi.fn();
  render(<BpmSnapModal onClose={onClose} selectedIds={[]} />);
  const signal = vi.mocked(decodeAudioSamples).mock.calls[0][2];
  fireEvent.keyDown(window, { key: "Escape" });
  expect(signal?.aborted).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps duplicate tap timestamps safe and computes a later 120 BPM sequence", async () => {
  render(<BpmSnapModal onClose={() => {}} selectedIds={[]} />);
  await screen.findByLabelText("Tempo");
  const clock = vi.spyOn(performance, "now");
  clock.mockReturnValue(1000);
  fireEvent.click(screen.getByRole("button", { name: "Tap tempo" }));
  fireEvent.click(screen.getByRole("button", { name: "Tap tempo" }));
  expect(screen.getByLabelText<HTMLInputElement>("Tempo").value).toBe("120");
  clock.mockReturnValue(1500);
  fireEvent.click(screen.getByRole("button", { name: "Tap tempo" }));
  expect(screen.getByLabelText<HTMLInputElement>("Tempo").value).toBe("120.0");
});

it("keeps manual BPM available after an unsuccessful local detection", async () => {
  vi.mocked(decodeAudioSamples).mockResolvedValue({ ...decoded(), samples: new Float32Array(12000) });
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  await screen.findByText("No tempo found");
  fireEvent.change(screen.getByLabelText("Tempo"), { target: { value: "120" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.5);
});

it("uses the saved audio grant and aborts work on unmount", () => {
  vi.mocked(decodeAudioSamples).mockReturnValue(new Promise(() => {}));
  const { unmount } = render(<BpmSnapModal onClose={() => {}} selectedIds={[]} />);
  const [path, bookmark, signal] = vi.mocked(decodeAudioSamples).mock.calls[0];
  expect(path).toBe("/song.mp3");
  expect(bookmark).toBe("grant");
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});

it("discards a late grant refresh after document replacement", async () => {
  let finish!: (value: ReturnType<typeof decoded>) => void;
  vi.mocked(decodeAudioSamples).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  vi.mocked(decodeAudioSamples).mockReturnValue(new Promise(() => {}));
  act(() => useLrcStore.setState({ _documentSession: 1 }));
  await act(async () => finish(decoded("/obsolete/song.mp3", "obsolete")));
  expect(useLrcStore.getState().audioPath).toBe("/song.mp3");
  expect(useLrcStore.getState().audioBookmark).toBe("grant");
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
});

it("allows a manual beat grid without audio and applies all timed lines in one undo", () => {
  useLrcStore.setState({ audioPath: null, audioBookmark: null, doc: { ...defaultDocument(), lines: [
    { id: "a", text: "One", timestamp: 1.34 },
    { id: "b", text: "Two", timestamp: 2.32 },
    { id: "c", text: "Untimed", timestamp: null },
  ] } });
  render(<BpmSnapModal onClose={() => {}} selectedIds={[]} />);
  expect(screen.getByText("Without audio, enter a BPM or use Tap Tempo")).toBeTruthy();
  expect(decodeAudioSamples).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Tempo"), { target: { value: "120" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(useLrcStore.getState().doc.lines.map((line) => line.timestamp)).toEqual([1.5, 2.5, null]);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines.map((line) => line.timestamp)).toEqual([1.34, 2.32, null]);
});

it("cannot apply again after dismissal even if the parent has not unmounted yet", async () => {
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  await screen.findByLabelText("Tempo");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.34);
});

it("keeps an empty manual grid available after a document replacement without audio", () => {
  useLrcStore.setState({ audioPath: null });
  render(<BpmSnapModal onClose={() => {}} selectedIds={[]} />);
  act(() => useLrcStore.setState({ _documentSession: 1 }));
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(screen.queryByText("Detecting")).toBeNull();
});

it("computes Tap Tempo without audio and applies the resulting grid", () => {
  useLrcStore.setState({ audioPath: null });
  render(<BpmSnapModal onClose={() => {}} selectedIds={["a"]} />);
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  fireEvent.click(screen.getByRole("button", { name: "Tap tempo" }));
  clock.mockReturnValue(1500);
  fireEvent.click(screen.getByRole("button", { name: "Tap tempo" }));
  expect(screen.getAllByRole<HTMLInputElement>("textbox")[0].value).toBe("120.0");
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.5);
});
