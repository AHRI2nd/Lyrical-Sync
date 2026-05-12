import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type Translations } from "../../i18n/translations";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import {
  CATEGORY_ORDER,
  MODEL_DEFS,
  ModelCategory,
  ModelDef,
  formatSize,
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
  progress: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABEL_KEY: Record<ModelCategory, keyof Translations> = {
  demucs: "modelCategoryDemucs",
  ctc: "modelCategoryCTC",
  wav2vec2: "modelCategoryWav2vec2",
};

function ActionButton({
  status,
  onInstall,
  onCancel,
  onDelete,
  t,
}: {
  status: ModelStatus;
  onInstall: () => void;
  onCancel: () => void;
  onDelete: () => void;
  t: Translations;
}) {
  if (status === "checking") {
    return <span className="text-xs text-zinc-600 w-14 text-right">…</span>;
  }
  if (status === "downloading") {
    return (
      <button
        onClick={onCancel}
        className="px-2.5 py-1 text-xs rounded-md bg-zinc-600 hover:bg-zinc-500 text-zinc-200 transition-colors shrink-0"
      >
        {t.modelCancel}
      </button>
    );
  }
  if (status === "installed") {
    return (
      <button
        onClick={onDelete}
        className="px-2.5 py-1 text-xs rounded-md bg-zinc-700 hover:bg-red-700 text-zinc-300 hover:text-white transition-colors shrink-0"
      >
        {t.modelDelete}
      </button>
    );
  }
  return (
    <button
      onClick={onInstall}
      className={[
        "px-2.5 py-1 text-xs rounded-md text-white transition-colors shrink-0",
        status === "error" ? "bg-red-700 hover:bg-red-600" : "bg-indigo-600 hover:bg-indigo-500",
      ].join(" ")}
    >
      {t.modelInstall}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ModelDownloadSection() {
  const { t, lang } = useI18nStore();
  const { modelsDir, setModelsDir } = useSettingsStore();

  const [states, setStates] = useState<Record<string, ModelState>>(() =>
    Object.fromEntries(MODEL_DEFS.map((m) => [m.id, { status: "checking", progress: 0 }]))
  );
  const [modelsPath, setModelsPath] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const init = async () => {
      await invoke("set_models_dir_override", { path: modelsDir || null }).catch(() => {});
      const path = await invoke<string>("get_models_dir").catch(() => "");
      setModelsPath(path);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkInstalled = async () => {
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

  useEffect(() => { checkInstalled(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unlistenRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    listen<ProgressPayload>("model-download-progress", (event) => {
      const p = event.payload;
      setStates((prev) => {
        if (p.error) return { ...prev, [p.modelId]: { status: "error", progress: 0, error: p.error } };
        if (p.done) return { ...prev, [p.modelId]: { status: "installed", progress: 100 } };
        const filePct = p.total > 0 ? p.downloaded / p.total : 0;
        const overall = ((p.fileIndex + filePct) / p.fileCount) * 100;
        return { ...prev, [p.modelId]: { status: "downloading", progress: Math.min(overall, 99) } };
      });
    }).then((fn) => { unlistenRef.current = fn; });
    return () => { unlistenRef.current?.(); };
  }, []);

  const handleInstall = async (model: ModelDef) => {
    setStates((prev) => ({ ...prev, [model.id]: { status: "downloading", progress: 0 } }));
    try {
      await invoke("download_model", {
        modelId: model.id,
        files: model.files.map((f) => ({ url: f.url, filename: f.filename })),
      });
    } catch (e) {
      if (String(e) === "cancelled") {
        setStates((prev) => ({ ...prev, [model.id]: { status: "not-installed", progress: 0 } }));
      }
    }
  };

  const handleCancel = async (id: string) => {
    await invoke("cancel_model_download", { modelId: id }).catch(() => {});
  };

  const handleDelete = async (model: ModelDef) => {
    try {
      await invoke("delete_model_files", { filenames: model.files.map((f) => f.filename) });
      setStates((prev) => ({ ...prev, [model.id]: { status: "not-installed", progress: 0 } }));
    } catch (e) {
      setStates((prev) => ({ ...prev, [model.id]: { status: "error", progress: 0, error: String(e) } }));
    }
  };

  const handleCopyPath = async () => {
    if (!modelsPath) return;
    await navigator.clipboard.writeText(modelsPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handlePickDir = async () => {
    const selected = await openDialog({ directory: true, multiple: false }).catch(() => null);
    if (!selected || typeof selected !== "string") return;
    setModelsDir(selected);
    await invoke("set_models_dir_override", { path: selected }).catch(() => {});
    const newPath = await invoke<string>("get_models_dir").catch(() => selected);
    setModelsPath(newPath);
    checkInstalled();
  };

  const handleResetDir = async () => {
    setModelsDir("");
    await invoke("set_models_dir_override", { path: null }).catch(() => {});
    const defaultPath = await invoke<string>("get_models_dir").catch(() => "");
    setModelsPath(defaultPath);
    checkInstalled();
  };

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    models: MODEL_DEFS.filter((m) => m.category === cat),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Storage path */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">{t.modelStoragePath}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 flex-1 min-w-0 truncate bg-zinc-800 rounded px-2 py-1.5">
            {modelsPath || "…"}
          </span>
          <button
            onClick={handleCopyPath}
            disabled={!modelsPath}
            className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-400 transition-colors shrink-0 disabled:opacity-40"
          >
            {copied ? "✓" : t.modelCopyPath}
          </button>
          <button
            onClick={handlePickDir}
            className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors shrink-0"
          >
            {t.modelChangeDir}
          </button>
          {modelsDir && (
            <button
              onClick={handleResetDir}
              className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-400 transition-colors shrink-0"
            >
              {t.modelResetDir}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-amber-300 bg-amber-900/40 font-semibold text-[10px]">
            {t.modelRequired}
          </span>
          <span className="text-zinc-500">AI 기능 동작에 필수</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-zinc-400 bg-zinc-700/60 font-semibold text-[10px]">
            {t.modelOptional}
          </span>
          <span className="text-zinc-500">설치 시 품질 향상</span>
        </span>
      </div>

      {/* Model list */}
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
    status === "installed" ? "✓"
    : status === "downloading" ? "↓"
    : status === "error" ? "✕"
    : "·";
  const iconColor =
    status === "installed" ? "text-emerald-400"
    : status === "downloading" ? "text-indigo-400"
    : status === "error" ? "text-red-400"
    : "text-zinc-600";

  return (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5 flex flex-col gap-1.5">
      {/* Top row: icon / name / badge / size / ACTION BUTTON */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-mono w-3 shrink-0 ${iconColor}`}>{statusIcon}</span>
        <span className="text-sm font-medium text-zinc-100 flex-1 min-w-0 truncate">{model.name}</span>
        {model.required ? (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-amber-300 bg-amber-900/40 shrink-0">
            {t.modelRequired}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-zinc-400 bg-zinc-700/60 shrink-0">
            {t.modelOptional}
          </span>
        )}
        <span className="text-xs text-zinc-500 tabular-nums shrink-0">
          {formatSize(model.totalSizeMb)}
        </span>
        <ActionButton
          status={status}
          onInstall={onInstall}
          onCancel={onCancel}
          onDelete={onDelete}
          t={t}
        />
      </div>

      <p className="text-xs text-zinc-500 pl-4">{desc}</p>

      {status === "downloading" && (
        <div className="pl-4 flex items-center gap-2">
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

      {status === "error" && error && (
        <p className="text-xs text-red-400 pl-4">
          {t.modelErrorPrefix}: {error}
        </p>
      )}
    </div>
  );
}
