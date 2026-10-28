import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { useLrcStore } from "../../stores/useLrcStore";

// YouTube URL → yt-dlp 오디오 다운로드 흐름 전체(모달 상태 + 진행률 이벤트 + 취소).
// AudioPlayer에서 분리해 파일 모드/Spotify/기기 감지 엔진 로직과 뒤섞이지 않게 함.
export function useYouTubeLoad(setAudioPath: (path: string) => void) {
  const { ytdlpAudioQuality, ytdlpCookiesFile, ytdlpProxy } = useSettingsStore();

  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoadingRaw] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytModalOpen, setYtModalOpen] = useState(false);

  // 업데이트 다운로드/재시작이 yt-dlp 다운로드와 겹치지 않도록 busy 상태를 함께 표시
  const busyOwner = useId();
  const YT_BUSY_ID = `youtube-download:${busyOwner}`;
  const mounted = useRef(true);
  const operation = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) operation.current.cancelled = true;
    };
  }, []);
  const setYtLoading = (v: boolean) => {
    if (mounted.current) setYtLoadingRaw(v);
    if (v) useBusyStore.getState().markBusy(YT_BUSY_ID);
    else useBusyStore.getState().clearBusy(YT_BUSY_ID);
  };

  const handleYtLoad = async () => {
    const url = ytUrl.trim();
    if (!url || operation.current || !mounted.current) return;
    if (!useSettingsStore.getState().youtubeMode) return;
    const request = { cancelled: false };
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
      });
      const current = useLrcStore.getState();
      const isYouTubeMode = useSettingsStore.getState().youtubeMode;
      if (!mounted.current || request.cancelled || current._audioSelection !== audioSelection ||
          current._documentSession !== documentSession || !isYouTubeMode) return;
      setAudioPath(path);
      setYtModalOpen(false);
      setYtUrl("");
    } catch (e) {
      if (mounted.current && !request.cancelled) setYtError(String(e));
    } finally {
      operation.current = null;
      setYtLoading(false);
    }
  };

  const handleYtCancel = () => {
    if (operation.current) operation.current.cancelled = true;
    invoke("cancel_ytdlp_load").catch(() => {});
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
