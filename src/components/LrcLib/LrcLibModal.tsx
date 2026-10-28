import { useEffect, useMemo, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { isComposingKeyEvent } from "../../utils/keybindings";
import {
  lrclibSearch,
  sortByAccuracy,
  type LrcLibResult,
  type LrcLibQuery,
} from "../../utils/lrclib";

export function formatLrcLibDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "";
  const totalSeconds = Math.round(sec);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LrcLibModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const metadata = useLrcStore((s) => s.doc.metadata);
  const ownerSession = useRef(useLrcStore.getState()._documentSession).current;
  const requestApplyFetchedLyrics = useLrcStore((s) => s.requestApplyFetchedLyrics);

  const [title, setTitle] = useState(metadata.title);
  const [artist, setArtist] = useState(metadata.artist);
  const [album, setAlbum] = useState(metadata.album);
  const [results, setResults] = useState<LrcLibResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [preview, setPreview] = useState<LrcLibResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [syncedOnly, setSyncedOnly] = useState(false);
  const [plainOnly, setPlainOnly] = useState(false);

  // 가사 종류 필터 (체크 조합에 따라). 정렬은 sortByAccuracy에서 동기화 우선 처리됨.
  const filtered = useMemo(() => {
    return results.filter((r) => {
      const type = r.syncedLyrics ? "synced" : r.plainLyrics ? "plain" : "none";
      if (syncedOnly && plainOnly) return type !== "none";
      if (syncedOnly) return type === "synced";
      if (plainOnly) return type === "plain";
      return true;
    });
  }, [results, syncedOnly, plainOnly]);

  const reqId = useRef(0);
  const applyingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runSearch = async (q: LrcLibQuery) => {
    if (!q.title?.trim() && !q.artist?.trim() && !q.album?.trim()) return;
    const id = ++reqId.current;
    setStatus("loading");
    try {
      const raw = await lrclibSearch(q);
      if (id !== reqId.current) return; // 더 최신 검색이 있으면 폐기
      setResults(sortByAccuracy(raw, q));
      setStatus("done");
    } catch {
      if (id !== reqId.current) return;
      setResults([]);
      setStatus("error");
    }
  };

  // 열릴 때 메타데이터가 있으면 자동 검색
  useEffect(() => {
    if (metadata.title.trim() || metadata.artist.trim() || metadata.album.trim()) {
      runSearch({ title: metadata.title, artist: metadata.artist, album: metadata.album });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC: 미리보기 먼저 닫고, 없으면 모달 닫기
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isComposingKeyEvent(e)) return;
      if (preview) setPreview(null);
      else onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [preview, onClose]);

  const handleConfirm = async (r: LrcLibResult) => {
    const lrc = r.syncedLyrics ?? r.plainLyrics;
    if (!lrc || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    let result: "applied" | "cancelled";
    try {
      result = await requestApplyFetchedLyrics(
        lrc,
        { title: r.trackName, artist: r.artistName, album: r.albumName },
        ownerSession,
      );
    } catch {
      result = "cancelled";
    }
    if (result === "applied") {
      onClose();
    } else if (mountedRef.current) {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-2xl h-4/5 max-h-[calc(100%-2rem)] mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
          <span className="font-semibold text-[var(--ls-text)]">{t.lrclib.title}</span>
          <button onClick={onClose} aria-label={t.close} className="ls-button hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        {/* 검색 필드 */}
        <div className="px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <Field label={t.lrclib.fieldTitle} value={title} onChange={setTitle} onEnter={() => runSearch({ title, artist, album })} />
            <Field label={t.lrclib.fieldArtist} value={artist} onChange={setArtist} onEnter={() => runSearch({ title, artist, album })} />
            <Field label={t.lrclib.fieldAlbum} value={album} onChange={setAlbum} onEnter={() => runSearch({ title, artist, album })} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--ls-text-secondary)] truncate">{t.lrclib.hint}</span>
            <div className="flex items-center gap-3 shrink-0">
              <Check label={t.lrclib.syncedOnly} checked={syncedOnly} onChange={setSyncedOnly} />
              <Check label={t.lrclib.plainOnly} checked={plainOnly} onChange={setPlainOnly} />
              <button
                onClick={() => runSearch({ title, artist, album })}
                disabled={status === "loading" || (!title.trim() && !artist.trim() && !album.trim())}
                className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ls-button--primary"
              >
                {status === "loading" ? t.lrclib.searching : t.lrclib.search}
              </button>
            </div>
          </div>
        </div>

        {/* 결과 리스트 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {status === "loading" && <p className="text-center text-[var(--ls-text-secondary)] text-sm py-8">{t.lrclib.searching}</p>}
          {status === "error" && <p className="text-center text-rose-400 text-sm py-8">{t.lrclib.error}</p>}
          {status === "done" && filtered.length === 0 && <p className="text-center text-[var(--ls-text-secondary)] text-sm py-8">{t.lrclib.noResults}</p>}
          <div className="flex flex-col gap-1.5">
            {filtered.map((r) => (
              <ResultRow
                key={r.id}
                r={r}
                t={t}
                onPreview={() => setPreview(r)}
                onConfirm={() => handleConfirm(r)}
                applying={applying}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 미리보기: 동일 사이즈로 덮는 추가 팝업 */}
      {preview && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); setPreview(null); }}
        >
          <div
            className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-2xl h-4/5 max-h-[calc(100%-2rem)] mx-4 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--ls-text)] truncate">{preview.trackName || "—"}</p>
                <p className="text-xs text-[var(--ls-text-secondary)] truncate">
                  {[preview.artistName, preview.albumName].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { handleConfirm(preview); }}
                  disabled={(!preview.syncedLyrics && !preview.plainLyrics) || applying}
                  className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ls-button--primary"
                >
                  {t.lrclib.confirm}
                </button>
                <button onClick={() => setPreview(null)} aria-label={t.close} className="ls-button hover:text-white transition-colors text-lg leading-none">✕</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {preview.syncedLyrics || preview.plainLyrics ? (
                <pre className="text-sm text-[var(--ls-text)] whitespace-pre-wrap font-mono leading-relaxed">
                  {preview.syncedLyrics ?? preview.plainLyrics}
                </pre>
              ) : (
                <p className="text-center text-[var(--ls-text-secondary)] text-sm py-8">{t.lrclib.noLyrics}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Check({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--ls-text-secondary)] cursor-pointer select-none whitespace-nowrap">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--ls-accent)] w-3.5 h-3.5"
      />
      {label}
    </label>
  );
}

