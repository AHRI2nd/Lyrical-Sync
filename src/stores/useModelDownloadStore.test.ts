// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));

import { useModelDownloadStore } from "./useModelDownloadStore";
import { useBusyStore } from "./useBusyStore";
import { useSettingsStore } from "./useSettingsStore";
import { MODEL_DEFS } from "../utils/modelDefs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let progressListener: ((event: { payload: any }) => void) | undefined;
let download: ReturnType<typeof deferred<void>>;

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset().mockImplementation(async (_event: string, callback: typeof progressListener) => {
    progressListener = callback;
    return () => {};
  });
  download = deferred<void>();
  useBusyStore.setState({ reasons: new Set() });
  useSettingsStore.setState({ modelsDir: "" });
  useModelDownloadStore.setState({ operations: {}, modelsPath: "", models: {} });
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "check_model_files") return Promise.resolve([false]);
    if (command === "download_model") return download.promise;
    return Promise.resolve(undefined);
  });
});

it("keeps one model operation and one busy lease across duplicate requests", async () => {
  const pending = deferred<void>();
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return pending.promise;
    return Promise.resolve(undefined);
  });
  const model = MODEL_DEFS[0];
  const first = useModelDownloadStore.getState().installModel(model);
  const duplicate = useModelDownloadStore.getState().installModel(model);
  expect(duplicate).toBe(first);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("download_model", expect.objectContaining({ expectedRoot: "/models/default", runId: expect.any(String) })));
  expect(useBusyStore.getState().reasons.size).toBe(1);
  expect(invoke.mock.calls.filter(([command]) => command === "download_model")).toHaveLength(1);
  pending.resolve();
  await first;
  expect(useBusyStore.getState().reasons.size).toBe(0);
  expect(useModelDownloadStore.getState().models[model.id].status).toBe("installed");
});

it("keeps independent models busy when one operation completes", async () => {
  const downloads = new Map<string, ReturnType<typeof deferred<void>>>();
  invoke.mockImplementation((command: string, args?: { modelId?: string }) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") {
      const pending = deferred<void>();
      downloads.set(args?.modelId ?? "", pending);
      return pending.promise;
    }
    return Promise.resolve(undefined);
  });
  const [firstModel, secondModel] = MODEL_DEFS;
  const first = useModelDownloadStore.getState().installModel(firstModel);
  const second = useModelDownloadStore.getState().installModel(secondModel);
  await vi.waitFor(() => expect(downloads.size).toBe(2));
  expect(useBusyStore.getState().reasons.size).toBe(2);
  downloads.get(firstModel.id)?.resolve();
  await first;
  expect(useBusyStore.getState().reasons.size).toBe(1);
  downloads.get(secondModel.id)?.resolve();
  await second;
  expect(useBusyStore.getState().reasons.size).toBe(0);
});

it("does not let an old run progress event mutate a replacement run", async () => {
  const pending = deferred<void>();
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return pending.promise;
    return Promise.resolve(undefined);
  });
  const model = MODEL_DEFS[0];
  const task = useModelDownloadStore.getState().installModel(model);
  await vi.waitFor(() => expect(progressListener).toBeTypeOf("function"));
  await vi.waitFor(() => expect(useModelDownloadStore.getState().operations[model.id]?.status).toBe("downloading"));
  const runId = useModelDownloadStore.getState().operations[model.id].runId;
  progressListener?.({ payload: { modelId: model.id, runId: "old-run", fileIndex: 0, fileCount: 1, downloaded: 999, total: 1000, done: false } });
  expect(useModelDownloadStore.getState().operations[model.id].progress).toBe(0);
  progressListener?.({ payload: { modelId: model.id, runId, fileIndex: 0, fileCount: 1, downloaded: 500, total: 1000, done: false } });
  expect(useModelDownloadStore.getState().operations[model.id].progress).toBeGreaterThan(0);
  pending.resolve();
  await task;
});

