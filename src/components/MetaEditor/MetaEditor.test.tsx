// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { MetaEditor } from "./MetaEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { defaultDocument } from "../../types/lrc";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps metadata and local raw lyrics editing available without online lookup", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  useLrcStore.setState({ doc: defaultDocument(), isDirty: false, _history: [], _future: [] });
  const { container, getByTitle, getAllByRole } = render(<MetaEditor />);
  expect(container.textContent).not.toContain("LRCLIB");
  fireEvent.change(getAllByRole("textbox")[0], { target: { value: "Local song" } });
  expect(useLrcStore.getState().doc.metadata.title).toBe("Local song");
  fireEvent.click(getByTitle(useI18nStore.getState().t.viewAll));
  expect(container.querySelector("textarea")?.value).toContain("Local song");
  expect(fetch).not.toHaveBeenCalled();
});