function Field({
  label, value, onChange, onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-[var(--ls-text-secondary)]">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !isComposingKeyEvent(e.nativeEvent)) onEnter(); }}
        className="ls-field text-sm"
      />
    </div>
  );
}

function ResultRow({
  r, t, onPreview, onConfirm, applying,
}: {
  r: LrcLibResult;
  t: ReturnType<typeof useI18nStore.getState>["t"];
  onPreview: () => void;
  onConfirm: () => void;
  applying: boolean;
}) {
  const dur = formatLrcLibDuration(r.duration);
  const hasLyrics = !!(r.syncedLyrics || r.plainLyrics);
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 bg-[var(--ls-control)]/50 hover:bg-[var(--ls-control)] transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--ls-text)] truncate">{r.trackName || "—"}</p>
        <p className="text-xs text-[var(--ls-text-secondary)] truncate">
          {r.artistName || "—"}
          {r.albumName ? <span className="text-[var(--ls-text-secondary)]"> · {r.albumName}</span> : null}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          {r.instrumental ? (
            <Badge color="zinc">{t.lrclib.instrumental}</Badge>
          ) : r.syncedLyrics ? (
            <Badge color="emerald">{t.lrclib.synced}</Badge>
          ) : r.plainLyrics ? (
            <Badge color="amber">{t.lrclib.plain}</Badge>
          ) : (
            <Badge color="zinc">{t.lrclib.noLyrics}</Badge>
          )}
          {dur && <span className="text-[10px] text-[var(--ls-text-secondary)] font-mono">{dur}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onPreview}
          disabled={!hasLyrics}
          className="ls-button text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t.lrclib.preview}
        </button>
        <button
          onClick={onConfirm}
          disabled={!hasLyrics || applying}
          className="ls-button text-xs bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ls-button--primary"
        >
          {t.lrclib.confirm}
        </button>
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: "emerald" | "amber" | "zinc"; children: React.ReactNode }) {
  const cls = {
    emerald: "bg-emerald-900/50 text-emerald-300",
    amber: "bg-[var(--ls-playhead)]/50 text-[var(--ls-playhead)]",
    zinc: "bg-[var(--ls-control)] text-[var(--ls-text-secondary)]",
  }[color];
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{children}</span>;
}