it("keeps the active operation busy until native cancellation settles", async () => {
  const pending = deferred<void>();
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return pending.promise;
    return Promise.resolve(undefined);
  });
  const model = MODEL_DEFS[0];
  const task = useModelDownloadStore.getState().installModel(model);
  await vi.waitFor(() => expect(useModelDownloadStore.getState().operations[model.id]?.status).toBe("downloading"));
  const runId = useModelDownloadStore.getState().operations[model.id].runId;
  await useModelDownloadStore.getState().cancelModel(model.id);
  expect(invoke).toHaveBeenCalledWith("cancel_model_download", { modelId: model.id, runId });
  expect(useBusyStore.getState().reasons.size).toBe(1);
  pending.reject("cancelled");
  await task;
  expect(useBusyStore.getState().reasons.size).toBe(0);
});

it("does not overwrite an active install with a late inventory response", async () => {
  const inventory = deferred<boolean[]>();
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "check_model_files") return inventory.promise;
    if (command === "download_model") return download.promise;
    return Promise.resolve(undefined);
  });
  const model = MODEL_DEFS[0];
  const refresh = useModelDownloadStore.getState().refreshInstalled();
  const install = useModelDownloadStore.getState().installModel(model);
  await vi.waitFor(() => expect(useModelDownloadStore.getState().operations[model.id]?.status).toBe("downloading"));
  inventory.resolve([true]);
  await refresh;
  expect(useModelDownloadStore.getState().models[model.id].status).toBe("downloading");
  download.resolve();
  await install;
});

it("hides stale inventory while resolving the current model root", async () => {
  const root = deferred<string>();
  useModelDownloadStore.setState({
    modelsPath: "/models/old",
    models: Object.fromEntries(MODEL_DEFS.map((model) => [model.id, { status: "installed", progress: 100 }])),
  });
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return root.promise;
    if (command === "check_model_files") return Promise.resolve([false]);
    return Promise.resolve(undefined);
  });

  const refresh = useModelDownloadStore.getState().refreshInstalled();
  expect(useModelDownloadStore.getState().modelsPath).toBe("");
  expect(useModelDownloadStore.getState().models[MODEL_DEFS[0].id].status).toBe("checking");
  root.resolve("/models/current");
  await refresh;

  expect(invoke).toHaveBeenCalledWith("check_model_files", expect.objectContaining({
    expectedRoot: "/models/current",
    sha256: [MODEL_DEFS[0].files[0].sha256],
  }));
  expect(useModelDownloadStore.getState().modelsPath).toBe("/models/current");
});

it("rejects a root that changes while the operation is preparing", async () => {
  const root = deferred<string>();
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return root.promise;
    return Promise.resolve(undefined);
  });
  const task = useModelDownloadStore.getState().installModel(MODEL_DEFS[0]);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("get_models_dir"));
  useSettingsStore.setState({ modelsDir: "/models/changed" });
  root.resolve("/models/default");
  await task;
  expect(invoke).not.toHaveBeenCalledWith("download_model", expect.anything());
  expect(useModelDownloadStore.getState().models[MODEL_DEFS[0].id].status).toBe("error");
});

it("allows retry after a failed download and gives the retry a new run ID", async () => {
  const retry = deferred<void>();
  let attempts = 0;
  invoke.mockImplementation((command: string) => {
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "download_model") return ++attempts === 1 ? Promise.reject(new Error("network")) : retry.promise;
    return Promise.resolve(undefined);
  });
  const model = MODEL_DEFS[0];
  await useModelDownloadStore.getState().installModel(model);
  expect(useModelDownloadStore.getState().models[model.id].status).toBe("error");

  const second = useModelDownloadStore.getState().installModel(model);
  await vi.waitFor(() => expect(attempts).toBe(2));
  const calls = invoke.mock.calls.filter(([command]) => command === "download_model");
  expect(calls[1][1].runId).not.toBe(calls[0][1].runId);
  expect(useBusyStore.getState().reasons.size).toBe(1);
  retry.resolve();
  await second;
  expect(useModelDownloadStore.getState().models[model.id].status).toBe("installed");
});
