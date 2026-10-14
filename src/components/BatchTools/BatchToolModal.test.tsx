// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { translations, type Translations } from "../../i18n/translations";
import { runBatchOperation, type BatchSummary } from "../../utils/batchProcessor";
import { BatchToolModal } from "./BatchToolModal";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../utils/batchProcessor", async (importOriginal) => ({ ...await importOriginal<typeof import("../../utils/batchProcessor")>(), runBatchOperation: vi.fn() }));
const t = {
  ...translations.en, batchTitle: "Batch tools", batchHint: "Create new files", batchSelectFiles: "Select files",
  batchOutputFolder: "Output folder", batchOutputFolderEmpty: "No output folder", batchNoFiles: "No files", batchOpOffset: "Offset", batchOpConvert: "Convert", batchOpTag: "Tags", batchOffsetLabel: "Offset seconds", batchTagHint: "LRC only",
  batchStatusPending: "Pending", batchStatusProcessing: "Processing", batchStatusDone: "Done", batchStatusError: "Error", batchStatusCancelled: "Cancelled", batchSummaryDone: "done", batchSummaryError: "errors", batchSummaryCancelled: "cancelled", batchRun: "Run", batchStop: "Stop", batchStopping: "Stopping",
} as Translations;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (_cmd, args) => `bookmark:${(args as { path: string }).path}`);
  vi.mocked(runBatchOperation).mockResolvedValue({ done: 1, error: 0, cancelled: 0 });
});
afterEach(cleanup);
async function selectInputsAndOutput() {
  vi.mocked(open).mockResolvedValueOnce(["/inputs/song.lrc"]);
  fireEvent.click(screen.getByRole("button", { name: "Select files" }));
  await screen.findByText("song.lrc");
  vi.mocked(open).mockResolvedValueOnce("/output");
  fireEvent.click(screen.getByRole("button", { name: "Output folder" }));
  await screen.findByText("/output");
}

it("requires an explicitly selected folder and uses bookmarked file references", async () => {
  render(<BatchToolModal t={t} onClose={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
  await selectInputsAndOutput();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(runBatchOperation).toHaveBeenCalled());
  expect(runBatchOperation).toHaveBeenCalledWith(
    [expect.objectContaining({ id: expect.any(String), file: { path: "/inputs/song.lrc", bookmark: "bookmark:/inputs/song.lrc" } })],
    { kind: "offset", deltaSeconds: 0 }, { path: "/output", bookmark: "bookmark:/output" }, expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, filters: [{ name: "Lyrics", extensions: ["lrc", "srt"] }] }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
});

it("freezes list and settings during execution and waits for active work after stopping", async () => {
  let finish!: (summary: BatchSummary) => void;
  vi.mocked(runBatchOperation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const close = vi.fn();
  render(<BatchToolModal t={t} onClose={close} />);
  await selectInputsAndOutput();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await screen.findByRole("button", { name: "Stop" });
  for (const name of ["Select files", "Output folder", "Convert", t.deleteLine, t.confirmNewCancel]) {
    for (const button of screen.getAllByRole("button", { name })) {
      expect(button.hasAttribute("disabled") || !!button.closest("fieldset[disabled]")).toBe(true);
    }
  }
  expect(screen.getByRole("spinbutton", { name: "Offset seconds" }).closest("fieldset[disabled]")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(vi.mocked(runBatchOperation).mock.calls[0][4]?.signal?.aborted).toBe(true);
  expect((screen.getByRole("button", { name: "Stopping" }) as HTMLButtonElement).disabled).toBe(true);
  expect(close).not.toHaveBeenCalled();
  await act(async () => { finish({ done: 1, error: 0, cancelled: 0 }); });
  expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(false);
});

it("aborts a running snapshot on unmount", async () => {
  let finish!: (summary: BatchSummary) => void;
  vi.mocked(runBatchOperation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<BatchToolModal t={t} onClose={vi.fn()} />);
  await selectInputsAndOutput();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await screen.findByRole("button", { name: "Stop" });
  const signal = vi.mocked(runBatchOperation).mock.calls[0][4]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ done: 1, error: 0, cancelled: 0 }); });
});

it("shows preflight failures without leaving the dialog running", async () => {
  vi.mocked(runBatchOperation).mockRejectedValueOnce(new Error("Duplicate output: song.srt"));
  render(<BatchToolModal t={t} onClose={vi.fn()} />);
  await selectInputsAndOutput();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Duplicate output: song.srt");
  expect((screen.getByRole("button", { name: "Select files" }) as HTMLButtonElement).disabled).toBe(false);
});

it("blocks closing and duplicate dialogs until file selection settles", async () => {
  let finish!: (paths: string[]) => void;
  vi.mocked(open).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const close = vi.fn();
  render(<BatchToolModal t={t} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Select files" }));
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Output folder" }));
  expect(close).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { finish(["/inputs/song.lrc"]); });
  expect(await screen.findByText("song.lrc")).toBeDefined();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps same-basename rows distinct when removing and reporting refreshed references", async () => {
  let finish!: (summary: BatchSummary) => void;
  vi.mocked(runBatchOperation).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<BatchToolModal t={t} onClose={vi.fn()} />);
  vi.mocked(open).mockResolvedValueOnce(["/a/song.lrc", "/b/song.lrc"]);
  fireEvent.click(screen.getByRole("button", { name: "Select files" }));
  await waitFor(() => expect(screen.getAllByText("song.lrc")).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button", { name: t.deleteLine })[0]);
  expect(screen.getAllByText("song.lrc")).toHaveLength(1);
  vi.mocked(open).mockResolvedValueOnce("/output");
  fireEvent.click(screen.getByRole("button", { name: "Output folder" }));
  await screen.findByText("/output");
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  const [entries, , , onStatus] = vi.mocked(runBatchOperation).mock.calls[0];
  expect(entries.map((entry) => entry.file.path)).toEqual(["/b/song.lrc"]);
  await act(async () => {
    onStatus(entries[0].id, "done", undefined, { path: "/b/moved.lrc", bookmark: "fresh" });
    finish({ done: 1, error: 0, cancelled: 0 });
  });
  expect(await screen.findByText("moved.lrc")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(vi.mocked(runBatchOperation).mock.calls[1][0][0]).toEqual(expect.objectContaining({ id: entries[0].id, file: { path: "/b/moved.lrc", bookmark: "fresh" } }));
  await act(async () => { finish({ done: 1, error: 0, cancelled: 0 }); });
});
