import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { audioControls } from "../../utils/audioControls";
import { formatDisplayTime, formatTimestamp, parseTimestampInput } from "../../utils/lrcParser";

export function PreviewModal({ onClose }: { onClose: () => void }) {
  const { doc, currentTime, duration, isPlaying, updateLine } = useLrcStore();
  const { t } = useI18nStore();
  const activeLineRef = useRef<HTMLDivElement>(null);

  // 인라인 타임스탬프 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // 현재 시각 기준으로 활성 줄 인덱스 계산
  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < doc.lines.length; i++) {
      const ts = doc.lines[i].timestamp;
      if (ts !== null && ts <= currentTime) idx = i;
    }
    return idx;
  }, [doc.lines, currentTime]);

  // 활성 줄이 바뀔 때 스크롤 (편집 중이 아닐 때만)
  useEffect(() => {
    if (editingId) return;
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx, editingId]);

  // 편집 인풋 자동 포커스
  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  // ESC: 편집 중이면 편집 취소, 아니면 모달 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingId) {
          setEditingId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, editingId]);

  const togglePlay = useCallback(() => audioControls.togglePlay(), []);
  const skip = useCallback((d: number) => audioControls.skip(d), []);

  const startEdit = (id: string, currentTs: number | null) => {
    setEditingId(id);
    setEditValue(currentTs !== null ? formatTimestamp(currentTs) : "");
  };

  const commitEdit = (id: string) => {
    const parsed = parseTimestampInput(editValue);
    if (parsed !== null) {
      updateLine(id, { timestamp: parsed });
    }
    setEditingId(null);
  };

  const hasTimestamps = doc.lines.some((l) => l.timestamp !== null);

  const progress = duration > 0 ? currentTime / duration : 0;

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioControls.seekTo(ratio * duration);
  }, [duration]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      {/* 진행 상태바 */}
      <div
        className="shrink-0 h-1 bg-zinc-800 cursor-pointer group"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-indigo-500 group-hover:bg-indigo-400 transition-colors relative"
          style={{ width: `${progress * 100}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity translate-x-1/2" />
        </div>
      </div>

      {/* 상단 바 */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-white font-semibold text-base truncate leading-tight">
            {doc.metadata.title || t.previewUntitled}
          </span>
          {doc.metadata.artist && (
            <span className="text-zinc-400 text-sm truncate leading-tight">
              {doc.metadata.artist}
            </span>
          )}
        </div>

        {/* 재생 컨트롤 */}
        <div className="flex items-center gap-3 mx-6">
          <PreviewBtn onClick={() => skip(-5)} title="-5s">
            <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
          </PreviewBtn>
          <PreviewBtn onClick={() => skip(-1)} title="-1s">
            <TriLeftIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
          </PreviewBtn>
          <PreviewBtn onClick={togglePlay} accent>
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </PreviewBtn>
          <PreviewBtn onClick={() => skip(1)} title="+1s">
            <span className="text-[10px] font-bold mr-0.5">1</span><TriRightIcon />
          </PreviewBtn>
          <PreviewBtn onClick={() => skip(5)} title="+5s">
            <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
          </PreviewBtn>
          <span className="font-mono text-xs text-zinc-400 tabular-nums w-24 text-center">
            {formatDisplayTime(currentTime)}
          </span>
        </div>

        <button
          onClick={onClose}
          className="shrink-0 px-3 py-1.5 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
        >
          {t.previewClose}
        </button>
      </div>

      {/* 가사 영역 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto py-20 px-8"
        style={{ scrollbarWidth: "none" }}
      >
        {doc.lines.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-zinc-600 text-lg">{t.previewNoLyrics}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">
            {!hasTimestamps && (
              <p className="text-zinc-700 text-sm text-center mb-2">{t.previewNoTimestamps}</p>
            )}
            {doc.lines.map((line, i) => {
              const dist = activeIdx === -1 ? 999 : Math.abs(i - activeIdx);
              const isActive = i === activeIdx;

              const dimClass = isActive
                ? "text-white"
                : dist === 1 ? "text-zinc-300"
                : dist === 2 ? "text-zinc-500"
                : "text-zinc-700";

              const textSizeClass = isActive
                ? "text-2xl font-bold"
                : dist === 1 ? "text-xl font-medium"
                : dist === 2 ? "text-lg"
                : "text-base";

              return (
                <div
                  key={line.id}
                  ref={isActive ? activeLineRef : null}
                  className={`flex items-baseline gap-4 transition-all duration-300 ${dimClass}`}
                >
                  {/* 타임스탬프 영역 */}
                  <div className="w-20 shrink-0 flex justify-end">
                    {editingId === line.id ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(line.id)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") commitEdit(line.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        placeholder="00:00.00"
                        className="w-20 bg-zinc-800 border border-indigo-500 rounded px-1.5 py-0.5 text-xs font-mono text-indigo-300 focus:outline-none text-right"
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(line.id, line.timestamp)}
                        className={`font-mono text-xs px-1.5 py-0.5 rounded transition-colors text-right w-full
                          ${line.timestamp !== null
                            ? "hover:bg-zinc-800 hover:text-indigo-300"
                            : "text-zinc-700 hover:bg-zinc-800 hover:text-zinc-500"
                          }`}
                      >
                        {line.timestamp !== null ? formatTimestamp(line.timestamp) : "—"}
                      </button>
                    )}
                  </div>

                  {/* 가사 텍스트 */}
                  <div
                    className={`flex-1 leading-snug ${textSizeClass} ${line.timestamp !== null ? "cursor-pointer" : "select-none"}`}
                    onClick={() => {
                      if (line.timestamp !== null) {
                        audioControls.seekTo(line.timestamp);
                        if (!isPlaying) audioControls.togglePlay();
                      }
                    }}
                  >
                    {isActive ? (
                      <span className="relative inline-block">
                        {line.text || " "}
                        <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-indigo-500 opacity-80" />
                      </span>
                    ) : (
                      line.text || " "
                    )}
                  </div>
                </div>
              );
            })}
            <div className="h-24 shrink-0" />
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewBtn({
  onClick, title, accent, children,
}: {
  onClick: () => void;
  title?: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        "flex items-center justify-center text-sm transition-colors",
        accent
          ? "w-9 h-9 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white"
          : "h-9 px-2 rounded-lg text-zinc-300 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 6 L11 18 L4 12 Z M18 6 L18 18 L11 12 Z" />
    </svg>
  );
}

function SkipFwdIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6 L6 18 L13 12 Z M13 6 L13 18 L20 12 Z" />
    </svg>
  );
}

function TriLeftIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6 L15 18 L7 12 Z" /></svg>;
}

function TriRightIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6 L9 18 L17 12 Z" /></svg>;
}
