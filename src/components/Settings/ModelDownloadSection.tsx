import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type Translations } from "../../i18n/translations";
import { useI18nStore } from "../../stores/useI18nStore";
import {
  CATEGORY_ORDER,
  MODEL_DEFS,
  ModelCategory,
  ModelDef,
} from "../../utils/modelDefs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressPayload {
  modelId: string;
  fileIndex: number;
  fileCount: number;
  downloaded: number;
  total: number;
  done: boolean;
  error?: string;
}

type ModelStatus = "checking" | "installed" | "not-installed" | "downloading" | "error";

interface ModelState {
  status: ModelStatus;
  progress: number; // 0–100
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABEL_KEY: Record<ModelCategory, keyof Translations> = {
  demucs: "modelCategoryDemucs",
  whisper: "modelCategoryWhisper",
  wav2vec2: "modelCategoryWav2vec2",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ModelDownloadSection() {
  const { t, lang } = useI18nStore();
  const [states, setStates] = useState<Record<string, ModelState>>(() =>
    Object.fromEntries(MODEL_DEFS.map((m) => [m.id, { status: "checking", progress: 0 }]))
  );
  const [modelsPath, setModelsPath] = useState<string>("");

  // Fetch models dir path once
  useEffect(() => {
    invoke<string>("get_models_dir").then(setModelsPath).catch(() => {});
  }, []);

  // Check installed status for all models
  useEffect(() => {
    const check = async () => {
      for (const model of MODEL_DEFS) {
        const filenames = model.files.map((f) => f.filename);
        try {
          const results = await invoke<boolean[]>("check_model_files", { filenames });
          const installed = results.every(Boolean);
          setStates((prev) => ({
            ...prev,
            [model.id]: { status: installed ? "installed" : "not-installed", progress: 0 },
          }));
        } catch {
          setStates((prev) => ({
            ...prev,
            [model.id]: { status: "not-installed", progress: 0 },
          }));
        }
      }
    };
    check();
  }, []);

  // Listen to download progress events
  const unlistenRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    listen<ProgressPayload>("model-download-progress", (event) => {
      const p = event.payload;
      setStates((prev) => {
        if (p.error) {
          return {
            ...prev,
            [p.modelId]: { status: "error", progress: 0, error: p.error },
          };
        }
        if (p.done) {
          return {
            ...prev,
            [p.modelId]: { status: "installed", progress: 100 },
          };
        }
        // overall progress across all files
        const filePct = p.total > 0 ? p.downloaded / p.total : 0;
        const overall = ((p.fileIndex + filePct) / p.fileCount) * 100;
        return {
          ...prev,
          [p.modelId]: { status: "downloading", progress: Math.min(overall, 99) },
        };
      });
    }).then((fn) => {
      unlistenRef.current = fn;
    });
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const handleInstall = async (model: ModelDef) => {
    setStates((prev) => ({ ...prev, [model.id]: { status: "downloading", progress: 0 } }));
    try {
      await invoke("download_model", {
        modelId: model.id,
        files: model.files.map((f) => ({ url: f.url, filename: f.filename })),
      });
    } catch (e) {
      const msg = String(e);
      if (msg === "cancelled") {
        setStates((prev) => ({ ...prev, [model.id]: { status: "not-installed", progress: 0 } }));
      }
      // error case is handled via the progress event
    }
  };

  const handleCancel = async (modelId: string) => {
    await invoke("cancel_model_download", { modelId }).catch(() => {});
  };

  const handleDelete = async (model: ModelDef) => {
    try {
      await invoke("delete_model_files", { filenames: model.files.map((f) => f.filename) });
      setStates((prev) => ({ ...prev, [model.id]: { status: "not-installed", progress: 0 } }));
    } catch (e) {
      setStates((prev) => ({ ...prev, [model.id]: { status: "error", progress: 0, error: String(e) } }));
    }
  };

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    models: MODEL_DEFS.filter((m) => m.category === cat),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Storage path */}
      {modelsPath && (
        <div className="text-xs text-zinc-500 break-all">
          <span className="text-zinc-400">{t.modelStoragePath}: </span>
          {modelsPath}
        </div>
      )}

      {grouped.map(({ cat, models }) => (
        <div key={cat} className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
            {String(t[CATEGORY_LABEL_KEY[cat]])}
          </div>

          <div className="flex flex-col gap-1.5">
            {models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                state={states[model.id] ?? { status: "checking", progress: 0 }}
                lang={lang}
                t={t}
                onInstall={() => handleInstall(model)}
                onCancel={() => handleCancel(model.id)}
                onDelete={() => handleDelete(model)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ModelRow ─────────────────────────────────────────────────────────────────

function ModelRow({
  model,
  state,
  lang,
  t,
  onInstall,
  onCancel,
  onDelete,
}: {
  model: ModelDef;
  state: ModelState;
  lang: string;
  t: Translations;
  onInstall: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const desc = model.description[lang as "ko" | "en" | "ja"] ?? model.description.en;
  const { status, progress, error } = state;

  const statusIcon =
    status === "installed"
      ? "✓"
      : status === "downloading"
        ? "↓"
        : status === "error"
          ? "✕"
          : "·";

  const iconColor =
    status === "installed"
      ? "text-emerald-400"
      : status === "downloading"
        ? "text-indigo-400"
        : status === "error"
          ? "text-red-400"
          : "text-zinc-600";

  return (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5 flex flex-col gap-1.5">
      {/* Top row: icon + name + size + action */}
      <div className="flex items-center gap-2">
        <span className={`text-sm font-mono w-3 shrink-0 ${iconColor}`}>{statusIcon}</span>
        <span className="text-sm font-medium text-zinc-100 flex-1 min-w-0 truncate">
          {model.name}
        </span>
        <span className="text-xs text-zinc-500 shrink-0 tabular-nums">
          {model.totalSizeMb} {t.modelMb}
        </span>

        {status === "checking" && (
          <span className="text-xs text-zinc-600 shrink-0">…</span>
        )}
        {status === "not-installed" && (
          <button
            onClick={onInstall}
            className="px-2.5 py-1 text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shrink-0"
          >
            {t.modelInstall}
          </button>
        )}
        {status === "downloading" && (
          <button
            onClick={onCancel}
            className="px-2.5 py-1 text-xs rounded-md bg-zinc-600 hover:bg-zinc-500 text-zinc-200 transition-colors shrink-0"
          >
            {t.modelCancel}
          </button>
        )}
        {status === "installed" && (
          <button
            onClick={onDelete}
            className="px-2.5 py-1 text-xs rounded-md bg-zinc-700 hover:bg-red-700 text-zinc-300 hover:text-white transition-colors shrink-0"
          >
            {t.modelDelete}
          </button>
        )}
        {status === "error" && (
          <button
            onClick={onInstall}
            className="px-2.5 py-1 text-xs rounded-md bg-red-700 hover:bg-red-600 text-white transition-colors shrink-0"
          >
            {t.modelInstall}
          </button>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-500 pl-5">{desc}</p>

      {/* Progress bar */}
      {status === "downloading" && (
        <div className="pl-5 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-200"
              style={{ width: `${progress.toFixed(1)}%` }}
            />
          </div>
          <span className="text-xs text-zinc-400 tabular-nums w-9 text-right">
            {progress.toFixed(0)}%
          </span>
        </div>
      )}

      {/* Error message */}
      {status === "error" && error && (
        <p className="text-xs text-red-400 pl-5">
          {t.modelErrorPrefix}: {error}
        </p>
      )}
    </div>
  );
}
