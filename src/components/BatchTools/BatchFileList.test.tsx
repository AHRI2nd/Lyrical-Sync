// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useI18nStore } from "../../stores/useI18nStore";
import { SRT_UNREPRESENTABLE_CONTENT_CODE } from "../../utils/srtConverter";
import { VTT_UNREPRESENTABLE_CONTENT_CODE } from "../../utils/exportFormats";
import { BatchFileList } from "./BatchFileList";

afterEach(() => cleanup());

it("localizes the SRT paragraph export error in the batch row", () => {
  const t = useI18nStore.getState().t;
  render(<BatchFileList
    t={t}
    entries={[{ id: "file", file: { path: "/input/song.lrc", bookmark: "" }, status: "error", error: SRT_UNREPRESENTABLE_CONTENT_CODE }]}
    onRemove={() => {}}
    disabled={false}
  />);

  expect(screen.getByText(t.toast.srtBlankRowsUnsupported)).toBeTruthy();
});

it("localizes unrepresentable ASS text in the batch row", () => {
  const t = useI18nStore.getState().t;
  render(<BatchFileList
    t={t}
    entries={[{ id: "file", file: { path: "/input/song.lrc", bookmark: "" }, status: "error", error: "ASS_UNREPRESENTABLE_CONTENT" }]}
    onRemove={() => {}}
    disabled={false}
  />);

  expect(screen.getByText(t.toast.assUnrepresentableContent)).toBeTruthy();
});

it("localizes an unrepresentable VTT paragraph in the batch row", () => {
  const t = useI18nStore.getState().t;
  render(<BatchFileList
    t={t}
    entries={[{ id: "file", file: { path: "/input/song.lrc", bookmark: "" }, status: "error", error: VTT_UNREPRESENTABLE_CONTENT_CODE }]}
    onRemove={() => {}}
    disabled={false}
  />);

  expect(screen.getByText(t.toast.vttBlankRowsUnsupported)).toBeTruthy();
});

it("explains that a batch output may exist when directory durability is uncertain", () => {
  const t = useI18nStore.getState().t;
  render(<BatchFileList
    t={t}
    entries={[{ id: "file", file: { path: "/output/song.lrc", bookmark: "" }, status: "error", error: "BATCH_OUTPUT_DURABILITY_UNCERTAIN: sync failed" }]}
    onRemove={() => {}}
    disabled={false}
  />);

  expect(screen.getByText(t.toast.batchOutputDurabilityUncertain)).toBeTruthy();
});

it("gives each batch removal control a unique filename-based accessible name", () => {
  const t = useI18nStore.getState().t;
  const onRemove = vi.fn();
  render(<BatchFileList
    t={t}
    entries={[
      { id: "first", file: { path: "/private/one/song.lrc", bookmark: "" }, status: "pending" },
      { id: "second", file: { path: "C:\\private\\two\\song.lrc", bookmark: "" }, status: "pending" },
    ]}
    onRemove={onRemove}
    disabled={false}
  />);

  const first = screen.getByRole("button", { name: `${t.deleteLine}: song.lrc (1)` });
  const second = screen.getByRole("button", { name: `${t.deleteLine}: song.lrc (2)` });
  fireEvent.click(second);

  expect(first.hasAttribute("disabled")).toBe(false);
  expect(onRemove).toHaveBeenCalledExactlyOnceWith("second");
  expect(screen.queryByRole("button", { name: /private/ })).toBeNull();
});

it("keeps batch removal controls disabled while processing", () => {
  const t = useI18nStore.getState().t;
  render(<BatchFileList
    t={t}
    entries={[{ id: "first", file: { path: "/input/song.lrc", bookmark: "" }, status: "processing" }]}
    onRemove={() => {}}
    disabled
  />);

  expect(screen.getByRole("button", { name: `${t.deleteLine}: song.lrc` }).hasAttribute("disabled")).toBe(true);
});
