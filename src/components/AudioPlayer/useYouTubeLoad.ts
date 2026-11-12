import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { useLrcStore } from "../../stores/useLrcStore";

let youtubeRequestSequence = 0;

// YouTube URL → yt-dlp 오디오 다운로드 흐름 전체(모달 상태 + 진행률 이벤트 + 취소).
// AudioPlayer에서 분리해 파일 모드/Spotify/기기 감지 엔진 로직과 뒤섞이지 않게 함.
export function useYouTubeLoad(setAudioPath: (path: string) => void) {
  const { ytdlpAudioQuality, ytdlpCookiesFile, ytdlpProxy, youtubeMode } = useSettingsStore();
  const proxyAuthUnsupported = useI18nStore((state) => state.t.ytdlpProxyAuthUnsupported);

  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoadingRaw] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytModalOpen, setYtModalOpen] = useState(false);

  // 업데이트 다운로드/재시작이 yt-dlp 다운로드와 겹치지 않도록 busy 상태를 함께 표시
  const busyOwner = useId();
  const YT_BUSY_ID = `youtube-download:${busyOwner}`;
  const mounted = useRef(true);
  const operation = useRef<{ runId: string; cancelled: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const active = operation.current;
      if (active && !active.cancelled) {
        active.cancelled = true;
        void invoke("cancel_ytdlp_load", { runId: active.runId }).catch(() => {});
      }
    };
  }, []);
  useEffect(() => {
    const active = operation.current;
    if (!youtubeMode && active && !active.cancelled) {
      active.cancelled = true;
      void invoke("cancel_ytdlp_load", { runId: active.runId }).catch(() => {});
    }
  }, [youtubeMode]);
  const setYtLoading = (v: boolean) => {
    if (mounted.current) setYtLoadingRaw(v);
    if (v) useBusyStore.getState().markBusy(YT_BUSY_ID);
    else useBusyStore.getState().clearBusy(YT_BUSY_ID);
  };

  const handleYtLoad = async () => {
    const url = ytUrl.trim();
    if (!url || operation.current || !mounted.current) return;
    if (!useSettingsStore.getState().youtubeMode) return;
    const request = { runId: `youtube-${Date.now()}-${++youtubeRequestSequence}`, cancelled: false };
    operation.current = request;
    const { _audioSelection: audioSelection, _documentSession: documentSession } = useLrcStore.getState();
    setYtLoading(true);
    setYtError(null);
    try {
      const path = await invoke<string>("ytdlp_load_audio", {
        url,
        quality: ytdlpAudioQuality,
        cookiesFile: ytdlpCookiesFile,
        proxy: ytdlpProxy,
        runId: request.runId,
      });
      const current = useLrcStore.getState();
      const isYouTubeMode = useSettingsStore.getState().youtubeMode;
      if (!mounted.current || request.cancelled || current._audioSelection !== audioSelection ||
          current._documentSession !== documentSession || !isYouTubeMode) return;
      setAudioPath(path);
      setYtModalOpen(false);
      setYtUrl("");
    } catch (e) {
      if (mounted.current && !request.cancelled) {
        const message = String(e);
        setYtError(message.includes("YTDLP_AUTH_PROXY_UNSUPPORTED") ? proxyAuthUnsupported : message);
      }
    } finally {
      operation.current = null;
      setYtLoading(false);
    }
  };

  const handleYtCancel = () => {
    const active = operation.current;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    invoke("cancel_ytdlp_load", { runId: active.runId }).catch(() => {});
  };

  const handleYtModalClose = () => {
    if (ytLoading) return;
    setYtModalOpen(false);
    setYtError(null);
  };

  return {
    ytUrl, ytLoading, ytError, ytModalOpen,
    setYtUrl, setYtError, setYtModalOpen,
    handleYtLoad, handleYtCancel, handleYtModalClose,
  };
}
