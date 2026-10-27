// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useI18nStore } from "../../stores/useI18nStore";
import { SRT_UNREPRESENTABLE_CONTENT_CODE } from "../../utils/srtConverter";
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
