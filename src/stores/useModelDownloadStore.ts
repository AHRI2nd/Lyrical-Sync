import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useBusyStore } from "./useBusyStore";
import { useI18nStore } from "./useI18nStore";
import { useSettingsStore } from "./useSettingsStore";
import { toast } from "./useToastStore";
import { MODEL_DEFS, type ModelDef } from "../utils/modelDefs";

export type ModelStatus = "checking" | "preparing" | "installed" | "not-installed" | "downloading" | "error";

export interface ModelUiState {
  status: ModelStatus;
  progress: number;
  error?: string;
  _actualTotalBytes?: number;
  _completedBytes?: number;
  _curFileIndex?: number;
  _curFileTotal?: number;
}

export interface ModelOperation {
  runId: string;
  modelId: string;
  root: string | null;
  promise: Promise<void>;
  status: "preparing" | "downloading" | "installed" | "not-installed" | "error";
  progress: number;
  cancelRequested: boolean;
  nativeStarted: boolean;
}

interface ProgressPayload {
  modelId: string;
  runId: string;
  fileIndex: number;
  fileCount: number;
  downloaded: number;
  total: number;
  done: boolean;
  error?: string;
}

interface ModelDownloadState {
  models: Record<string, ModelUiState>;
  modelsPath: string;
  operations: Record<string, ModelOperation>;
  installModel: (model: ModelDef) => Promise<void>;
  cancelModel: (modelId: string) => Promise<void>;
  refreshInstalled: () => Promise<void>;
}

const initialModels = (): Record<string, ModelUiState> => Object.fromEntries(
  MODEL_DEFS.map((model) => [model.id, { status: "checking", progress: 0 }]),
);

let operationSequence = 0;
let inventoryGeneration = 0;
let progressListenerPromise: Promise<UnlistenFn> | null = null;
const activeOperations = new Map<string, ModelOperation>();

function ensureProgressListener(): Promise<UnlistenFn> {
  if (!progressListenerPromise) {
    progressListenerPromise = listen<ProgressPayload>("model-download-progress", (event) => {
      const payload = event.payload;
      const operation = activeOperations.get(payload.modelId);
      if (!operation || operation.runId !== payload.runId || operation.status !== "downloading") return;

      if (payload.error) {
        updateOperation(operation, { progress: operation.progress }, { error: payload.error });
        return;
      }
      if (payload.done) {
        // Native completion precedes IPC settlement; keep the model busy until the invoke resolves.
        updateOperation(operation, { progress: 99 });
        return;
      }

      const current = useModelDownloadStore.getState().models[payload.modelId] ?? { status: "downloading", progress: 0 };
      const previousFile = current._curFileIndex ?? -1;
      let completedBytes = current._completedBytes ?? 0;
      if (payload.fileIndex > previousFile && (current._curFileTotal ?? 0) > 0) {
        completedBytes += current._curFileTotal ?? 0;
      }
      const model = MODEL_DEFS.find((item) => item.id === payload.modelId);
      if (!model) return;
      const estimate = model.totalSizeMb * 1024 * 1024;
      const denominator = estimate > 0 ? estimate : Math.max(completedBytes + (payload.total || payload.downloaded), 1);
      const progress = Math.min((completedBytes + payload.downloaded) / denominator * 100, 99);
      updateOperation(operation, { progress }, {
        progress,
        _completedBytes: completedBytes,
        _curFileIndex: payload.fileIndex,
        _curFileTotal: payload.total,
      });
    });
    progressListenerPromise.catch(() => { progressListenerPromise = null; });
  }
  return progressListenerPromise;
}

function updateOperation(
  operation: ModelOperation,
  patch: Partial<ModelOperation>,
  modelPatch?: Partial<ModelUiState>,
): void {
  const current = activeOperations.get(operation.modelId);
  if (!current || current.runId !== operation.runId) return;
  Object.assign(current, patch);
  useModelDownloadStore.setState((state) => ({
    operations: { ...state.operations, [operation.modelId]: { ...current } },
    models: modelPatch
      ? { ...state.models, [operation.modelId]: { ...state.models[operation.modelId], ...modelPatch } }
      : state.models,
  }));
}

async function refreshInventory(): Promise<void> {
  const generation = ++inventoryGeneration;
  const configuredRoot = useSettingsStore.getState().modelsDir || null;
  useModelDownloadStore.setState((state) => ({
    modelsPath: "",
    models: Object.fromEntries(Object.entries(state.models).map(([id, model]) => [
      id,
      activeOperations.has(id) ? model : { status: "checking" as const, progress: 0 },
    ])),
  }));
  try {
    await invoke("set_models_dir_override", { path: configuredRoot });
    const root = await invoke<string>("get_models_dir");
    if (generation !== inventoryGeneration || (useSettingsStore.getState().modelsDir || null) !== configuredRoot) return;
    useModelDownloadStore.setState({ modelsPath: root });

    const results = await Promise.all(MODEL_DEFS.map(async (model) => {
      if (activeOperations.has(model.id)) return null;
      try {
        const files = await invoke<boolean[]>("check_model_files", {
          expectedRoot: root,
          filenames: model.files.map((file) => file.filename),
          sha256: model.files.map((file) => file.sha256 ?? null),
        });
        return { model, installed: files.length === model.files.length && files.every(Boolean) };
      } catch {
        return { model, installed: false };
      }
    }));
    if (generation !== inventoryGeneration || (useSettingsStore.getState().modelsDir || null) !== configuredRoot) return;
    useModelDownloadStore.setState((state) => {
      const models = { ...state.models };
      for (const result of results) {
        if (!result || activeOperations.has(result.model.id)) continue;
        models[result.model.id] = { status: result.installed ? "installed" : "not-installed", progress: 0 };
      }
      return { models };
    });
  } catch (error) {
    if (generation !== inventoryGeneration) return;
    useModelDownloadStore.setState((state) => ({
      modelsPath: "",
      models: Object.fromEntries(Object.entries(state.models).map(([id, model]) => [
        id,
        activeOperations.has(id) ? model : { status: "error" as const, progress: 0, error: String(error) },
      ])),
    }));
  }
}

