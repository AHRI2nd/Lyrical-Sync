// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor, within } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { ModelDownloadSection } from "./ModelDownloadSection";
import { useModelDownloadStore } from "../../stores/useModelDownloadStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { MODEL_DEFS } from "../../utils/modelDefs";

beforeEach(() => {
  invoke.mockReset().mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "check_model_files") return Promise.resolve([false]);
    return Promise.resolve(undefined);
  });
  useSettingsStore.setState({ modelsDir: "" });
  useModelDownloadStore.setState({
    modelsPath: "",
    operations: {},
    models: Object.fromEntries(MODEL_DEFS.map((model) => [model.id, { status: "not-installed", progress: 0 }])),
  });
});

afterEach(() => { cleanup(); });

it("shows preparation as a non-action state while an operation is being acquired", async () => {
  const model = MODEL_DEFS[0];
  let finishPreparation!: () => void;
  const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
  let finishDownload!: () => void;
  const download = new Promise<void>((resolve) => { finishDownload = resolve; });
  invoke.mockImplementation((command: string) => {
    if (command === "set_models_dir_override") return preparation;
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return download;
    return Promise.resolve(undefined);
  });
  const task = useModelDownloadStore.getState().installModel(model);
  const { getByText, getByRole } = render(<ModelDownloadSection />);
  await waitFor(() => expect(getByText(model.name)).toBeTruthy());
  await waitFor(() => expect(useModelDownloadStore.getState().models[model.id].status).toBe("preparing"));
  const modelRow = within(getByText(model.name).parentElement!.parentElement!);
  const installLabel = useI18nStore.getState().t.modelInstall;
  expect(modelRow.queryByText(installLabel)).toBeNull();
  expect(getByRole("button", { name: useI18nStore.getState().t.modelChangeDir })).toBeTruthy();
  finishPreparation();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("download_model", expect.anything()));
  finishDownload();
  await task;
});

it("keeps cancellation visible after the settings component remounts", async () => {
  const model = MODEL_DEFS[0];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return pending;
    return Promise.resolve(undefined);
  });
  const task = useModelDownloadStore.getState().installModel(model);
  const { getByText, unmount } = render(<ModelDownloadSection />);
  await waitFor(() => expect(getByText(model.name)).toBeTruthy());
  const firstRow = within(getByText(model.name).parentElement!.parentElement!);
  await waitFor(() => expect(firstRow.getByRole("button", { name: useI18nStore.getState().t.modelCancel })).toBeTruthy());
  unmount();
  const second = render(<ModelDownloadSection />);
  await waitFor(() => expect(second.getByText(model.name)).toBeTruthy());
  const secondRow = within(second.getByText(model.name).parentElement!.parentElement!);
  await waitFor(() => expect(secondRow.getByRole("button", { name: useI18nStore.getState().t.modelCancel })).toBeTruthy());
  expect(useModelDownloadStore.getState().operations[model.id]).toBeDefined();
  finish();
  await task;
});

it("does not expose model deletion while that model has an active job", async () => {
  const model = MODEL_DEFS[0];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return pending;
    return Promise.resolve(undefined);
  });
  const task = useModelDownloadStore.getState().installModel(model);
  const { getByText } = render(<ModelDownloadSection />);
  await waitFor(() => expect(getByText(model.name)).toBeTruthy());
  const modelRow = within(getByText(model.name).parentElement!.parentElement!);
  await waitFor(() => expect(modelRow.queryByText(useI18nStore.getState().t.modelDelete)).toBeNull());
  expect(invoke).not.toHaveBeenCalledWith("delete_model_files", expect.anything());
  finish();
  await task;
});
