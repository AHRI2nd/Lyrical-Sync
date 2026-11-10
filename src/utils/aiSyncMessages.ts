import type { Translations } from "../i18n/translations";

export function localizeAiSyncError(message: string, t: Translations): string {
  const normalized = message.replace(/^Error:\s*/i, "").trim();
  const code = /^AI_SYNC_ERROR:([a-z_]+)$/.exec(normalized)?.[1];
  if (code === "packages") return t.aiSyncErrorPackages;
  if (code === "model") return t.aiSyncErrorModel;
  if (code === "audio") return t.aiSyncErrorAudio;
  if (code === "audio_too_short") return t.aiSyncErrorAudioTooShort;
  if (code === "unsupported_lyrics") return t.aiSyncErrorUnsupported;
  if (/^(패키지 임포트 실패|demucs 패키지 미설치)/i.test(normalized)) return t.aiSyncErrorPackages;
  if (/^모델 로드 실패/i.test(normalized)) return t.aiSyncErrorModel;
  if (/^오디오가 너무 짧습니다/i.test(normalized)) return t.aiSyncErrorAudioTooShort;
  if (/^(오디오 로드 실패|보컬 분리 실패|저장 실패)/i.test(normalized)) return t.aiSyncErrorAudio;
  if (/지원하지 않는 문자/.test(normalized)) return t.aiSyncErrorUnsupported;
  return t.aiSyncErrorGeneral;
}
