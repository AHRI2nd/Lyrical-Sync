import { describe, expect, it } from "vitest";
import { translations } from "../i18n/translations";
import { localizeAiSyncError } from "./aiSyncMessages";

describe("localizeAiSyncError", () => {
  it.each(["en", "ja"] as const)("maps sidecar failures to the %s locale without exposing raw diagnostics", (lang) => {
    const t = translations[lang];
    expect(localizeAiSyncError("Error: 패키지 임포트 실패: /private/user/path", t)).toBe(t.aiSyncErrorPackages);
    expect(localizeAiSyncError("Error: 모델 로드 실패: /private/user/model.onnx", t)).toBe(t.aiSyncErrorModel);
    expect(localizeAiSyncError("오디오가 너무 짧습니다 (0.20초)", t)).toBe(t.aiSyncErrorAudioTooShort);
    expect(localizeAiSyncError("정렬 모델이 지원하지 않는 문자가 포함되어 있습니다", t)).toBe(t.aiSyncErrorUnsupported);
    expect(localizeAiSyncError("unexpected platform exception", t)).toBe(t.aiSyncErrorGeneral);
  });
});