export const useModelDownloadStore = create<ModelDownloadState>((set, get) => ({
  models: initialModels(),
  modelsPath: "",
  operations: {},

  refreshInstalled: refreshInventory,

  installModel: (model) => {
    const existing = activeOperations.get(model.id);
    if (existing) return existing.promise;

    let resolveOperation!: () => void;
    const promise = new Promise<void>((resolve) => { resolveOperation = resolve; });
    const runId = `model-${Date.now()}-${++operationSequence}`;
    const operation: ModelOperation = {
      runId,
      modelId: model.id,
      root: null,
      promise,
      status: "preparing",
      progress: 0,
      cancelRequested: false,
      nativeStarted: false,
    };
    activeOperations.set(model.id, operation);
    useBusyStore.getState().markBusy(`model-download:${model.id}:${runId}`);
    set((state) => ({
      operations: { ...state.operations, [model.id]: operation },
      models: { ...state.models, [model.id]: { status: "preparing", progress: 0 } },
    }));

    void (async () => {
      const configuredRoot = useSettingsStore.getState().modelsDir || null;
      try {
        await invoke("set_models_dir_override", { path: configuredRoot });
        const root = await invoke<string>("get_models_dir");
        if ((useSettingsStore.getState().modelsDir || null) !== configuredRoot) throw new Error("models_root_changed");
        operation.root = root;
        updateOperation(operation, { root }, { status: "preparing", progress: 0 });

        // Subscribe before invoking the native job so the first progress event cannot be lost.
        await ensureProgressListener();
        if (activeOperations.get(model.id)?.runId !== runId) return;
        if (operation.cancelRequested) throw new Error("cancelled");
        await invoke("begin_model_download", { modelId: model.id, runId, expectedRoot: root });
        operation.nativeStarted = true;
        if (operation.cancelRequested) {
          await invoke("cancel_model_download", { modelId: model.id, runId });
          throw new Error("cancelled");
        }
        updateOperation(operation, { status: "downloading" }, { status: "downloading", progress: 0 });
        await invoke("download_model", {
          modelId: model.id,
          runId,
          expectedRoot: root,
          files: model.files.map((file) => ({ url: file.url, filename: file.filename, sha256: file.sha256 ?? null })),
        });
        if (activeOperations.get(model.id)?.runId !== runId) return;

        const rootStillSelected = (useSettingsStore.getState().modelsDir || null) === configuredRoot;
        updateOperation(operation, { status: "installed", progress: 100 }, {
          status: rootStillSelected ? "installed" : "not-installed",
          progress: rootStillSelected ? 100 : 0,
          _actualTotalBytes: rootStillSelected ? (get().models[model.id]?._completedBytes ?? 0) + (get().models[model.id]?._curFileTotal ?? 0) || undefined : undefined,
        });
        if (rootStillSelected) {
          const { t } = useI18nStore.getState();
          toast.success(t.toast.modelDownloaded.replace("{name}", model.name));
        } else {
          await get().refreshInstalled();
        }
      } catch (error) {
        if (activeOperations.get(model.id)?.runId !== runId) return;
        const cancelled = String(error) === "cancelled";
        updateOperation(operation, { status: cancelled ? "not-installed" : "error", progress: 0 }, {
          status: cancelled ? "not-installed" : "error",
          progress: 0,
          error: cancelled ? undefined : String(error),
        });
        if (!cancelled) {
          const { t } = useI18nStore.getState();
          toast.error(t.toast.modelDownloadFailed.replace("{name}", model.name));
        }
      } finally {
        if (activeOperations.get(model.id)?.runId === runId) activeOperations.delete(model.id);
        useBusyStore.getState().clearBusy(`model-download:${model.id}:${runId}`);
        set((state) => {
          if (state.operations[model.id]?.runId !== runId) return state;
          const operations = { ...state.operations };
          delete operations[model.id];
          return { operations };
        });
        resolveOperation();
      }
    })();
    return promise;
  },

  cancelModel: async (modelId) => {
    const operation = activeOperations.get(modelId);
    if (!operation) return;
    operation.cancelRequested = true;
    updateOperation(operation, {});
    if (!operation.nativeStarted) return;
    await invoke("cancel_model_download", { modelId, runId: operation.runId }).catch(() => {});
  },
}));
