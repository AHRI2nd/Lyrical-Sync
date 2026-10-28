import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type Translations } from "../../i18n/translations";
import { useI18nStore } from "../../stores/useI18nStore";
import { useModelDownloadStore, type ModelStatus } from "../../stores/useModelDownloadStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import {
  CATEGORY_ORDER,
  MODEL_DEFS,
  ModelCategory,
  ModelDef,
  formatSize,
} from "../../utils/modelDefs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelState {
  status: ModelStatus;
  progress: number;
  error?: string;
  // Internal byte-level progress tracking for accurate weighted display
  _completedBytes?: number;
  _curFileIndex?: number;
  _curFileTotal?: number;
  /** Actual total bytes measured from Content-Length headers (set when download completes) */
  _actualTotalBytes?: number;
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
  if (status === "checking" || status === "preparing") {
    return <span className="text-xs text-[var(--ls-text-secondary)] w-14 text-right">…</span>;
  }
  if (status === "downloading") {
    return (
      <button
        onClick={onCancel}
        className="ls-button text-xs transition-colors shrink-0"
      >
        {t.modelCancel}
      </button>
    );
  }
  if (status === "installed") {
    return (
      <button
        onClick={onDelete}
        className="ls-button text-xs hover:bg-red-700 hover:text-white transition-colors shrink-0"
      >
        {t.modelDelete}
      </button>
    );
  }
  return (
    <button
      onClick={onInstall}
      className={`ls-button ${[
        "px-2.5 py-1 text-xs rounded-md text-white transition-colors shrink-0",
        status === "error" ? "bg-red-700 hover:bg-red-600" : "bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)]",
      ].join(" ")}`}
    >
      {t.modelInstall}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ModelDownloadSection() {
  const { t, lang } = useI18nStore();
  const { modelsDir, setModelsDir, useVocalSeparation, setUseVocalSeparation, useVad, setUseVad } = useSettingsStore();

  const states = useModelDownloadStore((state) => state.models);
  const modelsPath = useModelDownloadStore((state) => state.modelsPath);
  const refreshInstalled = useModelDownloadStore((state) => state.refreshInstalled);
  const installModel = useModelDownloadStore((state) => state.installModel);
  const cancelModel = useModelDownloadStore((state) => state.cancelModel);
  const [copied, setCopied] = useState(false);
  useEffect(() => { void refreshInstalled(); }, [refreshInstalled]);

  const handleInstall = (model: ModelDef) => { void installModel(model); };
  const handleCancel = (id: string) => { void cancelModel(id); };

  const handleDelete = async (model: ModelDef) => {
    if (useModelDownloadStore.getState().operations[model.id]) return;
    try {
      await invoke("delete_model_files", { filenames: model.files.map((f) => f.filename) });
      await refreshInstalled();
    } catch (e) {
      useModelDownloadStore.setState((state) => ({
        models: { ...state.models, [model.id]: { status: "error", progress: 0, error: String(e) } },
      }));
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
    await refreshInstalled();
  };

  const handleResetDir = async () => {
    setModelsDir("");
    await refreshInstalled();
  };

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    models: MODEL_DEFS.filter((m) => m.category === cat).sort((a, b) => Number(b.required) - Number(a.required)),
  })).filter((g) => g.models.length > 0).sort((a, b) => {
    const aReq = a.models.some((m) => m.required) ? 1 : 0;
    const bReq = b.models.some((m) => m.required) ? 1 : 0;
    return bReq - aReq;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Storage path */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--ls-text-secondary)]">{t.modelStoragePath}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--ls-text-secondary)] flex-1 min-w-0 truncate bg-[var(--ls-control)] rounded px-2 py-1.5">
            {modelsPath || "…"}
          </span>
          <button
            onClick={handleCopyPath}
            disabled={!modelsPath}
            className="ls-button text-xs transition-colors shrink-0 disabled:opacity-40"
          >
            {copied ? "✓" : t.modelCopyPath}
          </button>
          <button
            onClick={handlePickDir}
            className="ls-button text-xs transition-colors shrink-0"
          >
            {t.modelChangeDir}
          </button>
          {modelsDir && (
            <button
              onClick={handleResetDir}
              className="ls-button text-xs transition-colors shrink-0"
            >
              {t.modelResetDir}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[var(--ls-playhead)] bg-[var(--ls-playhead)]/40 font-semibold text-[10px]">
            {t.modelRequired}
          </span>
          <span className="text-[var(--ls-text-secondary)]">{t.modelRequiredHint}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[var(--ls-text-secondary)] bg-[var(--ls-control)]/60 font-semibold text-[10px]">
            {t.modelOptional}
          </span>
          <span className="text-[var(--ls-text-secondary)]">{t.modelOptionalHint}</span>
        </span>
      </div>

      <div className="border-t border-[var(--ls-border-subtle)]" />

      {/* 정렬에 사용 (선택) */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-[var(--ls-text-secondary)] uppercase tracking-wide">{t.aiUsageTitle}</span>
        {(() => {
          const demucsInstalled = states["demucs-htdemucs"]?.status === "installed";
          const sepActive = useVocalSeparation && demucsInstalled;
          return (
            <div className="flex flex-col gap-2">
              <label className={`flex items-start gap-2 text-sm ${demucsInstalled ? "text-[var(--ls-text)] cursor-pointer" : "text-[var(--ls-text-secondary)] cursor-not-allowed"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--ls-accent)] w-3.5 h-3.5 shrink-0"
                  checked={sepActive}
                  disabled={!demucsInstalled}
                  onChange={(e) => setUseVocalSeparation(e.target.checked)}
                />
                <span className="flex flex-col">
                  <span>{t.aiUsageSeparation}</span>
                  <span className="text-xs text-[var(--ls-text-secondary)]">{demucsInstalled ? t.aiUsageSeparationDesc : t.aiUsageNeedModel}</span>
                </span>
              </label>
              <label className={`flex items-start gap-2 text-sm ${sepActive ? "text-[var(--ls-text)] cursor-pointer" : "text-[var(--ls-text-secondary)] cursor-not-allowed"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--ls-accent)] w-3.5 h-3.5 shrink-0"
                  checked={useVad && sepActive}
                  disabled={!sepActive}
                  onChange={(e) => setUseVad(e.target.checked)}
                />
                <span className="flex flex-col">
                  <span>{t.aiUsageVad}</span>
                  <span className="text-xs text-[var(--ls-text-secondary)]">{sepActive ? t.aiUsageVadDesc : t.aiUsageNeedSeparation}</span>
                </span>
              </label>
            </div>
          );
        })()}
      </div>

      {/* Model list */}
      {grouped.map(({ cat, models }) => (
        <div key={cat} className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-[var(--ls-text-secondary)] uppercase tracking-wide">
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

  // Prefer actual measured size over static estimate
  const displaySizeMb = state._actualTotalBytes
    ? state._actualTotalBytes / (1024 * 1024)
    : model.totalSizeMb;

  const statusIcon =
    status === "installed" ? "✓"
    : status === "downloading" ? "↓"
    : status === "preparing" ? "…"
    : status === "error" ? "✕"
    : "·";
  const iconColor =
    status === "installed" ? "text-emerald-400"
    : status === "downloading" || status === "preparing" ? "text-[var(--ls-accent)]"
    : status === "error" ? "text-red-400"
    : "text-[var(--ls-text-secondary)]";

  return (
    <div className="bg-[var(--ls-control)]/50 rounded-lg px-3 py-2.5 flex flex-col gap-1.5">
      {/* Top row: icon / name / badge / size / ACTION BUTTON */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-mono w-3 shrink-0 ${iconColor}`}>{statusIcon}</span>
        <span className="text-sm font-medium text-[var(--ls-text)] flex-1 min-w-0 truncate">{model.name}</span>
        {model.required ? (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-[var(--ls-playhead)] bg-[var(--ls-playhead)]/40 shrink-0">
            {t.modelRequired}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-[var(--ls-text-secondary)] bg-[var(--ls-control)]/60 shrink-0">
            {t.modelOptional}
          </span>
        )}
        <span
          className={`text-xs tabular-nums shrink-0 ${state._actualTotalBytes ? "text-[var(--ls-text-secondary)]" : "text-[var(--ls-text-secondary)]"}`}
          title={state._actualTotalBytes ? undefined : "Estimated size"}
        >
          {state._actualTotalBytes ? formatSize(displaySizeMb) : `~${formatSize(displaySizeMb)}`}
        </span>
        <ActionButton
          status={status}
          onInstall={onInstall}
          onCancel={onCancel}
          onDelete={onDelete}
          t={t}
        />
      </div>

      <p className="text-xs text-[var(--ls-text-secondary)] pl-4">{desc}</p>

      {status === "downloading" && (
        <div className="pl-4 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[var(--ls-control)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--ls-accent)] rounded-full"
              style={{ width: `${progress.toFixed(1)}%` }}
            />
          </div>
          <span className="text-xs text-[var(--ls-text-secondary)] tabular-nums w-9 text-right">
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
