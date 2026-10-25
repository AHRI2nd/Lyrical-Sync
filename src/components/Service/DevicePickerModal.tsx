import { useEffect, useState, useCallback } from "react";
import { useServiceStore, type SpotifyDevice } from "../../stores/useServiceStore";
import { useI18nStore } from "../../stores/useI18nStore";

export function DevicePickerModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const fetchDevices = useServiceStore((s) => s.fetchDevices);
  const transferToDevice = useServiceStore((s) => s.transferToDevice);
  const isPlaying = useServiceStore((s) => s.isPlaying);

  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchDevices()
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, [fetchDevices]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const select = async (id: string) => {
    setBusyId(id);
    try { await transferToDevice(id, isPlaying); } catch { /* ignore */ }
    setBusyId(null);
    // 전환 반영(활성 표시)될 시간을 두고 새로고침
    setTimeout(load, 600);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[calc(100%-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
          <span className="font-semibold text-[var(--ls-text)]">{t.devicePicker.title}</span>
          <button
            onClick={load}
            className="ls-button text-xs hover:text-white transition-colors"
          >
            {t.devicePicker.refresh}
          </button>
        </div>

        <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-1 min-h-[120px]">
          {loading ? (
            <p className="text-sm text-[var(--ls-text-secondary)] text-center py-8">{t.devicePicker.loading}</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-[var(--ls-text-secondary)] text-center py-8 px-4 leading-relaxed">{t.devicePicker.empty}</p>
          ) : (
            devices.map((d) => (
              <button
                key={d.id}
                onClick={() => !d.is_active && select(d.id)}
                disabled={d.is_active || busyId !== null}
                className={`ls-button ${`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors disabled:cursor-default ${
                  d.is_active
                    ? "bg-green-500/15 border border-green-500/40"
                    : "border border-transparent hover:bg-[var(--ls-control)]"
                }`}`}
              >
                <span className={d.is_active ? "text-green-400" : "text-[var(--ls-text-secondary)]"}>
                  <DeviceIcon type={d.type} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--ls-text)] truncate">{d.name}</div>
                  <div className="text-xs text-[var(--ls-text-secondary)] truncate">
                    {d.type}{d.volume_percent != null ? ` · ${d.volume_percent}%` : ""}
                  </div>
                </div>
                {busyId === d.id ? (
                  <span className="text-xs text-[var(--ls-text-secondary)] shrink-0">…</span>
                ) : d.is_active ? (
                  <span className="text-xs text-green-400 shrink-0">{t.devicePicker.active}</span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--ls-border-subtle)] flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-[var(--ls-text-secondary)] leading-snug">{t.devicePicker.hint}</p>
          <button
            onClick={onClose}
            className="ls-button shrink-0 text-sm hover:text-white transition-colors"
          >
            {t.devicePicker.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t === "smartphone" || t === "tablet") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="2" width="10" height="20" rx="2" /><line x1="11" y1="18" x2="13" y2="18" />
      </svg>
    );
  }
  if (t === "speaker" || t === "avr" || t === "stb" || t === "tv" || t === "castaudio" || t === "castvideo") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="14" r="4" /><line x1="12" y1="6" x2="12" y2="6" />
      </svg>
    );
  }
  // computer / default
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
